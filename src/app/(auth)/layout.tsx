import { redirect } from 'next/navigation';
import { getUser } from '@/lib/supabase/auth';

export default async function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await getUser();
  if (user) redirect('/');

  return (
    <main id="main" className="min-h-screen flex items-center justify-center bg-gray-50 px-4">
      <div className="w-full max-w-md bg-white rounded-lg border border-gray-200 p-8">
        {children}
      </div>
    </main>
  );
}
