'use client';

import { useState, useEffect } from 'react';
import { createBrowserClient } from '@/lib/supabase/client';
import NotificationDropdown from './NotificationDropdown';

interface NotificationBellProps {
  initialCount: number;
  userId: string;
}

export default function NotificationBell({ initialCount, userId }: NotificationBellProps) {
  const [unreadCount, setUnreadCount] = useState(initialCount);
  const [isOpen, setIsOpen] = useState(false);

  useEffect(() => {
    const supabase = createBrowserClient();

    const channel = supabase
      .channel('notifications-channel')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'notifications',
          filter: `recipient_id=eq.${userId}`,
        },
        (payload) => {
          if (payload.eventType === 'INSERT') {
            setUnreadCount((prev) => prev + 1);
          } else if (payload.eventType === 'UPDATE') {
            const newRow = payload.new as { is_read?: boolean };
            const oldRow = payload.old as { is_read?: boolean };
            if (oldRow?.is_read === false && newRow?.is_read === true) {
              setUnreadCount((prev) => Math.max(0, prev - 1));
            }
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [userId]);

  return (
    <div className="relative">
      <button
        type="button"
        className="relative text-gray-400 hover:text-gray-600 focus:outline-none"
        aria-label="Notifications"
        onClick={() => setIsOpen(!isOpen)}
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          className="h-5 w-5"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          aria-hidden="true"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9"
          />
        </svg>
        {unreadCount > 0 && (
          <span className="absolute -top-1 -right-1 h-4 w-4 flex items-center justify-center rounded-full bg-red-500 text-xs text-white font-medium">
            {unreadCount > 9 ? '9+' : unreadCount}
          </span>
        )}
      </button>

      {isOpen && (
        <NotificationDropdown
          userId={userId}
          onClose={() => setIsOpen(false)}
          onCountChange={setUnreadCount}
        />
      )}
    </div>
  );
}
