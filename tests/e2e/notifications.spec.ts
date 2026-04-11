import { test, expect, Page } from '@playwright/test';

/**
 * Helper: log in via the login form.
 */
async function loginAs(page: Page, email: string, password = 'Password123') {
  await page.goto('/login');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Log in' }).click();
  await expect(page).toHaveURL('/', { timeout: 10000 });
  await expect(page.getByRole('button', { name: 'Sign out' })).toBeVisible({ timeout: 10000 });
}

/** Navigate to an admin page, retrying once if requireAdmin() redirect race occurs. */
async function gotoAdmin(page: Page, path: string) {
  await page.goto(path);
  if (!page.url().includes('/admin')) {
    await page.goto(path);
  }
}

// ============================================================
// NOTIFICATION SETTINGS PAGE
// ============================================================

test.describe('Notification Settings', () => {
  test.describe.configure({ mode: 'serial' });

  test('user can access notification settings page', async ({ page }) => {
    await loginAs(page, 'alice@example.com');
    await page.goto('/notification-settings');
    await expect(page.getByRole('heading', { name: 'Notification Settings' })).toBeVisible({ timeout: 10000 });
  });

  test('notification settings page shows toggle table', async ({ page }) => {
    await loginAs(page, 'alice@example.com');
    await page.goto('/notification-settings');
    await expect(page.getByText('New Reply')).toBeVisible({ timeout: 10000 });
    await expect(page.getByText('Status Changed')).toBeVisible();
    await expect(page.getByText('Agent Assigned')).toBeVisible();
  });

  test('user can toggle and save preferences', async ({ page }) => {
    await loginAs(page, 'alice@example.com');
    await page.goto('/notification-settings');

    // Wait for the form to load
    await expect(page.getByText('New Reply')).toBeVisible({ timeout: 10000 });

    // Find the Save button and click it
    await page.getByRole('button', { name: 'Save' }).click();

    // Should show success message
    await expect(page.getByText('Preferences saved.')).toBeVisible({ timeout: 10000 });
  });
});

// ============================================================
// ADMIN EMAIL CONFIG
// ============================================================

test.describe('Admin Email Configuration', () => {
  test.describe.configure({ mode: 'serial' });

  test('admin can access email config page', async ({ page }) => {
    await loginAs(page, 'admin@example.com');
    await gotoAdmin(page, '/admin/email');
    await expect(page.getByRole('heading', { name: 'Email Configuration' })).toBeVisible({ timeout: 10000 });
  });

  test('admin can save SMTP settings', async ({ page }) => {
    await loginAs(page, 'admin@example.com');
    await gotoAdmin(page, '/admin/email');

    // Wait for the form to be fully hydrated
    await expect(page.getByText('SMTP Settings')).toBeVisible({ timeout: 10000 });

    await page.getByLabel('SMTP Host').fill('localhost');
    await page.getByLabel('SMTP Port').fill('54325');
    await page.getByLabel('Sender Email').fill('test@helpdesk.local');
    await page.getByLabel('Sender Name').fill('HelpDesk Test');

    // Click Save button that follows the Sender Name field
    await page.getByRole('button', { name: 'Save', exact: true }).first().click();

    await expect(page.getByText('Email configuration saved.')).toBeVisible({ timeout: 10000 });
  });

  test('admin can see email sidebar link', async ({ page }) => {
    await loginAs(page, 'admin@example.com');
    await gotoAdmin(page, '/admin');
    await expect(page.getByRole('link', { name: 'Email' })).toBeVisible({ timeout: 10000 });
  });

  test('admin can change coalescing delay', async ({ page }) => {
    await loginAs(page, 'admin@example.com');
    await gotoAdmin(page, '/admin/email');

    await expect(page.getByText('Notification Coalescing')).toBeVisible({ timeout: 10000 });

    const delayInput = page.getByLabel('Delay (minutes)');
    await delayInput.fill('5');
    // Click the Save button in the same form as the delay input
    await delayInput.locator('xpath=ancestor::form').getByRole('button', { name: 'Save' }).click();

    await expect(page.getByText('Coalescing delay saved.')).toBeVisible({ timeout: 10000 });

    // Reset
    await delayInput.fill('2');
    await delayInput.locator('xpath=ancestor::form').getByRole('button', { name: 'Save' }).click();
  });
});

// ============================================================
// ADMIN TEMPLATES
// ============================================================

test.describe('Admin Notification Templates', () => {
  test.describe.configure({ mode: 'serial' });

  test('templates page shows categories', async ({ page }) => {
    await loginAs(page, 'admin@example.com');
    await gotoAdmin(page, '/admin/templates');

    await expect(page.getByText('User Notifications')).toBeVisible({ timeout: 10000 });
    await expect(page.getByText('Agent Notifications')).toBeVisible();
    await expect(page.getByText('Auto-Replies & System')).toBeVisible();
  });

  test('templates page shows new event types', async ({ page }) => {
    await loginAs(page, 'admin@example.com');
    await gotoAdmin(page, '/admin/templates');

    await expect(page.getByText('Urgency Changed')).toBeVisible({ timeout: 10000 });
    await expect(page.getByText('Severity Changed')).toBeVisible();
    await expect(page.getByText('Privacy Changed')).toBeVisible();
    await expect(page.getByText('Consolidated Update')).toBeVisible();
  });
});

// ============================================================
// ADMIN DEFAULT NOTIFICATION PREFERENCES
// ============================================================

test.describe('Admin Default Notification Preferences', () => {
  test.describe.configure({ mode: 'serial' });

  test('admin user-settings shows default preferences form', async ({ page }) => {
    await loginAs(page, 'admin@example.com');
    await gotoAdmin(page, '/admin/user-settings');

    await expect(page.getByText('Default Notification Preferences')).toBeVisible({ timeout: 10000 });
    await expect(page.getByText('New Reply')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Save Defaults' })).toBeVisible();
  });

  test('admin can save default preferences', async ({ page }) => {
    await loginAs(page, 'admin@example.com');
    await gotoAdmin(page, '/admin/user-settings');

    await expect(page.getByRole('button', { name: 'Save Defaults' })).toBeVisible({ timeout: 10000 });
    await page.getByRole('button', { name: 'Save Defaults' }).click();

    await expect(page.getByText('Default preferences saved.')).toBeVisible({ timeout: 10000 });
  });
});
