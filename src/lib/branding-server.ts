import { cache } from 'react';
import { createServiceRoleClient } from '@/lib/supabase/server';
import { BRANDING_KEY, DEFAULT_BRANDING, parseBranding, type Branding } from '@/lib/branding';

/**
 * The instance's branding (#2), read once per request. Uses the service role:
 * app_settings is not readable when signed out, and the login page needs the
 * name and colour too. Falls back to the defaults on any error.
 */
export const getBranding = cache(async (): Promise<Branding> => {
  try {
    const { data } = await createServiceRoleClient()
      .from('app_settings')
      .select('value')
      .eq('key', BRANDING_KEY)
      .maybeSingle();
    return parseBranding(data?.value);
  } catch {
    return { ...DEFAULT_BRANDING };
  }
});
