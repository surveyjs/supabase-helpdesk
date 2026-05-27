'use client';

import { useEffect, useState, useRef } from 'react';
import { createBrowserClient } from '@/lib/supabase/client';
import { notifyPopupOpened, subscribeToOtherPopups } from '@/lib/utils/popup-coordinator';
import { NotificationDropdown, type Notification } from './NotificationDropdown';

const POPUP_ID = 'notifications';

interface NotificationBellProps {
  initialUnreadCount: number;
  userId: string;
}

export function NotificationBell({ initialUnreadCount, userId }: NotificationBellProps) {
  const [unreadCount, setUnreadCount] = useState(initialUnreadCount);
  const [isOpen, setIsOpen] = useState(false);
  const [dropdownNotifications, setDropdownNotifications] = useState<Notification[] | null>(null);
  const bellRef = useRef<HTMLDivElement>(null);

  async function handleToggle() {
    if (!isOpen) {
      // Fetch notifications before opening
      const supabase = createBrowserClient();
      const { data } = await supabase
        .from('notifications')
        .select('id, event_type, ticket_id, message, is_read, created_at')
        .eq('recipient_id', userId)
        .order('created_at', { ascending: false })
        .limit(10);
      setDropdownNotifications(data ?? []);
      notifyPopupOpened(POPUP_ID);
    }
    setIsOpen((prev) => !prev);
  }

  // Subscribe to realtime notification changes
  useEffect(() => {
    const supabase = createBrowserClient();
    const channel = supabase
      .channel('notifications-bell')
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'notifications',
          filter: `recipient_id=eq.${userId}`,
        },
        () => {
          setUnreadCount((prev) => prev + 1);
        },
      )
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'notifications',
          filter: `recipient_id=eq.${userId}`,
        },
        (payload) => {
          const newRow = payload.new as { is_read?: boolean };
          const oldRow = payload.old as { is_read?: boolean };
          if (newRow.is_read && !oldRow.is_read) {
            setUnreadCount((prev) => Math.max(0, prev - 1));
          }
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [userId]);

  // Close dropdown on outside click
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (bellRef.current && !bellRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Close when another popup opens
  useEffect(() => {
    return subscribeToOtherPopups(POPUP_ID, () => setIsOpen(false));
  }, []);

  return (
    <div ref={bellRef} className="relative">
      <button
        type="button"
        onClick={handleToggle}
        className="relative text-gray-500 hover:text-gray-700 min-h-[44px] min-w-[44px] flex items-center justify-center rounded focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:outline-none"
        aria-label={`Notifications${unreadCount > 0 ? `, ${unreadCount} unread` : ''}`}
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
          <span className="absolute -top-1 -right-1 inline-flex items-center justify-center h-4 min-w-4 px-1 text-xs font-bold text-white bg-red-600 rounded-full">
            {unreadCount > 99 ? '99+' : unreadCount}
          </span>
        )}
      </button>

      {isOpen && dropdownNotifications && (
        <NotificationDropdown
          initialNotifications={dropdownNotifications}
          onClose={() => setIsOpen(false)}
          onMarkAllRead={() => setUnreadCount(0)}
        />
      )}
    </div>
  );
}
