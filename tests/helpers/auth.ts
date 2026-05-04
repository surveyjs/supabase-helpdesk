import type { Page } from '@playwright/test';
import { createServiceRoleClient } from './supabase';

/**
 * Reset auth-mode-related app_settings to the built-in defaults.
 *
 * Some specs (notably auth-external.spec.ts) flip `auth_mode` to `external`
 * and enable `auth_external_auto_redirect`. If those tests time out or crash
 * mid-run, their `afterAll` cleanup is skipped and `app_settings` stays
 * polluted, causing every subsequent `loginAs` helper to either render the
 * external SSO button (no email/password form) or auto-redirect to the
 * upstream OIDC `/auth/v1/authorize` endpoint.
 *
 * Call this before navigating to `/login` from any test that needs the
 * built-in email/password form.
 */
export async function ensureBuiltInAuthMode(): Promise<void> {
  const svc = createServiceRoleClient();
  await svc.from('app_settings').update({ value: 'built-in' }).eq('key', 'auth_mode');
  await svc
    .from('app_settings')
    .update({ value: 'false' })
    .eq('key', 'auth_external_auto_redirect');
}

/**
 * Navigate to a path that requires authentication. If the auth middleware
 * bounces the page to `/login` (transient session-cookie race seen under load
 * with the dev server), re-run the supplied `relogin` callback once and
 * retry. This is a narrowly-scoped defense against post-login session loss
 * — do not use it to mask real auth bugs.
 */
export async function gotoAuthed(
  page: Page,
  path: string,
  relogin: () => Promise<void>,
): Promise<void> {
  await page.goto(path);
  if (page.url().includes('/login')) {
    await relogin();
    await page.goto(path);
  }
}
