import Link from 'next/link';
import { createServerClient } from '@/lib/supabase/server';
import { requireAuth } from '@/lib/supabase/auth';
import { markAllNotificationsRead } from '@/lib/actions/notifications';
import { Pagination } from '@/components/ui/Pagination';

function eventIcon(eventType: string) {
  const cls = "h-4 w-4";
  switch (eventType) {
    case 'new_post':
    case 'user_reply_to_agent':
      return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className={cls} aria-hidden="true">
          <path d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
        </svg>
      );
    case 'status_changed':
    case 'auto_reopen':
      return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className={cls} aria-hidden="true">
          <path d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
        </svg>
      );
    case 'agent_assigned':
    case 'agent_assigned_to_agent':
      return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className={cls} aria-hidden="true">
          <path d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
        </svg>
      );
    case 'urgency_changed':
    case 'severity_changed':
      return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className={cls} aria-hidden="true">
          <path d="M13 10V3L4 14h7v7l9-11h-7z" />
        </svg>
      );
    case 'privacy_changed':
      return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className={cls} aria-hidden="true">
          <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
          <path d="M7 11V7a5 5 0 0110 0v4" />
        </svg>
      );
    default:
      return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className={cls} aria-hidden="true">
          <path d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
        </svg>
      );
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
            const content = (
              <div className="flex items-start gap-3">
                <span className="flex-shrink-0 text-gray-400" aria-hidden="true">
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
                  <p className="text-xs text-gray-500 mt-0.5">
                    {new Date(notif.created_at).toLocaleString()}
                  </p>
                </div>
                {!notif.is_read && (
                  <span className="h-2 w-2 rounded-full bg-blue-500 flex-shrink-0 mt-1.5" />
                )}
              </div>
            );

            const className = `block px-4 py-3 hover:bg-gray-50 ${
              !notif.is_read ? 'bg-blue-50' : ''
            }`;

            return notif.ticket_id ? (
              <Link
                key={notif.id}
                href={`/tickets/${notif.ticket_id}/redirect`}
                className={className}
              >
                {content}
              </Link>
            ) : (
              <div key={notif.id} className={className}>
                {content}
              </div>
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
