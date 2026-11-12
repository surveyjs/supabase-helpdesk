import { createBrowserClient as _createBrowserClient } from '@supabase/ssr';

declare global {
  interface Window {
    __HELPDESK_CONFIG__?: { supabaseUrl: string; supabaseAnonKey: string; authCookieName: string };
  }
}

// Settings come from the inline config script in the root layout's <head>.
export function createBrowserClient() {
  const config = window.__HELPDESK_CONFIG__;
  if (!config) throw new Error('HelpDesk runtime config (inline <head> script) is missing');
  return _createBrowserClient(config.supabaseUrl, config.supabaseAnonKey, {
    cookieOptions: { name: config.authCookieName },
  });
}
