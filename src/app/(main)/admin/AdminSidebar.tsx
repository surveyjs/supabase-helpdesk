'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useId, useMemo, useState } from 'react';

type AdminLink = { label: string; href: string };
type AdminGroup = { heading: string; links: AdminLink[] };

const GROUPS: AdminGroup[] = [
  {
    heading: 'Ticket Structure',
    links: [
      { label: 'Ticket Types', href: '/admin/types' },
      { label: 'Categories', href: '/admin/categories' },
      { label: 'Tags', href: '/admin/tags' },
      { label: 'Custom Fields', href: '/admin/custom-fields' },
      { label: 'Ticket Privacy', href: '/admin/privacy' },
    ],
  },
  {
    heading: 'People & Access',
    links: [
      { label: 'User Management', href: '/admin/users' },
      { label: 'Agents & Admins', href: '/admin/agents' },
      { label: 'Teams', href: '/admin/teams' },
      { label: 'Authentication', href: '/admin/auth' },
      { label: 'Subscription Tiers', href: '/admin/tiers' },
    ],
  },
  {
    heading: 'Workflow & SLAs',
    links: [
      { label: 'SLA Policies', href: '/admin/sla' },
      { label: 'CSAT Settings', href: '/admin/csat' },
      { label: 'Templates', href: '/admin/templates' },
    ],
  },
  {
    heading: 'Channels & Communication',
    links: [
      { label: 'Email', href: '/admin/email' },
      { label: 'Inbound Email', href: '/admin/inbound-email' },
      { label: 'AI Configuration', href: '/admin/ai' },
    ],
  },
  {
    heading: 'Knowledge Base',
    links: [{ label: 'KB Categories', href: '/admin/kb-categories' }],
  },
  {
    heading: 'System Limits & Uploads',
    links: [
      { label: 'Pagination', href: '/admin/pagination' },
      { label: 'Rate Limit', href: '/admin/rate-limit' },
      { label: 'File Uploads', href: '/admin/file-settings' },
    ],
  },
  {
    heading: 'Appearance & UX',
    links: [
      { label: 'Survey UI Config', href: '/admin/survey-ui' },
      { label: 'Survey Templates', href: '/admin/survey-templates' },
      { label: 'User Settings', href: '/admin/user-settings' },
    ],
  },
  {
    heading: 'Audit & Compliance',
    links: [{ label: 'Audit Log', href: '/admin/audit-log' }],
  },
];

const ALL_LINKS: AdminLink[] = GROUPS.flatMap((g) => g.links);

export function AdminSidebar() {
  const pathname = usePathname();
  const [query, setQuery] = useState('');
  const filterId = useId();
  const navId = useId();

  const currentSection = ALL_LINKS.find(
    (s) => pathname === s.href || pathname.startsWith(s.href + '/'),
  );

  const filteredGroups = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return GROUPS;
    return GROUPS.map((g) => ({
      ...g,
      links: g.links.filter((l) => l.label.toLowerCase().includes(q)),
    })).filter((g) => g.links.length > 0);
  }, [query]);

  return (
    <>
      {/* Mobile: dropdown select with optgroups */}
      <div className="md:hidden mb-4 w-full">
        <label
          htmlFor="admin-mobile-nav"
          className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2"
        >
          Setup
        </label>
        <select
          id="admin-mobile-nav"
          className="w-full rounded border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none min-h-[44px]"
          value={currentSection?.href ?? ALL_LINKS[0].href}
          onChange={(e) => {
            window.location.href = e.target.value;
          }}
          aria-label="Admin navigation"
        >
          {GROUPS.map((group) => (
            <optgroup key={group.heading} label={group.heading}>
              {group.links.map((link) => (
                <option key={link.href} value={link.href}>
                  {link.label}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
      </div>

      {/* Desktop: sidebar */}
      <nav
        className="hidden md:block w-56 shrink-0 border-r border-gray-200 pr-4"
        aria-label="Admin navigation"
      >
        <h2 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">
          Setup
        </h2>

        <div className="mb-3">
          <label htmlFor={filterId} className="sr-only">
            Filter settings
          </label>
          <input
            id={filterId}
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Filter settings…"
            aria-controls={navId}
            className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none"
          />
        </div>

        <div id={navId} className="space-y-4">
          {filteredGroups.length === 0 ? (
            <p className="text-sm text-gray-500 px-3 py-2">No matches.</p>
          ) : (
            filteredGroups.map((group) => {
              const headingId = `${navId}-${group.heading.replace(/\s+/g, '-').toLowerCase()}`;
              return (
                <section key={group.heading} aria-labelledby={headingId}>
                  <h3
                    id={headingId}
                    className="text-[11px] font-semibold text-gray-500 uppercase tracking-wider mb-1.5 px-3"
                  >
                    {group.heading}
                  </h3>
                  <ul className="space-y-0.5">
                    {group.links.map((link) => {
                      const isActive =
                        pathname === link.href || pathname.startsWith(link.href + '/');
                      return (
                        <li key={link.href}>
                          <Link
                            href={link.href}
                            className={`block px-3 py-2 rounded text-sm focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:outline-none ${
                              isActive
                                ? 'bg-blue-50 text-blue-700 font-medium'
                                : 'text-gray-700 hover:bg-gray-50 hover:text-gray-900'
                            }`}
                            aria-current={isActive ? 'page' : undefined}
                          >
                            {link.label}
                          </Link>
                        </li>
                      );
                    })}
                  </ul>
                </section>
              );
            })
          )}
        </div>
      </nav>
    </>
  );
}
