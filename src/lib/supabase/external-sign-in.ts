import type { SupabaseClient } from '@supabase/supabase-js';
import { EXTERNAL_PROVIDER_ID } from '@/lib/auth/external-provider';

/**
 * Starts the OAuth flow with the `custom:external` provider registered in
 * Supabase Auth. On success the browser navigates away; an error is only
 * returned for failures before the redirect (e.g. provider disabled).
 */
export async function signInWithExternalProvider(supabase: SupabaseClient): Promise<{ error?: string }> {
  const redirectTo = `${window.location.origin}/auth/callback`;
  const { error } = await supabase.auth.signInWithOAuth({
    provider: EXTERNAL_PROVIDER_ID,
    options: { redirectTo },
  });
  return error ? { error: error.message } : {};
}
