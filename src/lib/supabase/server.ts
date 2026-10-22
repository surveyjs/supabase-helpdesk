import { createServerClient as _createServerClient } from '@supabase/ssr';
import { createClient } from '@supabase/supabase-js';
import { cookies } from 'next/headers';
import { runtimeConfig, serviceRoleKey } from '@/lib/runtime-config';

export async function createServerClient() {
  const cookieStore = await cookies();
  const { serverSupabaseUrl, anonKey, authCookieName } = runtimeConfig();
  return _createServerClient(
    serverSupabaseUrl,
    anonKey,
    {
      cookieOptions: { name: authCookieName },
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) => {
              cookieStore.set(name, value, options);
            });
          } catch {
            // setAll called from a Server Component — cookies are read-only.
            // Safe to ignore when middleware handles session refresh.
          }
        },
      },
    }
  );
}

export function createServiceRoleClient() {
  return createClient(runtimeConfig().serverSupabaseUrl, serviceRoleKey());
}
