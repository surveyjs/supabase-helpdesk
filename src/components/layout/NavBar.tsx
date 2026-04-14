import Link from 'next/link';
import { getUser, getProfile } from '@/lib/supabase/auth';
import { signOut } from '@/lib/actions/auth';
import { getUnreadCount } from '@/lib/actions/notifications';
import { NotificationBell } from '@/components/features/notifications/NotificationBell';
import { createServerClient } from '@/lib/supabase/server';

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

  return (
    <nav className="bg-white border-b border-gray-200 px-4 py-3" aria-label="Main navigation">
      <div className="max-w-5xl mx-auto flex items-center justify-between">
        {/* Left side */}
        <div className="flex items-center gap-4">
          <Link href="/" className="text-lg font-semibold text-gray-900">
            HelpDesk
          </Link>
          {user && (
            <Link href="/tickets" className="text-sm text-gray-600 hover:text-gray-900">
              My Tickets
            </Link>
          )}
          {profile && ['agent', 'admin'].includes(profile.role) && (
            <Link href="/agent" className="text-sm text-gray-600 hover:text-gray-900">
              Agent Dashboard
            </Link>
          )}
          {profile && profile.role === 'admin' && (
            <Link href="/admin" className="text-sm text-gray-600 hover:text-gray-900">
              Setup
            </Link>
          )}
          {kbVisible && (
            <Link href="/help" className="text-sm text-gray-600 hover:text-gray-900">
              Help Center
            </Link>
          )}
          {profile && ['agent', 'admin'].includes(profile.role) && (
            <Link href="/kb/manage" className="text-sm text-gray-600 hover:text-gray-900">
              Manage Articles
            </Link>
          )}
          {profile && ['agent', 'admin'].includes(profile.role) && (
            <Link href="/reports" className="text-sm text-gray-600 hover:text-gray-900">
              Reports
            </Link>
          )}
          {profile && ['agent', 'admin'].includes(profile.role) && (
            <Link href="/canned-responses" className="text-sm text-gray-600 hover:text-gray-900">
              Canned Responses
            </Link>
          )}
        </div>

        {/* Right side */}
        <div className="flex items-center gap-3">
          {user ? (
            <>
              {/* Notification bell */}
              <NotificationBell initialUnreadCount={unreadCount} userId={user.id} />

              {/* User info with dropdown */}
              <div className="flex items-center gap-2">
                <details className="relative">
                  <summary className="flex items-center gap-2 cursor-pointer list-none text-sm text-gray-700 hover:text-gray-900">
                    <span>{displayName}</span>
                    {profile && <RoleBadge role={profile.role} />}
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                    </svg>
                  </summary>
                  <div className="absolute right-0 mt-2 w-48 bg-white rounded border border-gray-200 shadow-lg py-1 z-50">
                    <a href="/profile" className="block px-4 py-2 text-sm text-gray-700 hover:bg-gray-50">
                      Profile
                    </a>
                    <a href="/notification-settings" className="block px-4 py-2 text-sm text-gray-700 hover:bg-gray-50">
                      Notification Settings
                    </a>
                  </div>
                </details>
              </div>

              {/* Sign out — always visible, outside dropdown */}
              <form action={signOut}>
                <button
                  type="submit"
                  className="text-sm text-gray-600 hover:text-gray-900 px-2 py-1 rounded hover:bg-gray-100"
                >
                  Sign out
                </button>
              </form>
            </>
          ) : (
            <a href="/login" className="text-sm text-blue-600 hover:text-blue-800">
              Log in
            </a>
          )}
        </div>
      </div>
    </nav>
  );
}
