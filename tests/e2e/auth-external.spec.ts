import { test, expect, Page, Locator } from '@playwright/test';
import { createServiceRoleClient } from '../helpers/supabase';
import { loginViaForm } from '../helpers/auth';

const SUPABASE_URL = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'http://127.0.0.1:54321').replace(/\/+$/, '');
const EXTERNAL_PROVIDER_ID = 'custom:external';
const SURVEYJS_AUTHORIZE_URL = 'https://auth.surveyjs.io/OAuth/Authorize';

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

const EXTERNAL_DEFAULTS: Record<string, string> = {
  auth_external_preset: 'surveyjs',
  auth_external_provider_name: '',
  auth_external_issuer_url: '',
  auth_external_authorization_url: '',
  auth_external_token_url: '',
  auth_external_userinfo_url: '',
  auth_external_scopes: 'openid email profile',
  auth_external_auto_redirect: 'false',
  auth_external_registered: 'false',
  auth_external_last_error: '',
};

const EXTERNAL_VAULT_SECRETS = [
  'auth_external_client_id',
  'auth_external_client_secret',
  'auth_external_client_id_prev',
  'auth_external_client_secret_prev',
];

/** Removes the Supabase Auth custom provider, its Vault credentials and settings. */
async function resetExternalProvider() {
  const svc = createServiceRoleClient();
  await svc.auth.admin.customProviders.deleteProvider(EXTERNAL_PROVIDER_ID);
  for (const name of EXTERNAL_VAULT_SECRETS) {
    await svc.rpc('delete_oauth_secret', { secret_name: name });
  }
  for (const [key, value] of Object.entries(EXTERNAL_DEFAULTS)) {
    await svc.from('app_settings').update({ value }).eq('key', key);
  }
}

async function resetAuthMode() {
  const svc = createServiceRoleClient();
  await svc.from('app_settings').update({ value: 'built-in' }).eq('key', 'auth_mode');
  await svc.from('app_settings').update({ value: 'false' }).eq('key', 'auth_google_enabled');
  await svc.from('app_settings').update({ value: 'false' }).eq('key', 'auth_github_enabled');
  await svc.from('app_settings').update({ value: 'false' }).eq('key', 'auth_microsoft_enabled');
  await svc.from('app_settings').update({ value: 'false' }).eq('key', 'auth_gitlab_enabled');
  await resetExternalProvider();
}

/**
 * Fixture setup for login-page tests (not the admin flow): registers the
 * SurveyJS preset directly through the admin API and marks it registered.
 */
async function registerProviderDirectly(providerName = 'SurveyJS') {
  const svc = createServiceRoleClient();
  await svc.auth.admin.customProviders.deleteProvider(EXTERNAL_PROVIDER_ID);
  const { error } = await svc.auth.admin.customProviders.createProvider({
    provider_type: 'oauth2',
    identifier: EXTERNAL_PROVIDER_ID,
    name: providerName,
    client_id: 'e2e-client-id',
    client_secret: 'e2e-client-secret',
    scopes: ['openid', 'email', 'profile'],
    pkce_enabled: true,
    enabled: true,
    authorization_url: SURVEYJS_AUTHORIZE_URL,
    token_url: 'https://auth.surveyjs.io/OAuth/Token',
    userinfo_url: 'https://auth.surveyjs.io/OAuth/UserInfo',
  });
  if (error) throw new Error(`createProvider: ${error.message}`);
  await svc.from('app_settings').update({ value: providerName }).eq('key', 'auth_external_provider_name');
  await svc.from('app_settings').update({ value: 'true' }).eq('key', 'auth_external_registered');
}

/**
 * Puts the app in External mode and reloads `path` until `marker` is visible.
 * A parallel worker's loginViaForm() resets auth_mode to 'built-in' before it
 * navigates to /login, which can land between our write and the render.
 */
async function gotoInExternalMode(page: Page, path: string, marker: Locator, extra: Record<string, string> = {}) {
  const svc = createServiceRoleClient();
  const apply = async () => {
    await svc.from('app_settings').update({ value: 'external' }).eq('key', 'auth_mode');
    for (const [key, value] of Object.entries(extra)) {
      await svc.from('app_settings').update({ value }).eq('key', key);
    }
  };
  await apply();
  await page.goto(path);
  for (let i = 0; i < 5; i++) {
    if (await marker.isVisible().catch(() => false)) return;
    await apply();
    await page.goto(path).catch(() => {});
    await page.waitForLoadState('domcontentloaded').catch(() => {});
  }
  await expect(marker).toBeVisible({ timeout: 5000 });
}

function externalSurvey(page: Page) {
  return page.getByTestId('external-provider-survey');
}

function question(page: Page, name: string) {
  return externalSurvey(page).locator(`.sd-question[data-name="${name}"]`);
}

async function selectPreset(page: Page, label: string) {
  await question(page, 'preset').locator('.sd-dropdown').click();
  await page.getByRole('option', { name: label, exact: true }).click();
}

async function fillQuestion(page: Page, name: string, value: string) {
  await question(page, name).locator('input').fill(value);
}

async function saveExternalForm(page: Page) {
  await externalSurvey(page).getByRole('button', { name: 'Save' }).click();
}

/** Counts Next.js server-action POSTs issued by the page. */
function countServerActions(page: Page) {
  const counter = { count: 0 };
  page.on('request', (req) => {
    if (req.method() === 'POST' && req.headers()['next-action']) counter.count++;
  });
  return counter;
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

  test('switching to External mode while unregistered is refused', async ({ page }) => {
    await loginAs(page, 'admin@example.com');
    await gotoAdmin(page, '/admin/auth');

    await page.getByTestId('mode-external').click();
    await page.getByTestId('confirm-mode-switch').click();

    await expect(
      page.getByText('Configure and register the external provider before switching to External mode.'),
    ).toBeVisible({ timeout: 10000 });

    const svc = createServiceRoleClient();
    const { data } = await svc.from('app_settings').select('value').eq('key', 'auth_mode').single();
    expect(data?.value).toBe('built-in');
  });

  test('external provider card is available in built-in mode', async ({ page }) => {
    await loginAs(page, 'admin@example.com');
    await gotoAdmin(page, '/admin/auth');

    await expect(page.getByTestId('mode-builtin').locator('input[type="radio"]')).toBeChecked();
    await expect(page.getByTestId('external-provider-config')).toBeVisible();
    await expect(page.getByTestId('external-provider-intro')).toContainText(
      'Configure and register the provider here first, then switch the mode to External.',
    );
    await expect(page.getByTestId('external-provider-status')).toContainText('Not registered');
    await expect(page.getByTestId('test-external')).toBeVisible();
    await expect(page.getByTestId('external-provider-register')).toBeVisible();
    await expect(
      externalSurvey(page).getByText('Auto-redirect to external provider'),
    ).toBeVisible({ timeout: 10000 });
    await expect(externalSurvey(page).locator('input[type="password"]').first()).toBeVisible();
  });

  test('redirect URI is the Supabase callback, in both modes', async ({ page }) => {
    const expected = `${SUPABASE_URL}/auth/v1/callback`;
    await loginAs(page, 'admin@example.com');

    await gotoAdmin(page, '/admin/auth');
    const redirectInput = page.getByTestId('redirect-uri');
    await expect(redirectInput).toHaveValue(expected);
    await expect(redirectInput).toHaveAttribute('readonly');
    await expect(page.getByText('Register this URL as the allowed redirect URI at your identity provider.')).toBeVisible();

    await registerProviderDirectly();
    await gotoInExternalMode(
      page,
      '/admin/auth',
      page.getByTestId('mode-external').locator('input[type="radio"]:checked'),
    );
    await expect(page.getByTestId('redirect-uri')).toHaveValue(expected);
  });

  test('preset defaults to SurveyJS and drives the visible endpoint fields', async ({ page }) => {
    await loginAs(page, 'admin@example.com');
    await gotoAdmin(page, '/admin/auth');

    await expect(question(page, 'preset')).toContainText('SurveyJS (auth.surveyjs.io)', { timeout: 10000 });
    await expect(externalSurvey(page).getByTestId('surveyjs-preset-info')).toBeVisible();
    await expect(question(page, 'provider_name').locator('input')).toHaveValue('SurveyJS');
    for (const name of ['issuer_url', 'authorization_url', 'token_url', 'userinfo_url']) {
      await expect(question(page, name)).toHaveCount(0);
    }

    await selectPreset(page, 'Generic OAuth 2.0');
    for (const name of ['authorization_url', 'token_url', 'userinfo_url']) {
      await expect(question(page, name)).toBeVisible();
    }
    await expect(question(page, 'issuer_url')).toHaveCount(0);
    await expect(externalSurvey(page).getByTestId('surveyjs-preset-info')).toHaveCount(0);

    await selectPreset(page, 'Generic OpenID Connect');
    await expect(question(page, 'issuer_url')).toBeVisible();
    for (const name of ['authorization_url', 'token_url', 'userinfo_url']) {
      await expect(question(page, name)).toHaveCount(0);
    }
  });

  test('saving the SurveyJS preset without credentials shows a validation error', async ({ page }) => {
    await loginAs(page, 'admin@example.com');
    await gotoAdmin(page, '/admin/auth');
    await expect(question(page, 'preset')).toBeVisible({ timeout: 10000 });

    // Saving the untouched form is a no-op with visible feedback.
    await saveExternalForm(page);
    await expect(externalSurvey(page).getByText('No changes to save.')).toBeVisible({ timeout: 10000 });

    await fillQuestion(page, 'provider_name', 'SurveyJS Account');
    await saveExternalForm(page);
    await expect(
      externalSurvey(page).getByText('Client ID and Client Secret are required to register the provider.'),
    ).toBeVisible({ timeout: 10000 });

    const svc = createServiceRoleClient();
    const { data } = await svc.from('app_settings').select('value').eq('key', 'auth_external_registered').single();
    expect(data?.value).toBe('false');
    const { data: registered } = await svc.auth.admin.customProviders.getProvider(EXTERNAL_PROVIDER_ID);
    expect(registered).toBeNull();
  });

  test('failed save is retryable, and Register re-runs with nothing changed', async ({ page }) => {
    await loginAs(page, 'admin@example.com');
    await gotoAdmin(page, '/admin/auth');
    await expect(question(page, 'preset')).toBeVisible({ timeout: 10000 });
    const actions = countServerActions(page);

    await selectPreset(page, 'Generic OAuth 2.0');
    await fillQuestion(page, 'provider_name', 'Corp SSO');
    await fillQuestion(page, 'authorization_url', 'http://idp.example.com/authorize');
    await fillQuestion(page, 'token_url', 'https://idp.example.com/token');
    await fillQuestion(page, 'userinfo_url', 'https://idp.example.com/userinfo');
    await fillQuestion(page, 'client_id', 'e2e-id');
    await fillQuestion(page, 'client_secret', 'e2e-secret');

    const error = externalSurvey(page).getByText('Error: Authorization URL must be a valid https:// URL.');
    await saveExternalForm(page);
    await expect(error).toBeVisible({ timeout: 10000 });
    const afterFirst = actions.count;
    expect(afterFirst).toBeGreaterThan(0);

    // Same data again: the snapshot was not advanced, so the action runs again.
    await saveExternalForm(page);
    await expect.poll(() => actions.count, { timeout: 10000 }).toBeGreaterThan(afterFirst);
    await expect(error).toBeVisible({ timeout: 10000 });

    // Explicit retry without touching the form.
    const svc = createServiceRoleClient();
    const startedAt = new Date(Date.now() - 1000).toISOString();
    await page.getByTestId('external-provider-register').click();
    await expect
      .poll(async () => {
        const { data } = await svc
          .from('admin_audit_log')
          .select('id')
          .eq('action', 'external_provider_registered')
          .gte('created_at', startedAt);
        return data?.length ?? 0;
      }, { timeout: 15000 })
      .toBeGreaterThan(0);
    // Nothing valid was saved, so registration reports the missing credentials.
    await expect(page.getByTestId('external-provider-status')).toContainText('Client ID and Client Secret are required', { timeout: 10000 });
  });

  test('first-time SurveyJS setup through the UI only, starting in Built-in mode', async ({ page, browser }) => {
    await loginAs(page, 'admin@example.com');
    await gotoAdmin(page, '/admin/auth');

    // External card is available while still in Built-in mode.
    await expect(page.getByTestId('mode-builtin').locator('input[type="radio"]')).toBeChecked();
    await expect(page.getByTestId('external-provider-config')).toBeVisible();

    // SurveyJS is the default preset; only credentials are needed.
    await expect(question(page, 'preset')).toContainText('SurveyJS (auth.surveyjs.io)', { timeout: 10000 });
    await fillQuestion(page, 'client_id', 'e2e-surveyjs-client');
    await fillQuestion(page, 'client_secret', 'e2e-surveyjs-secret');
    await saveExternalForm(page);

    await expect(page.getByTestId('external-provider-status')).toContainText('Registered with Supabase Auth', {
      timeout: 15000,
    });

    // Supabase Auth now has the custom provider, registered as OAuth 2.0.
    const svc = createServiceRoleClient();
    const { data: provider, error } = await svc.auth.admin.customProviders.getProvider(EXTERNAL_PROVIDER_ID);
    expect(error).toBeNull();
    expect(provider?.provider_type).toBe('oauth2');
    expect(provider?.authorization_url).toBe(SURVEYJS_AUTHORIZE_URL);
    expect(provider?.client_id).toBe('e2e-surveyjs-client');
    expect(provider?.pkce_enabled).toBe(true);
    expect(provider?.enabled).toBe(true);

    // Switch the mode to External through the UI.
    await page.getByTestId('mode-external').click();
    await page.getByTestId('confirm-mode-switch').click();
    await expect(page.getByTestId('mode-external').locator('input[type="radio"]')).toBeChecked({ timeout: 10000 });

    // Login page offers SurveyJS sign-in. A parallel worker's loginViaForm()
    // can flip auth_mode back to built-in, so fall back to re-applying it.
    // Anonymous visitor: a fresh context without the admin session cookies.
    const anonContext = await browser.newContext();
    const loginPage = await anonContext.newPage();
    await loginPage.goto('/login?no_redirect=true');
    if (!(await loginPage.getByTestId('external-login-btn').isVisible({ timeout: 5000 }).catch(() => false))) {
      await gotoInExternalMode(loginPage, '/login?no_redirect=true', loginPage.getByTestId('external-login-btn'));
    }
    await expect(loginPage.getByTestId('external-login-btn')).toHaveText('Sign in with SurveyJS');
    await anonContext.close();

    // Switch back to Built-in through the UI.
    await gotoAdmin(page, '/admin/auth');
    const builtinRadio = page.getByTestId('mode-builtin').locator('input[type="radio"]');
    if (!(await builtinRadio.isChecked())) {
      await page.getByTestId('mode-builtin').click();
      await page.getByTestId('confirm-mode-switch').click();
      await expect(builtinRadio).toBeChecked({ timeout: 10000 });
    }
  });

  // ── Login page in built-in mode ──────────────────────────

  test('login page shows email/password form in built-in mode', async ({ page }) => {
    await page.goto('/login');
    await expect(page.getByLabel('Email')).toBeVisible();
    await expect(page.getByLabel('Password')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Log in' })).toBeVisible();
  });

  test('login page does not show social buttons when none enabled', async ({ page }) => {
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
    await registerProviderDirectly('Test SSO');
    await gotoInExternalMode(page, '/login', page.getByTestId('external-login-btn'));

    await expect(page.getByText('Sign in with Test SSO')).toBeVisible();

    // No email/password form
    await expect(page.getByLabel('Email')).not.toBeVisible();
    await expect(page.getByLabel('Password')).not.toBeVisible();
  });

  test('external sign-in button starts the custom:external OAuth flow', async ({ page }) => {
    await registerProviderDirectly();
    // Never follow the redirect to auth.surveyjs.io.
    await page.route(`${SUPABASE_URL}/auth/v1/authorize**`, (route) =>
      route.fulfill({ status: 200, contentType: 'text/plain', body: 'intercepted' }),
    );
    await gotoInExternalMode(page, '/login?no_redirect=true', page.getByTestId('external-login-btn'));

    const authorizeRequest = page.waitForRequest((req) => req.url().startsWith(`${SUPABASE_URL}/auth/v1/authorize`));
    await page.getByTestId('external-login-btn').click();
    const url = (await authorizeRequest).url();

    expect(url.startsWith(`${SUPABASE_URL}/auth/v1/authorize`)).toBe(true);
    expect(url).toContain('provider=custom%3Aexternal');
  });

  test('login page in external mode with no_redirect param shows login page', async ({ page }) => {
    await registerProviderDirectly('Test SSO');
    await gotoInExternalMode(page, '/login?no_redirect=true', page.getByTestId('external-login-btn'), {
      auth_external_auto_redirect: 'true',
    });
  });

  test('external mode without a registered provider shows not-configured and never redirects', async ({ page }) => {
    const authorizeRequests: string[] = [];
    page.on('request', (req) => {
      if (req.url().startsWith(`${SUPABASE_URL}/auth/v1/authorize`)) authorizeRequests.push(req.url());
    });

    await gotoInExternalMode(page, '/login', page.getByTestId('external-not-configured'), {
      auth_external_auto_redirect: 'true',
      auth_external_registered: 'false',
    });
    await expect(page.getByText('External sign-in is not configured. Contact your administrator.')).toBeVisible();
    await expect(page.getByTestId('external-login-btn')).toHaveCount(0);

    await page.waitForTimeout(2000);
    expect(new URL(page.url()).pathname).toBe('/login');
    expect(authorizeRequests).toEqual([]);
  });

  test('a failed callback never loops back into auto-redirect', async ({ page }) => {
    await registerProviderDirectly();
    const authorizeRequests: string[] = [];
    await page.route(`${SUPABASE_URL}/auth/v1/authorize**`, (route) => {
      authorizeRequests.push(route.request().url());
      return route.fulfill({ status: 200, contentType: 'text/plain', body: 'intercepted' });
    });

    await gotoInExternalMode(
      page,
      '/login?error=auth_callback_error&no_redirect=true&error_detail=Token%20exchange%20failed',
      page.getByTestId('auth-callback-error'),
      { auth_external_auto_redirect: 'true' },
    );
    await expect(page.getByTestId('auth-callback-error')).toHaveText(
      'Sign-in with SurveyJS failed. Token exchange failed',
    );
    await page.waitForTimeout(2000);
    expect(new URL(page.url()).pathname).toBe('/login');

    // `error` alone also suppresses the auto-redirect.
    await page.goto('/login?error=auth_callback_error');
    await expect(page.getByTestId('auth-callback-error')).toBeVisible({ timeout: 10000 });
    await page.waitForTimeout(2000);
    expect(new URL(page.url()).pathname).toBe('/login');
    expect(authorizeRequests).toEqual([]);

    // The callback route itself adds no_redirect and a sanitized error_detail.
    await page.goto('/auth/callback?error=access_denied&error_description=x%3Cb%3Ey%3C%2Fb%3E');
    await page.waitForURL(/\/login\?/, { timeout: 10000 });
    const landed = new URL(page.url());
    expect(landed.pathname).toBe('/login');
    expect(landed.searchParams.get('error')).toBe('auth_callback_error');
    expect(landed.searchParams.get('no_redirect')).toBe('true');
    expect(landed.searchParams.get('error_detail')).toBe('xy');
    await page.waitForTimeout(2000);
    expect(new URL(page.url()).pathname).toBe('/login');
    expect(authorizeRequests).toEqual([]);
  });

  // ── Signup page in built-in mode ──────────────────────────

  test('signup page shows form in built-in mode', async ({ page }) => {
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
    await registerProviderDirectly('Corp SSO');
    await gotoInExternalMode(page, '/signup', page.getByTestId('external-signup-btn'));

    await expect(page.getByText('Account creation is managed')).toBeVisible({ timeout: 10000 });
    await expect(page.getByTestId('external-signup-btn')).toHaveText('Sign in with Corp SSO');

    // No signup form
    await expect(page.getByLabel('Password', { exact: true })).not.toBeVisible();
  });

  // ── Profile page ──────────────────────────

  test('profile page loads in built-in mode for email user', async ({ page }) => {
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
  });

  test('profile page hides change password for a custom:external user', async ({ page }) => {
    const svc = createServiceRoleClient();
    const email = 'external-sso-user@example.com';
    const { data: users } = await svc.auth.admin.listUsers({ page: 1, perPage: 500 });
    let user = (users?.users ?? []).find((u) => u.email === email);
    if (!user) {
      const { data, error } = await svc.auth.admin.createUser({
        email,
        password: 'Password123',
        email_confirm: true,
        user_metadata: { name: 'External SSO User' },
      });
      if (error) throw new Error(`createUser: ${error.message}`);
      user = data.user;
    }
    await svc.auth.admin.updateUserById(user!.id, {
      app_metadata: { provider: EXTERNAL_PROVIDER_ID, providers: [EXTERNAL_PROVIDER_ID] },
    });

    await loginAs(page, email);
    await page.goto('/profile');
    await expect(page.getByRole('heading', { name: 'Display Name' })).toBeVisible({ timeout: 10000 });
    await expect(page.getByRole('heading', { name: 'Change Password' })).toHaveCount(0);
  });

  test('profile page always shows display name editing', async ({ page }) => {
    await loginAs(page, 'admin@example.com');
    await page.goto('/profile');
    await expect(page.getByRole('heading', { name: 'Display Name' })).toBeVisible({ timeout: 10000 });
  });
});
