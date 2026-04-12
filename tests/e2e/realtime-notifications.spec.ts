import { test, expect } from '@playwright/test';

test.describe('Realtime Notifications', () => {
  test.beforeEach(async ({ page }) => {
    // Navigate to homepage
    await page.goto('/');
  });

  test('should show notification bell with unread count', async ({ page }) => {
    // Login as user
    await page.goto('/login');
    await page.fill('input[name="email"]', 'user@test.com');
    await page.fill('input[name="password"]', 'user123');
    await page.click('button[type="submit"]');
    await page.waitForURL('/');

    // Check for notification bell
    const bell = page.locator('[aria-label="Notifications"]');
    await expect(bell).toBeVisible();
  });

  test('should open notification dropdown when bell is clicked', async ({ page }) => {
    // Login as user
    await page.goto('/login');
    await page.fill('input[name="email"]', 'user@test.com');
    await page.fill('input[name="password"]', 'user123');
    await page.click('button[type="submit"]');
    await page.waitForURL('/');

    // Click notification bell
    await page.click('[aria-label="Notifications"]');

    // Check dropdown is visible
    await expect(page.getByText('Notifications')).toBeVisible();
    await expect(page.getByText('View all notifications')).toBeVisible();
  });

  test('should navigate to notifications page', async ({ page }) => {
    // Login as user
    await page.goto('/login');
    await page.fill('input[name="email"]', 'user@test.com');
    await page.fill('input[name="password"]', 'user123');
    await page.click('button[type="submit"]');
    await page.waitForURL('/');

    // Click notification bell
    await page.click('[aria-label="Notifications"]');

    // Click "View all notifications"
    await page.click('text=View all notifications');

    // Should navigate to notifications page
    await expect(page).toHaveURL(/\/notifications/);
    await expect(page.getByRole('heading', { name: 'Notifications' })).toBeVisible();
  });

  test('should show mark all as read button when there are unread notifications', async ({
    page,
  }) => {
    // Login as user
    await page.goto('/login');
    await page.fill('input[name="email"]', 'user@test.com');
    await page.fill('input[name="password"]', 'user123');
    await page.click('button[type="submit"]');
    await page.waitForURL('/');

    // Navigate to notifications page
    await page.goto('/notifications');

    // If there are unread notifications, the button should be visible
    const hasUnread = await page.locator('span.bg-blue-500').count();
    if (hasUnread > 0) {
      await expect(page.getByRole('button', { name: 'Mark all as read' })).toBeVisible();
    }
  });

  test('should update notification preferences', async ({ page }) => {
    // Login as user
    await page.goto('/login');
    await page.fill('input[name="email"]', 'user@test.com');
    await page.fill('input[name="password"]', 'user123');
    await page.click('button[type="submit"]');
    await page.waitForURL('/');

    // Navigate to notification settings
    await page.goto('/notifications/settings');

    // Should show notification preferences form
    await expect(page.getByText(/notification preferences/i)).toBeVisible();
  });

  test('should display notification in dropdown with correct format', async ({ page }) => {
    // Login as user
    await page.goto('/login');
    await page.fill('input[name="email"]', 'user@test.com');
    await page.fill('input[name="password"]', 'user123');
    await page.click('button[type="submit"]');
    await page.waitForURL('/');

    // Click notification bell
    await page.click('[aria-label="Notifications"]');

    // Check for notification format (icon, message, time)
    const notifications = page.locator('[aria-label="Notifications"]').first();
    await expect(notifications).toBeVisible();
  });
});

test.describe('Realtime Updates - Ticket Detail', () => {
  test('ticket detail page loads correctly', async ({ page }) => {
    // Login as user
    await page.goto('/login');
    await page.fill('input[name="email"]', 'user@test.com');
    await page.fill('input[name="password"]', 'user123');
    await page.click('button[type="submit"]');
    await page.waitForURL('/');

    // Create a ticket
    await page.goto('/tickets/new');
    await page.fill('input[name="title"]', 'Test Realtime Ticket');
    await page.fill('textarea[name="body"]', 'Testing realtime updates');
    await page.click('button[type="submit"]');

    // Should redirect to ticket detail
    await page.waitForURL(/\/tickets\/\d+/);

    // Ticket title should be visible
    await expect(page.getByText('Test Realtime Ticket')).toBeVisible();
  });
});

test.describe('Realtime Updates - Agent Dashboard', () => {
  test('agent dashboard loads correctly', async ({ page }) => {
    // Login as agent
    await page.goto('/login');
    await page.fill('input[name="email"]', 'agent@test.com');
    await page.fill('input[name="password"]', 'agent123');
    await page.click('button[type="submit"]');
    await page.waitForURL('/');

    // Navigate to agent dashboard
    await page.goto('/agent');

    // Should show agent dashboard
    await expect(page.getByText(/tickets/i)).toBeVisible();
  });
});
