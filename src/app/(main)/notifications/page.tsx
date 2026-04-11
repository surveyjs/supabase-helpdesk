import Link from 'next/link';
import { redirect } from 'next/navigation';
import { createServerClient } from '@/lib/supabase/server';
import { requireAuth } from '@/lib/supabase/auth';
import { markAllNotificationsRead } from '@/lib/actions/notifications';
import { Pagination } from '@/components/ui/Pagination';

function eventIcon(eventType: string): string {
  switch (eventType) {
    case 'new_post':
    case 'user_reply_to_agent':
      return '💬';
    case 'status_changed':
    case 'auto_reopen':
      return '🔄';
    case 'agent_assigned':
    case 'agent_assigned_to_agent':
      return '👤';
    case 'urgency_changed':
    case 'severity_changed':
      return '⚡';
    case 'privacy_changed':
      return '🔒';
    default:
      return '🔔';
  }
}

export default async function NotificationsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await requireAuth();
  const supabase = await createServerClient();

  const params = await searchParams;
  const currentPage = Math.max(1, parseInt((params.page as string) ?? '1', 10) || 1);

  // Read page size from app_settings
  const { data: pageSizeSetting } = await supabase
    .from('app_settings')
    .select('value')
    .eq('key', 'other_lists_page_size')
    .single();

  const pageSize = parseInt(pageSizeSetting?.value ?? '20', 10) || 20;
  const offset = (currentPage - 1) * pageSize;

  // Fetch notifications with count
  const { data: notifications, count } = await supabase
    .from('notifications')
    .select('id, event_type, ticket_id, message, is_read, created_at', { count: 'exact' })
    .eq('recipient_id', user.id)
    .order('created_at', { ascending: false })
    .range(offset, offset + pageSize - 1);

  const total = count ?? 0;
  const totalPages = Math.ceil(total / pageSize);

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-semibold text-gray-900">Notifications</h1>
        <form action={async () => {
          'use server';
          await markAllNotificationsRead();
        }}>
          <button
            type="submit"
            className="text-sm text-blue-600 hover:text-blue-800"
          >
            Mark all as read
          </button>
        </form>
      </div>

      {!notifications || notifications.length === 0 ? (
        <p className="text-gray-500 text-sm">No notifications yet.</p>
      ) : (
        <div className="bg-white rounded-lg border border-gray-200 divide-y divide-gray-100">
          {notifications.map((notif) => {
            const href = notif.ticket_id ? `/tickets/${notif.ticket_id}` : '#';
            return (
              <Link
                key={notif.id}
                href={href}
                className={`block px-4 py-3 hover:bg-gray-50 ${
                  !notif.is_read ? 'bg-blue-50' : ''
                }`}
              >
                <div className="flex items-start gap-3">
                  <span className="text-lg flex-shrink-0" aria-hidden="true">
                    {eventIcon(notif.event_type)}
                  </span>
                  <div className="flex-1 min-w-0">
                    <p
                      className={`text-sm ${
                        !notif.is_read ? 'font-medium text-gray-900' : 'text-gray-700'
                      }`}
                    >
                      {notif.message}
                    </p>
                    <p className="text-xs text-gray-400 mt-0.5">
                      {new Date(notif.created_at).toLocaleString()}
                    </p>
                  </div>
                  {!notif.is_read && (
                    <span className="h-2 w-2 rounded-full bg-blue-500 flex-shrink-0 mt-1.5" />
                  )}
                </div>
              </Link>
            );
          })}
        </div>
      )}

      <Pagination
        currentPage={currentPage}
        totalPages={totalPages}
        basePath="/notifications"
        searchParams={{}}
        pageSize={pageSize}
      />
    </div>
  );
}
