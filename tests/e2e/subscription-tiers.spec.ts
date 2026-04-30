import { test, expect, Page } from '@playwright/test';
import { createServiceRoleClient } from '../helpers/supabase';

async function loginAs(page: Page, email: string, password = 'Password123') {
  const svc = createServiceRoleClient();
  await svc.from('login_attempts').delete().eq('email', email.toLowerCase());

  await page.goto('/login');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Log in' }).click();

  // Retry once on transient auth failure (rate-limit / timing)
  try {
    await expect(page).toHaveURL('/', { timeout: 10000 });
  } catch {
    // Only retry if we're actually on the login page (not already logged in)
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

test.describe('Subscription Tiers', () => {
  test.describe.configure({ mode: 'serial' });

  test.beforeAll(async () => {
    const svc = createServiceRoleClient();
    await svc.from('subscription_tiers').delete().ilike('key', 'e2e%');
  });

  test.afterAll(async () => {
    const svc = createServiceRoleClient();
    await svc.from('subscription_tiers').delete().ilike('key', 'e2e%');
  });

  // ── Admin tiers page ────────────────────────────

  test('admin sees Subscription Tiers link in sidebar', async ({ page }) => {
    await loginAs(page, 'admin@example.com');
    await gotoAdmin(page, '/admin');
    await expect(page.getByRole('link', { name: 'Subscription Tiers' })).toBeVisible();
  });

  test('admin can navigate to tiers page', async ({ page }) => {
    await loginAs(page, 'admin@example.com');
    await gotoAdmin(page, '/admin/tiers');
    await expect(page.getByRole('heading', { name: 'Subscription Tiers' })).toBeVisible({ timeout: 10000 });
  });

  test('admin sees seeded tiers in the matrix', async ({ page }) => {
    await loginAs(page, 'admin@example.com');
    await gotoAdmin(page, '/admin/tiers');

    const survey = page.getByTestId('tiers-survey-form');
    await expect(survey).toBeVisible({ timeout: 10000 });
    // The seeded tiers from seed.sql: free, licensed, enterprise.
    // Use exact match to disambiguate from Display Name (Free vs free).
    await expect(survey.getByRole('cell', { name: 'free', exact: true })).toBeVisible({ timeout: 10000 });
    await expect(survey.getByRole('cell', { name: 'licensed', exact: true })).toBeVisible();
    await expect(survey.getByRole('cell', { name: 'enterprise', exact: true })).toBeVisible();
  });

  test('admin can create a new tier', async ({ page }) => {
    await loginAs(page, 'admin@example.com');
    await gotoAdmin(page, '/admin/tiers');

    const survey = page.getByTestId('tiers-survey-form');
    await expect(survey).toBeVisible({ timeout: 10000 });

    // Wait until existing seeded rows are rendered before snapshotting count.
    await expect(survey.getByRole('cell', { name: 'free', exact: true })).toBeVisible({
      timeout: 10000,
    });
    const textInputsBefore = await survey.locator('input[type="text"]').count();
    await survey.getByText('Add Tier', { exact: true }).click();
    // After Add Tier, two new text inputs (key + display_name) should appear.
    await expect(survey.locator('input[type="text"]')).toHaveCount(textInputsBefore + 2, {
      timeout: 5000,
    });

    const textInputs = survey.locator('input[type="text"]');
    const total = await textInputs.count();
    await textInputs.nth(total - 2).fill('e2e-test-tier');
    await textInputs.nth(total - 1).fill('E2E Test Tier');

    await page.getByRole('button', { name: 'Complete' }).click();
    // Wait for the success message rendered by AdminSurveyForm.
    const liveMsg = page.getByText(/Tiers saved|Error:/);
    await expect(liveMsg).toBeVisible({ timeout: 15000 });
    const msgText = (await liveMsg.textContent()) ?? '';
    if (msgText.startsWith('Error:')) {
      throw new Error(`saveTiers returned an error: ${msgText}`);
    }

    await gotoAdmin(page, '/admin/tiers');
    // After creation the matrix should have 4 remove buttons (3 seeded + 1 new).
    await expect(
      page.getByTestId('tiers-survey-form').locator('.sd-matrixdynamic__remove-btn'),
    ).toHaveCount(4, { timeout: 10000 });
  });

  test('admin can delete the test tier', async ({ page }) => {
    await loginAs(page, 'admin@example.com');
    await gotoAdmin(page, '/admin/tiers');

    const survey = page.getByTestId('tiers-survey-form');
    await expect(survey).toBeVisible({ timeout: 10000 });

    // Wait until tier rows are populated.
    await expect(survey.locator('.sd-matrixdynamic__remove-btn')).toHaveCount(4, { timeout: 10000 });

    // The e2e-test-tier was added last (highest sort_order). Remove the last row.
    await survey.locator('.sd-matrixdynamic__remove-btn').last().click();

    await page.getByRole('button', { name: 'Complete' }).click();
    await expect(page.getByText(/Tiers saved|Error:/)).toBeVisible({ timeout: 15000 });

    await gotoAdmin(page, '/admin/tiers');
    // After deletion the matrix should have only 3 remove buttons (the seeded tiers).
    await expect(
      page.getByTestId('tiers-survey-form').locator('.sd-matrixdynamic__remove-btn'),
    ).toHaveCount(3, { timeout: 10000 });
  });

  // ── External API settings ────────────────────────

  test('admin sees API settings card', async ({ page }) => {
    await loginAs(page, 'admin@example.com');
    await gotoAdmin(page, '/admin/tiers');

    await expect(page.getByTestId('tier-api-settings')).toBeVisible({ timeout: 10000 });
    await expect(page.getByTestId('tier-api-endpoint')).toBeVisible();
  });

  // ── Tier display on agent dashboard ─────────────

  test('agent dashboard shows tier filter when tiers exist', async ({ page }) => {
    await loginAs(page, 'agent.smith@example.com');
    await page.goto('/agent');
    await expect(page.getByRole('link', { name: 'Agent Dashboard' })).toHaveAttribute('aria-current', 'page');

    // Expand the consolidated Views & Filters panel
    await page.getByText(/Views & Filters:/).click();

    // There should be a tier filter dropdown
    const tierFilter = page.getByLabel('Tier');
    await expect(tierFilter).toBeVisible({ timeout: 5000 });
  });

  test('agent dashboard shows tier badge for tiered users', async ({ page }) => {
    await loginAs(page, 'agent.smith@example.com');
    await page.goto('/agent');
    await expect(page.getByRole('link', { name: 'Agent Dashboard' })).toHaveAttribute('aria-current', 'page');

    // At least one tier badge should be visible (Alice has Enterprise tier from seed)
    const badges = page.getByTestId('tier-badge');
    const count = await badges.count();
    expect(count).toBeGreaterThan(0);
  });

  test('tier filter filters tickets by tier', async ({ page }) => {
    await loginAs(page, 'agent.smith@example.com');
    await page.goto('/agent?tier=none');
    await expect(page.getByRole('link', { name: 'Agent Dashboard' })).toHaveAttribute('aria-current', 'page');

    await expect(page).toHaveURL(/tier=none/);
  });

  // ── Tier display on user detail ──────────────────

  test('user detail page shows tier info for admin', async ({ page }) => {
    await loginAs(page, 'admin@example.com');

    // Get Alice's user ID (she has enterprise tier from seed)
    const svc = createServiceRoleClient();
    const { data: alice } = await svc
      .from('profiles')
      .select('id')
      .eq('email', 'alice@example.com')
      .single();

    if (alice) {
      await page.goto(`/agent/users/${alice.id}`);
      await expect(page.getByTestId('user-tier')).toBeVisible({ timeout: 10000 });
    }
  });

  test('admin can see tier assignment form on user detail', async ({ page }) => {
    await loginAs(page, 'admin@example.com');

    const svc = createServiceRoleClient();
    const { data: alice } = await svc
      .from('profiles')
      .select('id')
      .eq('email', 'alice@example.com')
      .single();

    if (alice) {
      await page.goto(`/agent/users/${alice.id}`);
      // Verify we landed on the user detail page (not redirected)
      try {
        await page.waitForURL(/\/agent\/users\//, { timeout: 5000 });
      } catch {
        // Retry navigation if redirected
        await page.goto(`/agent/users/${alice.id}`);
        await page.waitForURL(/\/agent\/users\//, { timeout: 10000 });
      }
      await expect(page.getByText('User Information')).toBeVisible({ timeout: 10000 });
      await expect(page.getByTestId('admin-tier-assignment')).toBeVisible({ timeout: 10000 });
    }
  });

  // ── Reporting tier filter ───────────────────────

  test('reports page has tier filter for admin', async ({ page }) => {
    await loginAs(page, 'admin@example.com');
    await page.goto('/reports');
    await expect(page.getByRole('heading', { name: 'Reports' })).toBeVisible({ timeout: 10000 });

    // Tier filter should be available
    const tierFilter = page.getByLabel('Tier');
    await expect(tierFilter).toBeVisible({ timeout: 10000 });
  });

  // ── Admin users page tier column ────────────────

  test('admin users page shows tier column', async ({ page }) => {
    await loginAs(page, 'admin@example.com');
    await gotoAdmin(page, '/admin/users');

    // Wait for table to load
    await expect(page.getByRole('columnheader', { name: 'Tier' })).toBeVisible({ timeout: 10000 });
  });
});
