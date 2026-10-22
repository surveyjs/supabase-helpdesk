// Where the app reaches Supabase. Shared by the Next.js app
// (src/lib/runtime-config.ts) and the container scripts (docker/*.mjs; the
// Dockerfile copies this directory to /app/docker/lib).
//
//   SUPABASE_URL set   -> external Supabase (Cloud or self-hosted elsewhere):
//                         browser and server both use it.
//   SUPABASE_URL unset -> bundled stack on the app's own domain: the browser
//                         uses APP_URL (the reverse proxy routes /auth/v1,
//                         /rest/v1, /storage/v1 and /realtime/v1 to Kong) and
//                         the server uses SUPABASE_INTERNAL_URL (http://kong:8000).

/** @param {string | undefined} value */
function url(value) {
  return (value ?? '').trim().replace(/\/+$/, '');
}

/**
 * @param {Record<string, string | undefined>} env
 * @returns {{ appUrl: string, browserSupabaseUrl: string, serverSupabaseUrl: string,
 *   anonKey: string, serviceRoleKey: string, authCookieName: string }}
 */
export function resolveSupabaseEnv(env) {
  const appUrl = url(env.APP_URL);
  const external = url(env.SUPABASE_URL);
  const internal = url(env.SUPABASE_INTERNAL_URL);
  const anonKey = (env.SUPABASE_ANON_KEY ?? '').trim();

  const missing = [];
  if (!appUrl) missing.push('APP_URL');
  if (!external && !internal) {
    missing.push('SUPABASE_URL (external Supabase) or SUPABASE_INTERNAL_URL (bundled stack)');
  }
  if (!anonKey) missing.push('SUPABASE_ANON_KEY');
  if (missing.length) throw new Error(`Missing environment variables: ${missing.join(', ')}`);

  if (!external && new URL(appUrl).pathname !== '/') {
    throw new Error(`APP_URL must not contain a path when Supabase is served on the app's domain: ${appUrl}`);
  }

  const browserSupabaseUrl = external || appUrl;
  return {
    appUrl,
    browserSupabaseUrl,
    serverSupabaseUrl: external || internal,
    anonKey,
    serviceRoleKey: (env.SUPABASE_SERVICE_ROLE_KEY ?? '').trim(),
    // supabase-js derives its default storage key from the URL's hostname
    // (sb-<first label>-auth-token). Pin it to the browser URL so a server that
    // talks to kong:8000 still reads the browser's session cookie.
    authCookieName: `sb-${new URL(browserSupabaseUrl).hostname.split('.')[0]}-auth-token`,
  };
}
