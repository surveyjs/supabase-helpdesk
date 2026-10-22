import { runtimeConfig } from '@/lib/runtime-config';

// Public, per-instance settings for the browser bundle, loaded before
// hydration by <Script strategy="beforeInteractive"> in the root layout. The
// image is shared by every instance, so these cannot be inlined at build time.
export const dynamic = 'force-dynamic';

export function GET() {
  const { browserSupabaseUrl, anonKey, authCookieName } = runtimeConfig();
  const json = JSON.stringify({ supabaseUrl: browserSupabaseUrl, supabaseAnonKey: anonKey, authCookieName })
    .replace(/</g, '\\u003c');
  return new Response(`window.__HELPDESK_CONFIG__=${json};`, {
    headers: { 'content-type': 'text/javascript; charset=utf-8', 'cache-control': 'no-store' },
  });
}
