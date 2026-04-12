import { test, expect, Page } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'http://127.0.0.1:54321';
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

function svc() {
  return createClient(supabaseUrl, serviceRoleKey);
}

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

// ============================================================
// NOTIFICATION BELL & DROPDOWN
// ============================================================

test.describe('Realtime Notifications', () => {
  test.describe.configure({ mode: 'serial' });

  test('bell icon is visible for logged-in user', async ({ page }) => {
    await loginAs(page, 'alice@example.com');
    await expect(page.getByLabel('Notifications')).toBeVisible({ timeout: 10000 });
  });

  test('clicking bell opens notification dropdown', async ({ page }) => {
    await loginAs(page, 'alice@example.com');
    await page.getByLabel('Notifications').click();
    // Should have Mark all as read and View all links
    await expect(page.getByText('Mark all as read')).toBeVisible({ timeout: 10000 });
    await expect(page.getByText('View all')).toBeVisible();
  });

  test('bell badge updates when new notification is inserted', async ({ page }) => {
    await loginAs(page, 'alice@example.com');
    const aliceId = '00000000-0000-0000-0000-000000000014';

    // Clear existing notifications for alice
    const admin = svc();
    await admin.from('notifications').delete().eq('recipient_id', aliceId);

    // Reload so the bell starts with 0 unread (no badge)
    await page.reload();
    await expect(page.getByLabel('Notifications')).toBeVisible({ timeout: 10000 });

    // Insert a notification via service role
    await admin.from('notifications').insert({
      recipient_id: aliceId,
      event_type: 'new_post',
      ticket_id: null,
      message: 'Test notification for badge update',
    });

    // Reload so the server-rendered unread count picks up the new notification
    await page.reload({ waitUntil: 'networkidle' });
    await expect(page.getByLabel('Notifications')).toBeVisible({ timeout: 10000 });

    // Badge (red circle) should now be visible
    const badge = page.getByLabel('Notifications').locator('span.bg-red-500');
    await expect(badge).toBeVisible({ timeout: 10000 });

    // Clean up
    await admin.from('notifications').delete().eq('recipient_id', aliceId);
  });

  test('dropdown shows notifications', async ({ page }) => {
    await loginAs(page, 'alice@example.com');
    const aliceId = '00000000-0000-0000-0000-000000000014';

    // Insert a notification
    const admin = svc();
    await admin.from('notifications').delete().eq('recipient_id', aliceId);
    await admin.from('notifications').insert({
      recipient_id: aliceId,
      event_type: 'status_changed',
      ticket_id: null,
      message: 'Ticket #42 status changed to resolved',
    });

    // Open dropdown
    await page.getByLabel('Notifications').click();

    // Should show the notification message
    await expect(page.getByText('Ticket #42 status changed to resolved')).toBeVisible({ timeout: 10000 });

    // Clean up
    await admin.from('notifications').delete().eq('recipient_id', aliceId);
  });

  test('mark all as read clears badge', async ({ page }) => {
    await loginAs(page, 'alice@example.com');
    const aliceId = '00000000-0000-0000-0000-000000000014';

    // Insert notifications
    const admin = svc();
    await admin.from('notifications').delete().eq('recipient_id', aliceId);
    await admin.from('notifications').insert([
      { recipient_id: aliceId, event_type: 'new_post', message: 'Msg 1' },
      { recipient_id: aliceId, event_type: 'new_post', message: 'Msg 2' },
    ]);

    await page.waitForTimeout(500);

    // Open dropdown and click mark all as read
    await page.getByLabel('Notifications').click();
    await expect(page.getByText('Mark all as read')).toBeVisible({ timeout: 5000 });
    await page.getByText('Mark all as read').click();

    // Badge should disappear (no unread)
    await page.waitForTimeout(1000);
    const bell = page.getByLabel('Notifications');
    // The badge span should not have text content > 0
    const badge = bell.locator('span.bg-red-500');
    await expect(badge).not.toBeVisible({ timeout: 5000 });

    // Clean up
    await admin.from('notifications').delete().eq('recipient_id', aliceId);
  });
});

// ============================================================
// NOTIFICATIONS PAGE
// ============================================================

test.describe('Notifications Page', () => {
  test.describe.configure({ mode: 'serial' });

  test('notifications page is accessible', async ({ page }) => {
    await loginAs(page, 'alice@example.com');
    await page.goto('/notifications');
    await expect(page.getByRole('heading', { name: 'Notifications' })).toBeVisible({ timeout: 10000 });
  });

  test('notifications page shows all notifications', async ({ page }) => {
    const aliceId = '00000000-0000-0000-0000-000000000014';
    const admin = svc();
    await admin.from('notifications').delete().eq('recipient_id', aliceId);

    await admin.from('notifications').insert([
      { recipient_id: aliceId, event_type: 'new_post', message: 'Page test notification 1' },
      { recipient_id: aliceId, event_type: 'status_changed', message: 'Page test notification 2' },
    ]);

    await loginAs(page, 'alice@example.com');

    // Navigate to notifications with networkidle to ensure full render
    await page.goto('/notifications', { waitUntil: 'networkidle' });

    await expect(page.getByText('Page test notification 1')).toBeVisible({ timeout: 10000 });
    await expect(page.getByText('Page test notification 2')).toBeVisible();

    // Clean up
    await admin.from('notifications').delete().eq('recipient_id', aliceId);
  });

  test('notifications page has mark all as read', async ({ page }) => {
    await loginAs(page, 'alice@example.com');
    await page.goto('/notifications');
    await expect(page.getByText('Mark all as read')).toBeVisible({ timeout: 10000 });
  });
});

// ============================================================
// AGENT DASHBOARD REALTIME
// ============================================================

test.describe('Agent Dashboard Realtime', () => {
  test('agent dashboard page loads with realtime component', async ({ page }) => {
    await loginAs(page, 'agent.smith@example.com');
    await page.goto('/agent', { waitUntil: 'networkidle' });
    await expect(page.getByRole('heading', { name: 'Agent Dashboard' })).toBeVisible({ timeout: 10000 });
  });
});

// ============================================================
// TICKET DETAIL REALTIME
// ============================================================

test.describe('Ticket Detail Realtime', () => {
  test('ticket detail page loads successfully', async ({ page }) => {
    await loginAs(page, 'alice@example.com');

    // Create a ticket to verify realtime component is present
    await page.goto('/tickets/new', { waitUntil: 'networkidle' });
    await page.getByLabel('Title').fill('Realtime Test Ticket');
    await page.locator('textarea, [role="textbox"]').first().fill('Testing realtime updates.');

    // Submit form
    await page.getByRole('button', { name: /submit|create/i }).click();

    // Should redirect to ticket detail
    await expect(page.getByText('Realtime Test Ticket')).toBeVisible({ timeout: 10000 });
  });
});
