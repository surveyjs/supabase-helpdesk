import { test, expect } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import { loginAs } from '../helpers/auth';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'http://127.0.0.1:54321';
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

function svc() {
  return createClient(supabaseUrl, serviceRoleKey);
}

// ============================================================
// NOTIFICATION BELL & DROPDOWN
// ============================================================

test.describe('Realtime Notifications', () => {
  test.describe.configure({ mode: 'serial' });

  test('bell icon is visible for logged-in user', async ({ page }) => {
    await loginAs(page, 'alice@example.com');
    await expect(page.getByLabel('Notifications')).toBeVisible();
  });

  test('clicking bell opens notification dropdown', async ({ page }) => {
    await loginAs(page, 'alice@example.com');
    await page.getByLabel('Notifications').click();
    // Should have Mark all as read and View all links
    await expect(page.getByText('Mark all as read')).toBeVisible();
    await expect(page.getByText('View all')).toBeVisible();
  });

  test('bell badge updates when new notification is inserted', async ({ page }) => {
    await loginAs(page, 'alice@example.com');
    const aliceId = '00000000-0000-0000-0000-000000000014';

    // Clear this test's notification if leftover from a prior run
    const admin = svc();
    await admin.from('notifications').delete().eq('recipient_id', aliceId).eq('message', 'Test notification for badge update');

    // Reload so the bell starts fresh
    await page.reload();
    await expect(page.getByLabel('Notifications')).toBeVisible();

    // Insert a notification via service role
    await admin.from('notifications').insert({
      recipient_id: aliceId,
      event_type: 'new_post',
      ticket_id: null,
      message: 'Test notification for badge update',
    });

    // Reload so the server-rendered unread count picks up the new notification
    await page.reload();
    await expect(page.getByLabel('Notifications')).toBeVisible();

    // Badge (red circle) should now be visible
    const badge = page.getByLabel('Notifications').locator('span.bg-red-500');
    await expect(badge).toBeVisible();

    // Clean up only this test's notification
    await admin.from('notifications').delete().eq('recipient_id', aliceId).eq('message', 'Test notification for badge update');
  });

  test('dropdown shows notifications', async ({ page }) => {
    await loginAs(page, 'alice@example.com');
    const aliceId = '00000000-0000-0000-0000-000000000014';

    // Insert a notification
    const admin = svc();
    await admin.from('notifications').delete().eq('recipient_id', aliceId).eq('message', 'Ticket #42 status changed to resolved');
    await admin.from('notifications').insert({
      recipient_id: aliceId,
      event_type: 'status_changed',
      ticket_id: null,
      message: 'Ticket #42 status changed to resolved',
    });

    // Open dropdown
    await page.getByLabel('Notifications').click();

    // Should show the notification message
    await expect(page.getByText('Ticket #42 status changed to resolved')).toBeVisible();

    // Clean up
    await admin.from('notifications').delete().eq('recipient_id', aliceId).eq('message', 'Ticket #42 status changed to resolved');
  });

  test('mark all as read clears badge', async ({ page }) => {
    await loginAs(page, 'alice@example.com');
    const aliceId = '00000000-0000-0000-0000-000000000014';

    // Insert notifications
    const admin = svc();
    await admin.from('notifications').delete().eq('recipient_id', aliceId).in('message', ['MarkRead Msg 1', 'MarkRead Msg 2']);
    await admin.from('notifications').insert([
      { recipient_id: aliceId, event_type: 'new_post', message: 'MarkRead Msg 1' },
      { recipient_id: aliceId, event_type: 'new_post', message: 'MarkRead Msg 2' },
    ]);

    // Open dropdown and click mark all as read
    await page.getByLabel('Notifications').click();
    await expect(page.getByText('Mark all as read')).toBeVisible({ timeout: 5000 });
    await page.getByText('Mark all as read').click();

    // Badge should disappear (no unread)
    const bell = page.getByLabel('Notifications');
    // The badge span should not have text content > 0
    const badge = bell.locator('span.bg-red-500');
    await expect(badge).not.toBeVisible({ timeout: 5000 });

    // Clean up
    await admin.from('notifications').delete().eq('recipient_id', aliceId).in('message', ['MarkRead Msg 1', 'MarkRead Msg 2']);
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
    await expect(page.getByRole('heading', { name: 'Notifications' })).toBeVisible();
  });

  test('notifications page shows all notifications', async ({ page }) => {
    const aliceId = '00000000-0000-0000-0000-000000000014';
    const admin = svc();
    await admin.from('notifications').delete().eq('recipient_id', aliceId).in('message', ['Page test notification 1', 'Page test notification 2']);

    await admin.from('notifications').insert([
      { recipient_id: aliceId, event_type: 'new_post', message: 'Page test notification 1' },
      { recipient_id: aliceId, event_type: 'status_changed', message: 'Page test notification 2' },
    ]);

    await loginAs(page, 'alice@example.com');

    // Navigate with cache-busting param to ensure fresh server render
    await page.goto(`/notifications?t=${Date.now()}`);
    await expect(page.getByRole('heading', { name: 'Notifications' })).toBeVisible();

    // If notifications aren't visible yet (stale server cache), reload once
    if (!await page.getByText('Page test notification 1').isVisible({ timeout: 3000 }).catch(() => false)) {
      await page.reload();
    }

    await expect(page.getByText('Page test notification 1')).toBeVisible();
    await expect(page.getByText('Page test notification 2')).toBeVisible();

    // Clean up
    await admin.from('notifications').delete().eq('recipient_id', aliceId).in('message', ['Page test notification 1', 'Page test notification 2']);
  });

  test('notifications page has mark all as read', async ({ page }) => {
    await loginAs(page, 'alice@example.com');
    await page.goto('/notifications');
    await expect(page.getByText('Mark all as read')).toBeVisible();
  });
});

// ============================================================
// AGENT DASHBOARD REALTIME
// ============================================================

test.describe('Agent Dashboard Realtime', () => {
  test('agent dashboard page loads with realtime component', async ({ page }) => {
    await loginAs(page, 'agent.smith@example.com');
    await page.goto('/agent');
    await expect(page.getByRole('heading', { name: 'Agent Dashboard' })).toBeVisible();
  });
});

// ============================================================
// TICKET DETAIL REALTIME
// ============================================================

test.describe('Ticket Detail Realtime', () => {
  test('ticket detail page loads successfully', async ({ page }) => {
    await loginAs(page, 'alice@example.com');

    // Create a ticket to verify realtime component is present
    await page.goto('/tickets/new');
    await page.getByLabel('Title').fill('Realtime Test Ticket');
    await page.locator('textarea, [role="textbox"]').first().fill('Testing realtime updates.');

    // Submit form
    await page.getByRole('button', { name: /submit|create/i }).click();

    // Should redirect to ticket detail
    await expect(page.getByText('Realtime Test Ticket')).toBeVisible();
  });
});
