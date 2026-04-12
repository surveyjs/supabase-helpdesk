'use client';

import { useState, useEffect } from 'react';
import { createBrowserClient } from '@/lib/supabase/client';
import { markNotificationRead, markAllNotificationsRead } from '@/lib/actions/notifications';
import Link from 'next/link';

interface Notification {
  id: string;
  event_type: string;
  ticket_id: number | null;
  message: string;
  is_read: boolean;
  created_at: string;
}

interface NotificationDropdownProps {
  userId: string;
  onClose: () => void;
  onCountChange: (count: number) => void;
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

function formatRelativeTime(dateString: string): string {
  const now = new Date();
  const date = new Date(dateString);
  const seconds = Math.floor((now.getTime() - date.getTime()) / 1000);

  if (seconds < 60) return 'just now';
  if (seconds < 3600) return `${Math.floor(seconds / 60)} minutes ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)} hours ago`;
  if (seconds < 604800) return `${Math.floor(seconds / 86400)} days ago`;
  return date.toLocaleDateString();
}

export default function NotificationDropdown({
  userId,
  onClose,
  onCountChange,
}: NotificationDropdownProps) {
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchNotifications() {
      const supabase = createBrowserClient();
      const { data } = await supabase
        .from('notifications')
        .select('*')
        .eq('recipient_id', userId)
        .order('created_at', { ascending: false })
        .limit(10);

      if (data) {
        setNotifications(data);
      }
      setLoading(false);
    }

    fetchNotifications();
  }, [userId]);

  async function handleNotificationClick(notification: Notification) {
    if (!notification.is_read) {
      await markNotificationRead(notification.id);
      setNotifications((prev) =>
        prev.map((n) =>
          n.id === notification.id ? { ...n, is_read: true } : n
        )
      );
      onCountChange(notifications.filter((n) => !n.is_read).length - 1);
    }
    onClose();
  }

  async function handleMarkAllAsRead() {
    await markAllNotificationsRead();
    setNotifications((prev) =>
      prev.map((n) => ({ ...n, is_read: true }))
    );
    onCountChange(0);
  }

  return (
    <>
      <div
        className="fixed inset-0 z-40"
        onClick={onClose}
        aria-hidden="true"
      />
      <div className="absolute right-0 mt-2 w-96 bg-white rounded-lg border border-gray-200 shadow-lg z-50 max-h-[32rem] flex flex-col">
        <div className="px-4 py-3 border-b border-gray-200 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-gray-900">Notifications</h3>
          {notifications.some((n) => !n.is_read) && (
            <button
              type="button"
              onClick={handleMarkAllAsRead}
              className="text-xs text-blue-600 hover:text-blue-800"
            >
              Mark all as read
            </button>
          )}
        </div>

        <div className="overflow-y-auto flex-1">
          {loading ? (
            <div className="px-4 py-8 text-center text-sm text-gray-500">
              Loading...
            </div>
          ) : notifications.length === 0 ? (
            <div className="px-4 py-8 text-center text-sm text-gray-500">
              No notifications yet
            </div>
          ) : (
            <ul className="divide-y divide-gray-100">
              {notifications.map((notification) => (
                <li key={notification.id}>
                  {notification.ticket_id ? (
                    <Link
                      href={`/tickets/${notification.ticket_id}`}
                      onClick={() => handleNotificationClick(notification)}
                      className={`block px-4 py-3 hover:bg-gray-50 transition-colors ${
                        !notification.is_read ? 'bg-blue-50' : ''
                      }`}
                    >
                      <div className="flex gap-3">
                        <span className="text-xl flex-shrink-0">
                          {getEventIcon(notification.event_type)}
                        </span>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm text-gray-900 break-words">
                            {notification.message}
                          </p>
                          <p className="text-xs text-gray-500 mt-1">
                            {formatRelativeTime(notification.created_at)}
                          </p>
                        </div>
                      </div>
                    </Link>
                  ) : (
                    <div
                      className={`px-4 py-3 ${
                        !notification.is_read ? 'bg-blue-50' : ''
                      }`}
                    >
                      <div className="flex gap-3">
                        <span className="text-xl flex-shrink-0">
                          {getEventIcon(notification.event_type)}
                        </span>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm text-gray-900 break-words">
                            {notification.message}
                          </p>
                          <p className="text-xs text-gray-500 mt-1">
                            {formatRelativeTime(notification.created_at)}
                          </p>
                        </div>
                      </div>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="px-4 py-3 border-t border-gray-200">
          <Link
            href="/notifications"
            onClick={onClose}
            className="block text-center text-sm text-blue-600 hover:text-blue-800"
          >
            View all notifications
          </Link>
        </div>
      </div>
    </>
  );
}
