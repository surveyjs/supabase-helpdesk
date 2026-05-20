'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { isActivePath } from './nav-utils';

type NavLink = {
  href: string;
  label: string;
};

export function TopNavLinks({ links }: { links: NavLink[] }) {
  const pathname = usePathname();

  return (
    <div className="hidden md:flex items-center gap-4">
      {links.map((link) => {
        const isActive = isActivePath(pathname, link.href);
        return (
          <Link
            key={link.href}
            href={link.href}
            className={`text-sm focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:outline-none rounded px-2 py-1 ${
              isActive
                ? 'bg-blue-50 text-blue-700 font-medium'
                : 'text-gray-600 hover:text-gray-900'
            }`}
            aria-current={isActive ? 'page' : undefined}
          >
            {link.label}
          </Link>
        );
      })}
    </div>
  );
}
