'use client';

import { useState, type ReactNode } from 'react';
import { TICKET_DETAILS_COLLAPSED_COOKIE } from './ticket-details-cookie';

const EXPANDED_ASIDE =
  'w-full lg:w-[400px] lg:min-w-[400px] lg:max-w-[400px] flex-shrink-0 lg:sticky lg:top-4 lg:self-start';
const COLLAPSED_ASIDE = 'w-full lg:w-auto flex-shrink-0 lg:sticky lg:top-4 lg:self-start';

/**
 * The ticket's right-hand details panel, collapsible (#114). Collapsed, it is a
 * narrow vertical "Ticket details" bar on wide screens (the thread gets the
 * width) and a one-line bar on narrow ones. The content stays mounted while
 * collapsed so the sidebar survey keeps its state and autosave.
 */
export function TicketDetailsPanel({
  initialCollapsed,
  children,
}: {
  initialCollapsed: boolean;
  children: ReactNode;
}) {
  const [collapsed, setCollapsed] = useState(initialCollapsed);

  function toggle() {
    const next = !collapsed;
    setCollapsed(next);
    document.cookie = `${TICKET_DETAILS_COLLAPSED_COOKIE}=${next ? '1' : '0'}; path=/; max-age=31536000; samesite=lax`;
  }

  return (
    <aside
      className={collapsed ? COLLAPSED_ASIDE : EXPANDED_ASIDE}
      data-testid="ticket-sidebar"
      data-collapsed={collapsed ? 'true' : 'false'}
      aria-label="Ticket details"
    >
      <button
        type="button"
        onClick={toggle}
        aria-expanded={!collapsed}
        aria-controls="ticket-details-content"
        title={collapsed ? 'Show ticket details' : 'Hide ticket details'}
        data-testid="ticket-details-toggle"
        className={
          collapsed
            ? 'flex w-full items-center gap-2 rounded-lg border border-gray-200 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 lg:w-auto lg:flex-col lg:px-2 lg:py-3'
            : 'mb-2 ml-auto flex w-fit items-center gap-1 rounded px-2 py-1 text-xs font-medium text-gray-500 hover:bg-gray-100 hover:text-gray-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500'
        }
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 20 20"
          fill="currentColor"
          aria-hidden="true"
          className={`h-4 w-4 shrink-0 ${collapsed ? 'rotate-90 lg:rotate-180' : '-rotate-90 lg:rotate-0'}`}
        >
          <path
            fillRule="evenodd"
            d="M7.21 14.77a.75.75 0 01.02-1.06L11.168 10 7.23 6.29a.75.75 0 111.04-1.08l4.5 4.25a.75.75 0 010 1.08l-4.5 4.25a.75.75 0 01-1.06-.02z"
            clipRule="evenodd"
          />
        </svg>
        <span className={collapsed ? 'lg:[writing-mode:vertical-rl]' : undefined}>
          {collapsed ? 'Ticket details' : 'Hide details'}
        </span>
      </button>
      <div id="ticket-details-content" hidden={collapsed}>
        {children}
      </div>
    </aside>
  );
}
