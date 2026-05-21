import { test, expect, Page } from '@playwright/test';
import { ensureBuiltInAuthMode, loginViaForm } from '../helpers/auth';

const SEED_PASSWORD = 'Password123';

async function loginAs(page: Page, email: string) {
  const { createServiceRoleClient } = await import('../helpers/supabase');
  const svc = createServiceRoleClient();

  // Ensure profile exists so /profile does not redirect through /login back to /.
  const { data: existingProfile } = await svc
    .from('profiles')
    .select('id')
    .eq('email', email.toLowerCase())
    .maybeSingle();
  if (!existingProfile) {
    const seededUserIds: Record<string, string> = {
      'admin@example.com': '00000000-0000-0000-0000-000000000011',
      'alice@example.com': '00000000-0000-0000-0000-000000000014',
    };
    const { data: users } = await svc.auth.admin.listUsers({ page: 1, perPage: 500 });
    const authUser = (users?.users ?? []).find((u) => u.email?.toLowerCase() === email.toLowerCase());
    const profileId = authUser?.id ?? seededUserIds[email.toLowerCase()];
    if (profileId) {
      await svc.from('profiles').upsert({
        id: profileId,
        email: email.toLowerCase(),
        display_name: email.split('@')[0],
        role: email.toLowerCase().includes('admin') ? 'admin' : 'user',
      });
    }
  }

  await loginViaForm(page, email, SEED_PASSWORD);
}

test.describe('Cross-Browser Smoke Tests', () => {
  test('login page loads and shows form', async ({ page }) => {
    // A parallel auth-external test may have left auth_mode='external', which
    // hides the email/password form on /login. Force built-in before navigating.
    await ensureBuiltInAuthMode();
    await page.goto('/login');
    await expect(page.getByLabel('Email')).toBeVisible();
    await expect(page.getByLabel('Password')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Log in' })).toBeVisible();
  });

  test('signup page loads', async ({ page }) => {
    // Ensure built-in auth so the standard signup form (with a Sign up button) renders.
    const { createServiceRoleClient } = await import('../helpers/supabase');
    const svc = createServiceRoleClient();
    await svc.from('app_settings').update({ value: 'built-in' }).eq('key', 'auth_mode');

    await page.goto('/signup');
    await expect(page.getByRole('button', { name: /sign up/i })).toBeVisible({ timeout: 10000 });
  });

  test('complete user flow works', async ({ page }) => {
    // Ensure KB is enabled so the "Help Center" nav link renders and /help
    // doesn't 404. Other specs may have left kb_visible='false'.
    const { createServiceRoleClient } = await import('../helpers/supabase');
    const svc = createServiceRoleClient();
    await svc.from('app_settings').upsert({ key: 'kb_visible', value: 'true' });

    // Login as a regular user
    await loginAs(page, 'alice@example.com');

    // View ticket list
    await page.goto('/tickets');
    // The tickets page no longer has an h1 — verify the search form is rendered
    await expect(page.locator('[aria-label="Search tickets"]')).toBeVisible({ timeout: 15000 });

    // Visit help center
    await page.goto('/help');
    await expect(page.getByRole('link', { name: 'Help Center' })).toBeVisible({ timeout: 15000 });

    // Visit profile
    await page.goto('/profile');
    await expect(page.getByRole('heading', { name: 'My Profile' })).toBeVisible({ timeout: 15000 });
  });

  test('agent flow works', async ({ page }) => {
    await loginAs(page, 'agent.smith@example.com');

    // Agent dashboard — assert against a stable element instead of body text,
    // which is fragile under cross-browser rendering and can race with a
    // session-cookie reload that briefly renders the login form body.
    await page.goto('/agent');
    await expect(
      page.getByRole('link', { name: 'Agent Dashboard' }),
    ).toBeVisible({ timeout: 15000 });

    // Canned responses
    await page.goto('/canned-responses');
    await page.waitForLoadState('domcontentloaded');
    await expect(page.locator('body')).toContainText(/canned|response/i);
  });

  test('admin flow works', async ({ page }) => {
    await loginAs(page, 'admin@example.com');

    // Admin setup
    await page.goto('/admin/types');
    await page.waitForLoadState('networkidle');
    await expect(page.locator('body')).toContainText(/type|admin/i);

    // Reports
    await page.goto('/reports');
    await page.waitForLoadState('networkidle');
    await expect(page.locator('body')).toContainText(/report/i);
  });
});
