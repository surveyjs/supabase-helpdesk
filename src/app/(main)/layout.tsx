import { cookies } from 'next/headers';
import NavBar from '@/components/layout/NavBar';
import { DisplayNamePrompt } from '@/components/layout/DisplayNamePrompt';
import { getProfile } from '@/lib/supabase/auth';
import { DISPLAY_NAME_DISMISS_COOKIE, needsDisplayName } from '@/lib/users/display-name';

export default async function MainLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const profile = await getProfile();
  const showPrompt =
    !!profile &&
    needsDisplayName(profile) &&
    !(await cookies()).has(DISPLAY_NAME_DISMISS_COOKIE);

  return (
    <>
      <NavBar />
      {showPrompt && <DisplayNamePrompt currentName={profile.display_name || profile.email} />}
      <main id="main" className="flex-1 max-w-5xl mx-auto w-full px-4 py-6">
        {children}
      </main>
    </>
  );
}
