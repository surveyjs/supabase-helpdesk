import type { Page } from '@playwright/test';
import { expect } from '@playwright/test';
import { createServiceRoleClient } from './supabase';

/**
 * `page.goto` with retries for transient `ERR_CONNECTION_REFUSED`. The
 * Next.js prod server occasionally crashes mid-run on Windows with a libuv
 * `UV_HANDLE_CLOSING` assertion (exit code 0xC0000409). The wrapper script
 * `tests/e2e/run-server.mjs` auto-restarts `next start` when this happens;
 * this helper waits for the restart so in-flight tests survive it.
 */
async function gotoWithRetry(page: Page, url: string, attempts = 5): Promise<void> {
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      await page.goto(url);
      return;
    } catch (err) {
      lastErr = err;
      const msg = (err as Error)?.message ?? '';
      if (!/ERR_CONNECTION_REFUSED|ERR_EMPTY_RESPONSE|net::ERR/.test(msg)) {
        throw err;
      }
      // Server restart usually takes a few seconds; back off then retry.
      await new Promise((resolve) => setTimeout(resolve, 2000 * (i + 1)));
    }
  }
  throw lastErr;
}

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
 * Robust email/password login used by every spec.
 *
 * Resilient to the four failure modes seen under parallel load:
 *   1. `auth_mode` left as `external` by another worker (no Email field on
 *      `/login`)  → ensureBuiltInAuthMode() before navigating.
 *   2. `login_attempts` lockout from another worker that ran the same email
 *      with a wrong password  → delete throttle rows for this email.
 *   3. Stale cookies from a prior test in the same worker rendering `/`
 *      already-authenticated  → clear page context cookies first so the
 *      Email field is guaranteed to render.
 *   4. Transient "Invalid email or password" alert (rare race against the
 *      profile/login_attempts upserts)  → retry once with throttle re-cleared.
 *
 * Spec-level `loginAs(page, email)` should delegate to this helper instead
 * of reimplementing the dance.
 */
export async function loginViaForm(
  page: Page,
  email: string,
  password = 'Password123',
): Promise<void> {
  const svc = createServiceRoleClient();
  await ensureBuiltInAuthMode();
  await svc.from('login_attempts').delete().eq('email', email.toLowerCase());
  await page.context().clearCookies();

  const submit = async (): Promise<boolean> => {
    await gotoWithRetry(page, '/login');
    // Another worker (typically auth-external.spec.ts) can flip `auth_mode`
    // back to `external` between our ensureBuiltInAuthMode() call above and
    // this navigation, in which case `/login` renders only the SSO button
    // and there is no Email field. Detect that and force built-in mode again.
    try {
      await expect(page.getByLabel('Email')).toBeVisible({ timeout: 5000 });
    } catch {
      await ensureBuiltInAuthMode();
      await gotoWithRetry(page, '/login');
      await expect(page.getByLabel('Email')).toBeVisible({ timeout: 10000 });
    }
    await page.getByLabel('Email').fill(email);
    await page.getByLabel('Password').fill(password);
    await page.getByRole('button', { name: 'Log in' }).click();
    // Race the success URL against the failure alert. Whichever fires first
    // wins; we never block for the full 10s on a guaranteed failure.
    const result = await Promise.race([
      page
        .waitForURL('/', { timeout: 10000 })
        .then(() => 'ok' as const)
        .catch(() => 'timeout' as const),
      page
        .getByRole('alert')
        .waitFor({ state: 'visible', timeout: 10000 })
        .then(() => 'alert' as const)
        .catch(() => 'no-alert' as const),
    ]);
    return result === 'ok';
  };

  if (!(await submit())) {
    // Re-clear the throttle and try once more.
    await svc.from('login_attempts').delete().eq('email', email.toLowerCase());
    if (!(await submit())) {
      // Final assertion provides the diagnostic in the test report.
      await expect(page).toHaveURL('/', { timeout: 5000 });
    }
  }

  await expect(page.locator('summary[aria-haspopup="true"]')).toBeVisible({ timeout: 15000 });
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
