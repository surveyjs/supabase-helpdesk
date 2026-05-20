import Link from 'next/link';
import { getUser, getProfile } from '@/lib/supabase/auth';
import { signOut } from '@/lib/actions/auth';
import { getUnreadCount } from '@/lib/actions/notifications';
import { NotificationBell } from '@/components/features/notifications/NotificationBell';
import { createServerClient } from '@/lib/supabase/server';
import { MobileMenu } from './MobileMenu';
import { TopNavLinks } from './TopNavLinks';

function RoleBadge({ role }: { role: string }) {
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

export default async function NavBar() {
  const user = await getUser();
  const profile = user ? await getProfile() : null;
  const unreadCount = user ? await getUnreadCount() : 0;

  // Check KB visibility
  const supabase = await createServerClient();
  const { data: kbSetting } = await supabase
    .from('app_settings')
    .select('value')
    .eq('key', 'kb_visible')
    .single();
  const kbVisible = kbSetting?.value === 'true';

  const displayName = profile?.display_name || user?.email || '';
  const isAgent = profile && ['agent', 'admin'].includes(profile.role);
  const isAdmin = profile && profile.role === 'admin';

  // Build nav links for both desktop and mobile (top-level navigation bar)
  const navLinks: { href: string; label: string }[] = [];
  // Regular users see "My Tickets" in top nav; agents/admins get it in the user menu instead
  if (user && !isAgent) navLinks.push({ href: '/tickets', label: 'My Tickets' });
  if (isAgent) {
    navLinks.push({ href: '/agent', label: 'Agent Dashboard' });
  }
  if (kbVisible) navLinks.push({ href: '/help', label: 'Help Center' });
  if (isAgent) {
    navLinks.push({ href: '/kb/manage', label: 'Manage Articles' });
  }

  // Build user menu links (inside the dropdown)
  const userMenuLinks: { href: string; label: string }[] = [];
  // Admin: Setup is first
  if (isAdmin) {
    userMenuLinks.push({ href: '/admin', label: 'Setup' });
  }
  // Agents/admins: My Tickets, Reports, Canned Responses
  if (isAgent) {
    userMenuLinks.push({ href: '/tickets', label: 'My Tickets' });
    userMenuLinks.push({ href: '/reports', label: 'Reports' });
    userMenuLinks.push({ href: '/canned-responses', label: 'Canned Responses' });
  }
  // All users: Profile, Notification Settings
  userMenuLinks.push({ href: '/profile', label: 'Profile' });
  userMenuLinks.push({ href: '/notification-settings', label: 'Notification Settings' });

  return (
    <nav className="bg-white border-b border-gray-200 px-4 py-3 relative" aria-label="Main navigation">
      <div className="max-w-5xl mx-auto flex items-center justify-between">
        {/* Left side */}
        <div className="flex items-center gap-4">
          <Link href="/" className="text-lg font-semibold text-gray-900 focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:outline-none rounded">
            HelpDesk
          </Link>
          {/* Mobile hamburger */}
          <MobileMenu links={navLinks} />
          {/* Desktop links */}
          <TopNavLinks links={navLinks} />
        </div>

        {/* Right side */}
        <div className="flex items-center gap-3">
          {user ? (
            <>
              {/* Notification bell */}
              <NotificationBell initialUnreadCount={unreadCount} userId={user.id} />

              {/* User info with dropdown */}
              <div className="hidden sm:flex items-center gap-2">
                <details className="relative">
                  <summary className="flex items-center gap-2 cursor-pointer list-none text-sm text-gray-700 hover:text-gray-900 min-h-[44px] px-2 rounded focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:outline-none" aria-label={`User menu for ${displayName}`} aria-haspopup="true">
                    <span>{displayName}</span>
                    {profile && <RoleBadge role={profile.role} />}
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                    </svg>
                  </summary>
                  <div className="absolute right-0 mt-2 w-48 bg-white rounded border border-gray-200 shadow-lg py-1 z-50" role="menu">
                    {userMenuLinks.map((link) => (
                      <a key={link.href} href={link.href} className="block px-4 py-2 text-sm text-gray-700 hover:bg-gray-50 min-h-[44px] flex items-center focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-blue-500 focus-visible:outline-none" role="menuitem">
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
              </div>
            </>
          ) : (
            <a href="/login" className="text-sm text-blue-600 hover:text-blue-800 min-h-[44px] flex items-center focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:outline-none rounded px-2">
              Log in
            </a>
          )}
        </div>
      </div>
    </nav>
  );
}
