import { createBrowserClient as _createBrowserClient } from '@supabase/ssr';

declare global {
  interface Window {
    __HELPDESK_CONFIG__?: { supabaseUrl: string; supabaseAnonKey: string; authCookieName: string };
  }
}

// Settings come from /runtime-config.js (see src/app/runtime-config.js/route.ts).
export function createBrowserClient() {
  const config = window.__HELPDESK_CONFIG__;
  if (!config) throw new Error('/runtime-config.js has not been loaded');
  return _createBrowserClient(config.supabaseUrl, config.supabaseAnonKey, {
    cookieOptions: { name: config.authCookieName },
  });
}
