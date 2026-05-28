'use client';

import { useEffect, useRef } from 'react';
import { signOut } from '@/lib/actions/auth';
import { notifyPopupOpened, subscribeToOtherPopups } from '@/lib/utils/popup-coordinator';

const POPUP_ID = 'user-menu';

type Role = 'admin' | 'agent' | string;

function RoleBadge({ role }: { role: Role }) {
  if (role === 'admin') {
    return (
      <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-700">
        Admin
      </span>
    );
  }
  if (role === 'agent') {
    return (
      <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-700">
        Agent
      </span>
    );
  }
  return null;
}

interface UserMenuProps {
  displayName: string;
  role: Role | null;
  links: { href: string; label: string }[];
}

export function UserMenu({ displayName, role, links }: UserMenuProps) {
  const detailsRef = useRef<HTMLDetailsElement>(null);

  useEffect(() => {
    const details = detailsRef.current;
    if (!details) return;

    function handleToggle() {
      if (details!.open) notifyPopupOpened(POPUP_ID);
    }
    function handleClickOutside(e: MouseEvent) {
      if (details!.open && !details!.contains(e.target as Node)) {
        details!.open = false;
      }
    }
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Escape' && details!.open) {
        details!.open = false;
      }
    }
    const unsubscribeOthers = subscribeToOtherPopups(POPUP_ID, () => {
      if (details.open) details.open = false;
    });

    details.addEventListener('toggle', handleToggle);
    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleKey);
    return () => {
      details.removeEventListener('toggle', handleToggle);
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleKey);
      unsubscribeOthers();
    };
  }, []);

  return (
    <details ref={detailsRef} className="relative">
      <summary
        className="flex items-center gap-2 cursor-pointer list-none text-sm text-gray-700 hover:text-gray-900 min-h-[44px] px-2 rounded focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:outline-none"
        aria-label={`User menu for ${displayName}`}
        aria-haspopup="true"
      >
        <span>{displayName}</span>
        {role && <RoleBadge role={role} />}
        <svg
          xmlns="http://www.w3.org/2000/svg"
          className="h-4 w-4"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          aria-hidden="true"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </summary>
      <div
        className="absolute right-0 mt-2 w-48 bg-white rounded border border-gray-200 shadow-lg py-1 z-50"
        role="menu"
      >
        {links.map((link) => (
          <a
            key={link.href}
            href={link.href}
            className="block px-4 py-2 text-sm text-gray-700 hover:bg-gray-50 min-h-[44px] flex items-center focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-blue-500 focus-visible:outline-none"
            role="menuitem"
          >
            {link.label}
          </a>
        ))}
        <form action={signOut}>
          <button
            type="submit"
            className="w-full text-left block px-4 py-2 text-sm text-gray-700 hover:bg-gray-50 min-h-[44px] flex items-center focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-blue-500 focus-visible:outline-none"
            role="menuitem"
          >
            Sign out
          </button>
        </form>
      </div>
    </details>
  );
}
