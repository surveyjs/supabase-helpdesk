import Link from 'next/link';
import { getUser, getProfile } from '@/lib/supabase/auth';
import { signOut } from '@/lib/actions/auth';

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
        </div>

        {/* Right side */}
        <div className="flex items-center gap-3">
          {user ? (
            <>
              {/* Notification bell placeholder */}
              <span className="text-gray-400" aria-label="Notifications">
                <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
                </svg>
              </span>

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
