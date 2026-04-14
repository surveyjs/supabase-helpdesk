import { getProfile, requireAuth } from '@/lib/supabase/auth';

export default async function HomePage() {
  await requireAuth();
  const profile = await getProfile();
  const displayName = profile?.display_name || 'there';

  return (
    <div className="flex flex-col items-center justify-center py-20">
      <h1 className="text-3xl font-semibold text-gray-900">
        Welcome, {displayName}
      </h1>
      <p className="mt-4 text-gray-600">
        A customer-support ticket system.
      </p>
    </div>
  );
}
