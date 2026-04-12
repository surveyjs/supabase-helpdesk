import { redirect } from 'next/navigation';
import Link from 'next/link';
import { createServerClient } from '@/lib/supabase/server';
import { getUser } from '@/lib/supabase/auth';
import { markAllNotificationsRead } from '@/lib/actions/notifications';

interface Notification {
  id: string;
  event_type: string;
  ticket_id: number | null;
  message: string;
  is_read: boolean;
  created_at: string;
}

function getEventIcon(eventType: string): string {
  switch (eventType) {
    case 'new_post':
    case 'user_reply_to_agent':
      return '💬';
    case 'status_changed':
      return '🔄';
    case 'agent_assigned':
    case 'agent_assigned_to_agent':
      return '👤';
    case 'urgency_changed':
    case 'severity_changed':
      return '⚠️';
    case 'privacy_changed':
      return '🔒';
    case 'auto_reopen':
      return '🔓';
    default:
      return '📢';
  }
}

function formatTimestamp(dateString: string): string {
  const date = new Date(dateString);
  return date.toLocaleString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

async function MarkAllReadButton() {
  return (
    <form action={markAllNotificationsRead}>
      <button
        type="submit"
        className="px-4 py-2 text-sm bg-blue-600 text-white rounded hover:bg-blue-700"
      >
        Mark all as read
      </button>
    </form>
  );
}

export default async function NotificationsPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string }>;
}) {
  const user = await getUser();
  if (!user) redirect('/login');

  const supabase = await createServerClient();

  // Get page size from app settings
  const { data: pageSizeData } = await supabase
    .from('app_settings')
    .select('value')
    .eq('key', 'other_lists_page_size')
    .single();

  const pageSize = pageSizeData ? parseInt(pageSizeData.value, 10) || 20 : 20;

  const params = await searchParams;
  const currentPage = parseInt(params.page || '1', 10);
  const offset = (currentPage - 1) * pageSize;

  // Fetch notifications
  const { data: notifications, count } = await supabase
    .from('notifications')
    .select('*', { count: 'exact' })
    .eq('recipient_id', user.id)
    .order('created_at', { ascending: false })
    .range(offset, offset + pageSize - 1);

  const totalPages = count ? Math.ceil(count / pageSize) : 1;
  const hasUnread = notifications?.some((n) => !n.is_read) || false;

  return (
    <div className="max-w-4xl mx-auto px-4 py-8">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Notifications</h1>
        {hasUnread && <MarkAllReadButton />}
      </div>

      {!notifications || notifications.length === 0 ? (
        <div className="bg-white rounded-lg border border-gray-200 px-6 py-12 text-center">
          <p className="text-gray-500">No notifications yet</p>
        </div>
      ) : (
        <>
          <div className="bg-white rounded-lg border border-gray-200 divide-y divide-gray-100">
            {notifications.map((notification: Notification) => (
              <div
                key={notification.id}
                className={`px-6 py-4 ${
                  !notification.is_read ? 'bg-blue-50' : ''
                }`}
              >
                <div className="flex gap-4">
                  <span className="text-2xl flex-shrink-0">
                    {getEventIcon(notification.event_type)}
                  </span>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-gray-900 mb-1">
                      {notification.message}
                    </p>
                    <p className="text-xs text-gray-500">
                      {formatTimestamp(notification.created_at)}
                    </p>
                    {notification.ticket_id && (
                      <Link
                        href={`/tickets/${notification.ticket_id}`}
                        className="inline-block mt-2 text-sm text-blue-600 hover:text-blue-800"
                      >
                        View ticket →
                      </Link>
                    )}
                  </div>
                  {!notification.is_read && (
                    <span className="flex-shrink-0 h-2 w-2 bg-blue-500 rounded-full mt-2" aria-label="Unread" />
                  )}
                </div>
              </div>
            ))}
          </div>

          {totalPages > 1 && (
            <div className="mt-6 flex items-center justify-center gap-2">
              {currentPage > 1 && (
                <Link
                  href={`/notifications?page=${currentPage - 1}`}
                  className="px-4 py-2 text-sm bg-white border border-gray-300 rounded hover:bg-gray-50"
                >
                  Previous
                </Link>
              )}
              <span className="px-4 py-2 text-sm text-gray-700">
                Page {currentPage} of {totalPages}
              </span>
              {currentPage < totalPages && (
                <Link
                  href={`/notifications?page=${currentPage + 1}`}
                  className="px-4 py-2 text-sm bg-white border border-gray-300 rounded hover:bg-gray-50"
                >
                  Next
                </Link>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
