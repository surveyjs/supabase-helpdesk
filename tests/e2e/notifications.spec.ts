import { test, expect, Page } from '@playwright/test';
import { createServiceRoleClient } from '../helpers/supabase';
import { loginViaForm } from '../helpers/auth';

async function loginAs(page: Page, email: string, password = 'Password123') {
  await loginViaForm(page, email, password);
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

    const smtpForm = page.getByTestId('email-smtp-survey-form');

    // The server action requires both smtp_host and sender_email to be present.
    // On a fresh DB the seed row leaves sender_email empty, so fill it too to
    // ensure the autosave is accepted.
    const senderField = smtpForm.getByRole('textbox', { name: /Sender Email/i });
    await expect(senderField).toBeVisible({ timeout: 10000 });
    await expect(senderField).toBeEditable();
    if (!(await senderField.inputValue())) {
      await senderField.click();
      await senderField.fill('admin@example.com');
      await senderField.press('Tab');
    }

    // Change the SMTP host to verify autosave works
    const hostField = smtpForm.getByRole('textbox', { name: /SMTP Host/i });
    await expect(hostField).toBeVisible({ timeout: 10000 });
    await expect(hostField).toBeEditable();
    await hostField.click();
    await hostField.fill('testhost.local');
    // Tab to commit value (SurveyJS onValueChanged fires on blur/change)
    await hostField.press('Tab');

    // Verify in database (email config persists in email_config table)
    const svc = createServiceRoleClient();
    await expect.poll(async () => {
      const { data } = await svc
        .from('email_config')
        .select('smtp_host')
        .limit(1)
        .single();
      return data?.smtp_host;
    }, { timeout: 20000, intervals: [500, 500, 1000] }).toBe('testhost.local');
  });

  test('admin can see email sidebar link', async ({ page }) => {
    await loginAs(page, 'admin@example.com');
    await gotoAdmin(page, '/admin');
    await expect(page.getByRole('link', { name: 'Email', exact: true })).toBeVisible({ timeout: 10000 });
  });

  test('admin can change coalescing delay', async ({ page }) => {
    await loginAs(page, 'admin@example.com');
    await gotoAdmin(page, '/admin/email');

    await expect(page.getByText('Notification Coalescing')).toBeVisible({ timeout: 10000 });

    const delayForm = page.getByTestId('email-delay-survey-form');
    const delayInput = delayForm.getByLabel('Delay (minutes)');
    
    // Clear and fill with a specific value
    await delayInput.fill('');
    await delayInput.fill('3');
    await delayInput.blur();

    // Verify in database with polling (debounce + server action)
    const svc = createServiceRoleClient();
    await expect.poll(async () => {
      const { data } = await svc
        .from('app_settings')
        .select('value')
        .eq('key', 'notification_coalescing_delay_minutes')
        .single();
      return data?.value;
    }, { timeout: 15000 }).toBe('3');
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

    await expect(page.getByText('Urgency Changed').first()).toBeVisible({ timeout: 10000 });
    await expect(page.getByText('Severity Changed').first()).toBeVisible();
    await expect(page.getByText('Privacy Changed').first()).toBeVisible();
    await expect(page.getByText('Consolidated Update').first()).toBeVisible();
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

    // Wait for server-rendered heading first, then client component
    await expect(page.getByRole('heading', { name: 'User Settings' })).toBeVisible({ timeout: 10000 });
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


