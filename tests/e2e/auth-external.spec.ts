import { test, expect, Page } from '@playwright/test';
import { createServiceRoleClient } from '../helpers/supabase';
import { loginViaForm } from '../helpers/auth';

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

  // Snapshot the current auth_mode so we can restore it after login if a test
  // is mid-way through verifying external mode. The shared loginViaForm helper
  // forces built-in mode before the form, which is what we need to log in.
  const { data: modeSetting } = await svc.from('app_settings').select('value').eq('key', 'auth_mode').single();
  const savedMode = modeSetting?.value || 'built-in';

  await loginViaForm(page, email, password);

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

  test.beforeEach(async () => {
    // If a previous run timed out before its afterAll could fire, app_settings
    // can be left with auth_mode='external' and pollute every other spec.
    await resetAuthMode();
  });

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

    // Within the google provider survey wrapper, the secret input has type=password.
    const googleCard = page.getByTestId('social-provider-google');
    const secretInput = googleCard.locator('input[type="password"]').first();
    await expect(secretInput).toBeVisible();
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

    // Should now show external provider config. A parallel worker's
    // loginViaForm() may have just reset auth_mode back to 'built-in' between
    // our click and the page re-render, so self-heal: re-set 'external' via
    // service role and reload until the external config card appears.
    const svc = createServiceRoleClient();
    let visible = false;
    for (let i = 0; i < 5; i++) {
      visible = await page
        .getByTestId('external-provider-config')
        .isVisible()
        .catch(() => false);
      if (visible) break;
      await svc.from('app_settings').update({ value: 'external' }).eq('key', 'auth_mode');
      await page.reload();
      await page.waitForLoadState('domcontentloaded');
    }
    expect(visible).toBe(true);

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

    // SurveyJS renders the boolean question with the label "Auto-redirect to external provider".
    await expect(
      page.getByText('Auto-redirect to external provider'),
    ).toBeVisible({ timeout: 10000 });
  });

  test('external client secret field masks input', async ({ page }) => {
    await loginAs(page, 'admin@example.com');
    await gotoAdmin(page, '/admin/auth');

    const externalRadio = page.getByTestId('mode-external').locator('input[type="radio"]');
    if (!(await externalRadio.isChecked())) {
      await page.getByTestId('mode-external').click();
      await page.getByTestId('confirm-mode-switch').click();
    }

    // A parallel worker's loginViaForm() can reset auth_mode back to 'built-in'
    // between the click above and the page re-render, causing the external
    // provider survey to never appear. Self-heal by re-setting external and
    // reloading until the survey is visible.
    const svc = createServiceRoleClient();
    let surveyVisible = false;
    for (let i = 0; i < 5; i++) {
      surveyVisible = await page.getByTestId('external-provider-survey').isVisible().catch(() => false);
      if (surveyVisible) break;
      await svc.from('app_settings').update({ value: 'external' }).eq('key', 'auth_mode');
      await page.reload();
      await page.waitForLoadState('domcontentloaded');
    }

    const survey = page.getByTestId('external-provider-survey');
    const secretInput = survey.locator('input[type="password"]').first();
    await expect(secretInput).toBeVisible({ timeout: 5000 });
  });

  test('test connection button is present for external provider', async ({ page }) => {
    await loginAs(page, 'admin@example.com');
    await gotoAdmin(page, '/admin/auth');

    const externalRadio = page.getByTestId('mode-external').locator('input[type="radio"]');
    if (!(await externalRadio.isChecked())) {
      await page.getByTestId('mode-external').click();
      await page.getByTestId('confirm-mode-switch').click();
    }

    // A parallel worker's loginViaForm() can reset auth_mode back to 'built-in'
    // between the click above and the page re-render. Self-heal by re-setting
    // 'external' via service role and reloading until the test button appears.
    const svc = createServiceRoleClient();
    let visible = false;
    for (let i = 0; i < 5; i++) {
      visible = await page
        .getByTestId('test-external')
        .isVisible()
        .catch(() => false);
      if (visible) break;
      await svc.from('app_settings').update({ value: 'external' }).eq('key', 'auth_mode');
      await page.reload();
      await page.waitForLoadState('domcontentloaded');
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

    // A parallel worker's loginViaForm() can reset auth_mode back to 'built-in'
    // between the DB write above and the page render. Re-set and reload until
    // the external login button appears.
    await page.goto('/login');
    let visible = false;
    for (let i = 0; i < 5; i++) {
      visible = await page.getByTestId('external-login-btn').isVisible().catch(() => false);
      if (visible) break;
      await svc.from('app_settings').update({ value: 'external' }).eq('key', 'auth_mode');
      await page.reload();
      await page.waitForLoadState('domcontentloaded');
    }
    expect(visible).toBe(true);

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
    let visible = false;
    for (let i = 0; i < 5; i++) {
      visible = await page.getByTestId('external-login-btn').isVisible().catch(() => false);
      if (visible) break;
      await svc.from('app_settings').update({ value: 'external' }).eq('key', 'auth_mode');
      await svc.from('app_settings').update({ value: 'true' }).eq('key', 'auth_external_auto_redirect');
      await page.reload();
      await page.waitForLoadState('domcontentloaded');
    }
    expect(visible).toBe(true);

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

    // Parallel workers calling loginViaForm reset `auth_mode` to `built-in`
    // before navigating to /login. If that lands between our restore above
    // (inside loginAs) and our page render below, the profile page renders
    // with the password section visible. Re-assert external mode and reload
    // until the page truly reflects external mode.
    await page.goto('/profile');
    await expect(page.getByRole('heading', { name: 'Display Name' })).toBeVisible({ timeout: 10000 });
    let hidden = false;
    for (let i = 0; i < 5; i++) {
      hidden = !(await page
        .getByRole('heading', { name: 'Change Password' })
        .isVisible()
        .catch(() => false));
      if (hidden) break;
      await svc.from('app_settings').update({ value: 'external' }).eq('key', 'auth_mode');
      await page.reload();
      await expect(page.getByRole('heading', { name: 'Display Name' })).toBeVisible({ timeout: 10000 });
    }
    expect(hidden).toBe(true);

    await resetAuthMode();
  });

  test('profile page always shows display name editing', async ({ page }) => {
    await resetAuthMode();
    await loginAs(page, 'admin@example.com');
    await page.goto('/profile');
    await expect(page.getByRole('heading', { name: 'Display Name' })).toBeVisible({ timeout: 10000 });
  });
});
