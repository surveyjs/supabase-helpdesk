import { resolveSupabaseEnv } from './deploy/env.mjs';

/**
 * Instance configuration, read from the environment at request time. Nothing
 * here is inlined by `next build`, so one image serves every instance.
 */
export function runtimeConfig() {
  return resolveSupabaseEnv(process.env);
}

/**
 * Server-side Supabase clients talk to serverSupabaseUrl (http://kong:8000 in
 * the bundled stack), so URLs they mint (signed Storage URLs) carry that host.
 * Rewrite them to the browser-reachable address before they leave the server.
 */
export function toBrowserUrl(url: string): string {
  const { serverSupabaseUrl, browserSupabaseUrl } = runtimeConfig();
  if (serverSupabaseUrl === browserSupabaseUrl || !url.startsWith(serverSupabaseUrl)) return url;
  return browserSupabaseUrl + url.slice(serverSupabaseUrl.length);
}

/**
 * JavaScript that defines window.__HELPDESK_CONFIG__ for the browser bundle.
 * Used both inline by the root layout and by GET /runtime-config.js.
 */
export function runtimeConfigScript(): string {
  const { browserSupabaseUrl, anonKey, authCookieName } = runtimeConfig();
  const json = JSON.stringify({ supabaseUrl: browserSupabaseUrl, supabaseAnonKey: anonKey, authCookieName })
    .replace(/</g, '\\u003c');
  return `window.__HELPDESK_CONFIG__=${json};`;
}

export function serviceRoleKey(): string {
  const key = runtimeConfig().serviceRoleKey;
  if (!key) throw new Error('Missing environment variable: SUPABASE_SERVICE_ROLE_KEY');
  return key;
}
