'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const SECTIONS = [
  { label: 'Ticket Types', href: '/admin/types' },
  { label: 'Categories', href: '/admin/categories' },
  { label: 'Tags', href: '/admin/tags' },
  { label: 'Teams', href: '/admin/teams' },
  { label: 'Agents & Admins', href: '/admin/agents' },
  { label: 'Custom Fields', href: '/admin/custom-fields' },
  { label: 'Ticket Privacy', href: '/admin/privacy' },
  { label: 'Pagination', href: '/admin/pagination' },
  { label: 'Rate Limit', href: '/admin/rate-limit' },
  { label: 'File Uploads', href: '/admin/file-settings' },
  { label: 'Templates', href: '/admin/templates' },
  { label: 'Duplicate Template', href: '/admin/duplicate-template' },
  { label: 'User Settings', href: '/admin/user-settings' },
  { label: 'Audit Log', href: '/admin/audit-log' },
];

export function AdminSidebar() {
  const pathname = usePathname();

  return (
    <nav
      className="w-56 shrink-0 border-r border-gray-200 pr-4"
      aria-label="Admin navigation"
    >
      <h2 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">
        Setup
      </h2>
      <ul className="space-y-0.5">
        {SECTIONS.map((section) => {
          const isActive = pathname === section.href || pathname.startsWith(section.href + '/');
          return (
            <li key={section.href}>
              <Link
                href={section.href}
                className={`block px-3 py-2 rounded text-sm ${
                  isActive
                    ? 'bg-blue-50 text-blue-700 font-medium'
                    : 'text-gray-700 hover:bg-gray-50 hover:text-gray-900'
                }`}
                aria-current={isActive ? 'page' : undefined}
              >
                {section.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
