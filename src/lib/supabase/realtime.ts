import type { createBrowserClient } from '@/lib/supabase/client';

/**
 * Put the signed-in user's JWT on the Realtime socket before a channel joins.
 *
 * supabase-js only forwards the session token once its auth state events fire.
 * A channel that joins earlier runs as `anon`, so RLS drops every
 * postgres_changes event while the channel still reports SUBSCRIBED. Later
 * TOKEN_REFRESHED events are forwarded by supabase-js itself.
 */
export async function authorizeRealtime(
  supabase: ReturnType<typeof createBrowserClient>,
): Promise<void> {
  const { data } = await supabase.auth.getSession();
  if (data.session) await supabase.realtime.setAuth(data.session.access_token);
}
