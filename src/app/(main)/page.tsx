import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getProfile, requireAuth } from '@/lib/supabase/auth';

export default async function HomePage() {
  await requireAuth();
  const profile = await getProfile();
  if (profile && ['agent', 'admin'].includes(profile.role)) redirect('/agent');
  const displayName = profile?.display_name || 'there';

  return (
    <div className="flex flex-col items-center justify-center py-20">
      <h1 className="text-3xl font-semibold text-gray-900">
        Welcome, {displayName}
      </h1>
      <p className="mt-4 text-gray-600">
        A customer-support ticket system.
      </p>
      <div className="mt-6 flex flex-wrap items-center justify-center gap-4">
        <Link
          href="/tickets/new"
          className="inline-flex items-center min-h-[44px] px-4 rounded bg-blue-600 text-sm font-medium text-white hover:bg-blue-700 focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 focus-visible:outline-none"
        >
          New ticket
        </Link>
        <Link
          href="/tickets"
          className="inline-flex items-center min-h-[44px] px-2 text-sm text-blue-600 hover:text-blue-800 rounded focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:outline-none"
        >
          My tickets
        </Link>
      </div>
    </div>
  );
}
