import { test, expect, Page } from '@playwright/test';
import { createServiceRoleClient } from '../helpers/supabase';

async function loginAs(page: Page, email: string, password = 'Password123') {
  const svc = createServiceRoleClient();

  // Some test flows can remove/skip profile rows; recreate minimal profile for the auth user.
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

  // Temporarily ensure built-in mode so email/password form is available
  const { data: modeSetting } = await svc.from('app_settings').select('value').eq('key', 'auth_mode').single();
  const savedMode = modeSetting?.value || 'built-in';
  if (savedMode !== 'built-in') {
    await svc.from('app_settings').update({ value: 'built-in' }).eq('key', 'auth_mode');
  }

  await svc.from('login_attempts').delete().eq('email', email.toLowerCase());

  await page.goto('/login');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Log in' }).click();

  try {
    await expect(page).toHaveURL('/', { timeout: 10000 });
  } catch {
    if (page.url().includes('/login')) {
      await svc.from('login_attempts').delete().eq('email', email.toLowerCase());
      await page.goto('/login');
      await page.getByLabel('Email').fill(email);
      await page.getByLabel('Password').fill(password);
      await page.getByRole('button', { name: 'Log in' }).click();
      await expect(page).toHaveURL('/', { timeout: 15000 });
    }
  }

  await expect(page.locator('summary[aria-haspopup="true"]')).toBeVisible({ timeout: 15000 });

  // Restore original auth_mode
  if (savedMode !== 'built-in') {
    await svc.from('app_settings').update({ value: savedMode }).eq('key', 'auth_mode');
  }
}

async function gotoAdmin(page: Page, path: string) {
  await page.goto(path);
  try {
    await page.waitForURL(/\/admin/, { timeout: 5000 });
  } catch {
    await page.goto(path);
    await page.waitForURL(/\/admin/, { timeout: 10000 });
  }
}

async function resetAuthMode() {
  const svc = createServiceRoleClient();
  await svc.from('app_settings').update({ value: 'built-in' }).eq('key', 'auth_mode');
  await svc.from('app_settings').update({ value: 'false' }).eq('key', 'auth_google_enabled');
  await svc.from('app_settings').update({ value: 'false' }).eq('key', 'auth_github_enabled');
  await svc.from('app_settings').update({ value: 'false' }).eq('key', 'auth_microsoft_enabled');
  await svc.from('app_settings').update({ value: 'false' }).eq('key', 'auth_gitlab_enabled');
  await svc.from('app_settings').update({ value: 'false' }).eq('key', 'auth_external_auto_redirect');
  await svc.from('app_settings').update({ value: '' }).eq('key', 'auth_external_provider_name');
}

test.describe('Auth External', () => {
  test.describe.configure({ mode: 'serial' });

  test.afterAll(async () => {
    await resetAuthMode();
  });

  // ── Admin auth configuration ──────────────────────────

  test('admin sees Authentication link in sidebar', async ({ page }) => {
    await loginAs(page, 'admin@example.com');
    await gotoAdmin(page, '/admin');
    await expect(page.getByRole('link', { name: 'Authentication' })).toBeVisible();
  });

  test('admin can navigate to /admin/auth', async ({ page }) => {
    await loginAs(page, 'admin@example.com');
    await gotoAdmin(page, '/admin/auth');
    await expect(page.getByRole('heading', { name: 'Authentication', exact: true })).toBeVisible({ timeout: 10000 });
  });

  test('admin sees auth mode radio buttons', async ({ page }) => {
    await loginAs(page, 'admin@example.com');
    await gotoAdmin(page, '/admin/auth');

    await expect(page.getByTestId('mode-builtin')).toBeVisible();
    await expect(page.getByTestId('mode-external')).toBeVisible();
  });

  test('built-in mode is selected by default', async ({ page }) => {
    await loginAs(page, 'admin@example.com');
    await gotoAdmin(page, '/admin/auth');

    const builtinRadio = page.getByTestId('mode-builtin').locator('input[type="radio"]');
    await expect(builtinRadio).toBeChecked();
  });

  test('social provider cards are visible in built-in mode', async ({ page }) => {
    await loginAs(page, 'admin@example.com');
    await gotoAdmin(page, '/admin/auth');

    await expect(page.getByTestId('social-provider-google')).toBeVisible();
    await expect(page.getByTestId('social-provider-github')).toBeVisible();
    await expect(page.getByTestId('social-provider-microsoft')).toBeVisible();
    await expect(page.getByTestId('social-provider-gitlab')).toBeVisible();
  });

  test('client secret fields mask input', async ({ page }) => {
    await loginAs(page, 'admin@example.com');
    await gotoAdmin(page, '/admin/auth');

    const secretInput = page.getByTestId('google-client-secret');
    await expect(secretInput).toHaveAttribute('type', 'password');
  });

  test('switching to external mode shows confirmation', async ({ page }) => {
    await loginAs(page, 'admin@example.com');
    await gotoAdmin(page, '/admin/auth');

    await page.getByTestId('mode-external').click();
    await expect(page.getByTestId('mode-confirm-dialog')).toBeVisible();
    await expect(page.getByText('Switching authentication mode')).toBeVisible();

    // Cancel
    await page.getByTestId('cancel-mode-switch').click();
    await expect(page.getByTestId('mode-confirm-dialog')).not.toBeVisible();
  });

  test('confirming mode switch to external shows external config', async ({ page }) => {
    await loginAs(page, 'admin@example.com');
    await gotoAdmin(page, '/admin/auth');

    await page.getByTestId('mode-external').click();
    await expect(page.getByTestId('mode-confirm-dialog')).toBeVisible();
    await page.getByTestId('confirm-mode-switch').click();

    // Should now show external provider config
    await expect(page.getByTestId('external-provider-config')).toBeVisible({ timeout: 10000 });

    // Social provider cards should not be visible
    await expect(page.getByTestId('social-provider-google')).not.toBeVisible();
  });

  test('external mode shows redirect URI as read-only', async ({ page }) => {
    await loginAs(page, 'admin@example.com');
    await gotoAdmin(page, '/admin/auth');

    // Switch to external (it may already be external from previous test)
    const externalRadio = page.getByTestId('mode-external').locator('input[type="radio"]');
    if (!(await externalRadio.isChecked())) {
      await page.getByTestId('mode-external').click();
      await page.getByTestId('confirm-mode-switch').click();
    }

    const redirectInput = page.getByTestId('redirect-uri');
    await expect(redirectInput).toBeVisible();
    await expect(redirectInput).toHaveAttribute('readonly');
  });

  test('auto-redirect toggle is present', async ({ page }) => {
    await loginAs(page, 'admin@example.com');
    await gotoAdmin(page, '/admin/auth');

    const externalRadio = page.getByTestId('mode-external').locator('input[type="radio"]');
    if (!(await externalRadio.isChecked())) {
      await page.getByTestId('mode-external').click();
      await page.getByTestId('confirm-mode-switch').click();
    }

    await expect(page.getByTestId('auto-redirect-toggle')).toBeVisible();
  });

  test('external client secret field masks input', async ({ page }) => {
    await loginAs(page, 'admin@example.com');
    await gotoAdmin(page, '/admin/auth');

    const externalRadio = page.getByTestId('mode-external').locator('input[type="radio"]');
    if (!(await externalRadio.isChecked())) {
      await page.getByTestId('mode-external').click();
      await page.getByTestId('confirm-mode-switch').click();
    }

    const secretInput = page.getByTestId('external-client-secret');
    await expect(secretInput).toHaveAttribute('type', 'password');
  });

  test('test connection button is present for external provider', async ({ page }) => {
    await loginAs(page, 'admin@example.com');
    await gotoAdmin(page, '/admin/auth');

    const externalRadio = page.getByTestId('mode-external').locator('input[type="radio"]');
    if (!(await externalRadio.isChecked())) {
      await page.getByTestId('mode-external').click();
      await page.getByTestId('confirm-mode-switch').click();
    }

    await expect(page.getByTestId('test-external')).toBeVisible();
  });

  // Switch back to built-in for login/signup tests
  test('can switch back to built-in mode', async ({ page }) => {
    await resetAuthMode();
    await loginAs(page, 'admin@example.com');
    await gotoAdmin(page, '/admin/auth');

    const builtinRadio = page.getByTestId('mode-builtin').locator('input[type="radio"]');
    await expect(builtinRadio).toBeChecked();
  });

  // ── Login page in built-in mode ──────────────────────────

  test('login page shows email/password form in built-in mode', async ({ page }) => {
    await resetAuthMode();
    await page.goto('/login');
    await expect(page.getByLabel('Email')).toBeVisible();
    await expect(page.getByLabel('Password')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Log in' })).toBeVisible();
  });

  test('login page does not show social buttons when none enabled', async ({ page }) => {
    await resetAuthMode();
    await page.goto('/login');
    await expect(page.getByTestId('social-login-google')).not.toBeVisible();
    await expect(page.getByTestId('social-login-github')).not.toBeVisible();
  });

  test('login page shows social buttons when provider enabled', async ({ page }) => {
    const svc = createServiceRoleClient();
    await svc.from('app_settings').update({ value: 'true' }).eq('key', 'auth_google_enabled');

    await page.goto('/login');
    await expect(page.getByTestId('social-login-google')).toBeVisible({ timeout: 10000 });

    // Cleanup
    await svc.from('app_settings').update({ value: 'false' }).eq('key', 'auth_google_enabled');
  });

  // ── Login page in external mode ──────────────────────────

  test('login page in external mode shows single sign-in button', async ({ page }) => {
    const svc = createServiceRoleClient();
    await svc.from('app_settings').update({ value: 'external' }).eq('key', 'auth_mode');
    await svc.from('app_settings').update({ value: 'Test SSO' }).eq('key', 'auth_external_provider_name');

    await page.goto('/login');
    await expect(page.getByTestId('external-login-btn')).toBeVisible({ timeout: 10000 });
    await expect(page.getByText('Sign in with Test SSO')).toBeVisible();

    // No email/password form
    await expect(page.getByLabel('Email')).not.toBeVisible();
    await expect(page.getByLabel('Password')).not.toBeVisible();

    await resetAuthMode();
  });

  test('login page in external mode with no_redirect param shows login page', async ({ page }) => {
    const svc = createServiceRoleClient();
    await svc.from('app_settings').update({ value: 'external' }).eq('key', 'auth_mode');
    await svc.from('app_settings').update({ value: 'true' }).eq('key', 'auth_external_auto_redirect');
    await svc.from('app_settings').update({ value: 'Test SSO' }).eq('key', 'auth_external_provider_name');

    await page.goto('/login?no_redirect=true');
    await expect(page.getByTestId('external-login-btn')).toBeVisible({ timeout: 10000 });

    await resetAuthMode();
  });

  // ── Signup page in built-in mode ──────────────────────────

  test('signup page shows form in built-in mode', async ({ page }) => {
    await resetAuthMode();
    await page.goto('/signup');
    await expect(page.getByLabel('Email')).toBeVisible();
    await expect(page.getByLabel('Password', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Sign up' })).toBeVisible();
  });

  test('signup page shows social buttons when provider enabled', async ({ page }) => {
    const svc = createServiceRoleClient();
    await svc.from('app_settings').update({ value: 'true' }).eq('key', 'auth_github_enabled');

    await page.goto('/signup');
    await expect(page.getByTestId('social-signup-github')).toBeVisible({ timeout: 10000 });

    await svc.from('app_settings').update({ value: 'false' }).eq('key', 'auth_github_enabled');
  });

  // ── Signup page in external mode ──────────────────────────

  test('signup page in external mode shows external provider message', async ({ page }) => {
    const svc = createServiceRoleClient();
    await svc.from('app_settings').update({ value: 'external' }).eq('key', 'auth_mode');
    await svc.from('app_settings').update({ value: 'Corp SSO' }).eq('key', 'auth_external_provider_name');

    await page.goto('/signup');
    await expect(page.getByText('Account creation is managed')).toBeVisible({ timeout: 10000 });
    await expect(page.getByTestId('external-signup-btn')).toBeVisible();

    // No signup form
    await expect(page.getByLabel('Password', { exact: true })).not.toBeVisible();

    await resetAuthMode();
  });

  // ── Profile page ──────────────────────────

  test('profile page loads in built-in mode for email user', async ({ page }) => {
    await resetAuthMode();
    await loginAs(page, 'alice@example.com');
    await page.goto('/profile');
    await expect(page.getByRole('heading', { name: 'My Profile' })).toBeVisible({ timeout: 10000 });
  });

  test('profile page hides change password in external mode', async ({ page }) => {
    const svc = createServiceRoleClient();
    await svc.from('app_settings').update({ value: 'external' }).eq('key', 'auth_mode');

    await loginAs(page, 'admin@example.com');
    await page.goto('/profile');
    await expect(page.getByRole('heading', { name: 'Display Name' })).toBeVisible({ timeout: 10000 });
    await expect(page.getByRole('heading', { name: 'Change Password' })).not.toBeVisible();

    await resetAuthMode();
  });

  test('profile page always shows display name editing', async ({ page }) => {
    await resetAuthMode();
    await loginAs(page, 'admin@example.com');
    await page.goto('/profile');
    await expect(page.getByRole('heading', { name: 'Display Name' })).toBeVisible({ timeout: 10000 });
  });
});
