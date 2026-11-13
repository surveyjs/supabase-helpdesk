import { cache } from 'react';
import { redirect } from 'next/navigation';
import { createServerClient } from './server';

/** Where a freshly signed-in user lands: agents/admins go straight to /agent (page `/` would redirect them there anyway). */
export function homePathForRole(role: string | null | undefined): string {
  return role === 'agent' || role === 'admin' ? '/agent' : '/';
}

// React cache() memoises per server request only (never across requests or users), so the
// layout, NavBar and page share one auth round trip and one profile select.
export const getUser = cache(async () => {
  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  return user;
});

export const getProfile = cache(async () => {
  const user = await getUser();
  if (!user) return null;
  const supabase = await createServerClient();
  const { data } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', user.id)
    .single();
  return data;
});

export async function requireAuth() {
  const user = await getUser();
  if (!user) redirect('/login');
  return user;
}

export async function requireAgent() {
  const user = await getUser();
  if (!user) redirect('/login');
  const profile = await getProfile();
  if (!profile || !['agent', 'admin'].includes(profile.role)) redirect('/');
  return user;
}

export async function requireAdmin() {
  const user = await getUser();
  if (!user) redirect('/login');
  const profile = await getProfile();
  if (!profile || profile.role !== 'admin') redirect('/');
  return user;
}
