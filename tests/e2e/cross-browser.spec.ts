import { test, expect, Page } from '@playwright/test';

const SEED_PASSWORD = 'Password123';

async function loginAs(page: Page, email: string) {
  const { createServiceRoleClient } = await import('../helpers/supabase');
  const svc = createServiceRoleClient();
  await svc.from('login_attempts').delete().eq('email', email.toLowerCase());

  await page.goto('/login');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(SEED_PASSWORD);
  await page.getByRole('button', { name: 'Log in' }).click();

  try {
    await expect(page).toHaveURL('/', { timeout: 10000 });
  } catch {
    if (page.url().includes('/login')) {
      await svc.from('login_attempts').delete().eq('email', email.toLowerCase());
      await page.goto('/login');
      await page.getByLabel('Email').fill(email);
      await page.getByLabel('Password').fill(SEED_PASSWORD);
      await page.getByRole('button', { name: 'Log in' }).click();
      await expect(page).toHaveURL('/', { timeout: 15000 });
    }
  }
  await expect(page.locator('summary[aria-haspopup="true"]')).toBeVisible({ timeout: 15000 });
}

test.describe('Cross-Browser Smoke Tests', () => {
  test('login page loads and shows form', async ({ page }) => {
    await page.goto('/login');
    await expect(page.getByLabel('Email')).toBeVisible();
    await expect(page.getByLabel('Password')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Log in' })).toBeVisible();
  });

  test('signup page loads', async ({ page }) => {
    await page.goto('/signup');
    await expect(page.getByRole('button', { name: /sign up/i })).toBeVisible({ timeout: 10000 });
  });

  test('complete user flow works', async ({ page }) => {
    // Login as a regular user
    await loginAs(page, 'alice@example.com');

    // View ticket list
    await page.goto('/tickets');
    await expect(page.locator('h1, [data-testid="ticket-list"]')).toBeVisible({ timeout: 10000 });

    // Visit help center
    await page.goto('/help');
    await page.waitForLoadState('networkidle');
    await expect(page.locator('body')).toContainText(/help|knowledge|article/i);

    // Visit profile
    await page.goto('/profile');
    await expect(page.getByLabel('Display Name')).toBeVisible({ timeout: 10000 });
  });

  test('agent flow works', async ({ page }) => {
    await loginAs(page, 'agent.smith@example.com');

    // Agent dashboard
    await page.goto('/agent');
    await page.waitForLoadState('networkidle');
    await expect(page.locator('body')).toContainText(/agent|dashboard|ticket/i);

    // Canned responses
    await page.goto('/canned-responses');
    await page.waitForLoadState('networkidle');
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
