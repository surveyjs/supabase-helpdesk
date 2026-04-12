'use client';

import { useState } from 'react';
import Link from 'next/link';
import { markNotificationRead, markAllNotificationsRead } from '@/lib/actions/notifications';

interface Notification {
  id: string;
  event_type: string;
  ticket_id: number | null;
  message: string;
  is_read: boolean;
  created_at: string;
}

export type { Notification };

interface NotificationDropdownProps {
  initialNotifications: Notification[];
  onClose: () => void;
  onMarkAllRead: () => void;
}

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

function relativeTime(dateStr: string): string {
  const now = Date.now();
  const then = new Date(dateStr).getTime();
  const diffMs = now - then;
  const diffMin = Math.floor(diffMs / 60000);
  if (diffMin < 1) return 'just now';
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHours = Math.floor(diffMin / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  const diffDays = Math.floor(diffHours / 24);
  if (diffDays < 7) return `${diffDays}d ago`;
  return new Date(dateStr).toLocaleDateString();
}

export function NotificationDropdown({ initialNotifications, onClose, onMarkAllRead }: NotificationDropdownProps) {
  const [notifications, setNotifications] = useState<Notification[]>(initialNotifications);

  function handleClickNotification(notif: Notification) {
    if (!notif.is_read) {
      // Mark read optimistically — fire-and-forget so navigation isn't blocked
      markNotificationRead(notif.id);
      setNotifications((prev) =>
        prev.map((n) => (n.id === notif.id ? { ...n, is_read: true } : n)),
      );
    }
    onClose();
  }

  async function handleMarkAllRead() {
    await markAllNotificationsRead();
    setNotifications((prev) => prev.map((n) => ({ ...n, is_read: true })));
    onMarkAllRead();
  }

  return (
    <div className="absolute right-0 mt-2 w-80 bg-white rounded-lg border border-gray-200 shadow-lg z-50">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100">
        <h3 className="text-sm font-semibold text-gray-900">Notifications</h3>
        <button
          type="button"
          onClick={handleMarkAllRead}
          className="text-xs text-blue-600 hover:text-blue-800"
        >
          Mark all as read
        </button>
      </div>

      {/* Notification list */}
      <div className="max-h-96 overflow-y-auto">
        {notifications.length === 0 ? (
          <div className="px-4 py-6 text-center text-sm text-gray-500">No notifications</div>
        ) : (
          notifications.map((notif) => {
            const notificationContent = (
              <div className="flex items-start gap-2">
                <span className="text-base flex-shrink-0" aria-hidden="true">
                  {eventIcon(notif.event_type)}
                </span>
                <div className="flex-1 min-w-0">
                  <p className={`text-sm ${!notif.is_read ? 'font-medium text-gray-900' : 'text-gray-700'}`}>
                    {notif.message}
                  </p>
                  <p className="text-xs text-gray-400 mt-0.5">
                    {relativeTime(notif.created_at)}
                  </p>
                </div>
                {!notif.is_read && (
                  <span className="h-2 w-2 rounded-full bg-blue-500 flex-shrink-0 mt-1.5" />
                )}
              </div>
            );

            const className = `block px-4 py-3 hover:bg-gray-50 border-b border-gray-50 ${
              !notif.is_read ? 'bg-blue-50' : ''
            }`;

            return notif.ticket_id ? (
              <Link
                key={notif.id}
                href={`/tickets/${notif.ticket_id}`}
                onClick={() => handleClickNotification(notif)}
                className={className}
              >
                {notificationContent}
              </Link>
            ) : (
              <button
                key={notif.id}
                type="button"
                onClick={() => handleClickNotification(notif)}
                className={`${className} w-full text-left`}
              >
                {notificationContent}
              </button>
            );
          })
        )}
      </div>

      {/* Footer */}
      <div className="border-t border-gray-100 px-4 py-2">
        <Link
          href="/notifications"
          onClick={onClose}
          className="block text-center text-xs text-blue-600 hover:text-blue-800"
        >
          View all
        </Link>
      </div>
    </div>
  );
}
