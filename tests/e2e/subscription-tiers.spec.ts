import { test, expect, Page } from '@playwright/test';
import { createServiceRoleClient } from '../helpers/supabase';

async function loginAs(page: Page, email: string, password = 'Password123') {
  await page.goto('/login');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Log in' }).click();
  await expect(page).toHaveURL('/', { timeout: 10000 });
  await expect(page.getByRole('button', { name: 'Sign out' })).toBeVisible({ timeout: 10000 });
}

async function gotoAdmin(page: Page, path: string) {
  await page.goto(path);
  if (!page.url().includes('/admin')) {
    await page.goto(path);
  }
}

test.describe('Subscription Tiers', () => {
  test.describe.configure({ mode: 'serial' });

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

  test('admin sees seeded tiers in the table', async ({ page }) => {
    await loginAs(page, 'admin@example.com');
    await gotoAdmin(page, '/admin/tiers');

    // The seeded tiers from seed.sql: free, licensed, enterprise
    await expect(page.getByTestId('tier-row-free')).toBeVisible({ timeout: 10000 });
    await expect(page.getByTestId('tier-row-licensed')).toBeVisible();
    await expect(page.getByTestId('tier-row-enterprise')).toBeVisible();
  });

  test('admin can create a new tier', async ({ page }) => {
    await loginAs(page, 'admin@example.com');
    await gotoAdmin(page, '/admin/tiers');

    await page.locator('#tier-key').fill('e2e-test-tier');
    await page.locator('#tier-display-name').fill('E2E Test Tier');
    await page.locator('#tier-color').selectOption('green');
    await page.locator('#tier-icon').fill('🧪');

    // Enable one capability (scope to create form via its unique input)
    const createForm = page.locator('form', { has: page.locator('#tier-key') });
    await createForm.getByLabel('Change Visibility').check();

    await page.getByRole('button', { name: 'Create Tier' }).click();

    // New tier should appear
    await expect(page.getByTestId('tier-row-e2e-test-tier')).toBeVisible({ timeout: 10000 });
  });

  test('admin can delete the test tier', async ({ page }) => {
    await loginAs(page, 'admin@example.com');
    await gotoAdmin(page, '/admin/tiers');

    // Wait for tier to be visible
    await expect(page.getByTestId('tier-row-e2e-test-tier')).toBeVisible({ timeout: 10000 });

    await page.getByTestId('delete-tier-e2e-test-tier').click();

    // After page reload, tier should be gone
    await expect(page.getByTestId('tier-row-e2e-test-tier')).not.toBeVisible({ timeout: 10000 });
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
    await expect(page.getByRole('heading', { name: 'Agent Dashboard' })).toBeVisible({ timeout: 10000 });

    // There should be a tier filter dropdown
    const tierFilter = page.getByLabel('Tier');
    await expect(tierFilter).toBeVisible({ timeout: 5000 });
  });

  test('agent dashboard shows tier badge for tiered users', async ({ page }) => {
    await loginAs(page, 'agent.smith@example.com');
    await page.goto('/agent');
    await expect(page.getByRole('heading', { name: 'Agent Dashboard' })).toBeVisible({ timeout: 10000 });

    // At least one tier badge should be visible (Alice has Enterprise tier from seed)
    const badges = page.getByTestId('tier-badge');
    const count = await badges.count();
    expect(count).toBeGreaterThan(0);
  });

  test('tier filter filters tickets by tier', async ({ page }) => {
    await loginAs(page, 'agent.smith@example.com');
    await page.goto('/agent');
    await expect(page.getByRole('heading', { name: 'Agent Dashboard' })).toBeVisible({ timeout: 10000 });

    // Filter by "No tier"
    await page.getByLabel('Tier').selectOption('none');
    await page.getByRole('button', { name: 'Apply Filters' }).click();

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
    await expect(tierFilter).toBeVisible({ timeout: 5000 });
  });

  // ── Admin users page tier column ────────────────

  test('admin users page shows tier column', async ({ page }) => {
    await loginAs(page, 'admin@example.com');
    await gotoAdmin(page, '/admin/users');

    // Wait for table to load
    await expect(page.getByRole('columnheader', { name: 'Tier' })).toBeVisible({ timeout: 10000 });
  });
});
