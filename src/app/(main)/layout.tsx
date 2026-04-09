import { redirect } from 'next/navigation';
import { getUser } from '@/lib/supabase/auth';
import NavBar from '@/components/layout/NavBar';

export default async function MainLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await getUser();
  if (!user) redirect('/login');

  return (
    <>
      <NavBar />
      <main className="flex-1 max-w-5xl mx-auto w-full px-4 py-6">
        {children}
      </main>
    </>
  );
}
