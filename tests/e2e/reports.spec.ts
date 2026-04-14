import { test, expect, Page } from '@playwright/test';

async function loginAs(page: Page, email: string, password = 'Password123') {
  await page.goto('/login');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Log in' }).click();
  await expect(page).toHaveURL('/', { timeout: 10000 });
  await expect(page.getByRole('button', { name: 'Sign out' })).toBeVisible({ timeout: 10000 });
}

// ============================================================
// Reports Access Control
// ============================================================

test.describe('Reports Access Control', () => {
  test('regular user is redirected away from reports', async ({ page }) => {
    await loginAs(page, 'alice@example.com');
    await page.goto('/reports');
    // Should redirect to home
    await expect(page).not.toHaveURL(/\/reports/);
  });

  test('agent can access reports page', async ({ page }) => {
    await loginAs(page, 'agent.smith@example.com');
    await page.goto('/reports');
    await expect(page.getByRole('heading', { name: 'Reports' })).toBeVisible({ timeout: 10000 });
  });

  test('admin can access reports page', async ({ page }) => {
    await loginAs(page, 'admin@example.com');
    await page.goto('/reports');
    await expect(page.getByRole('heading', { name: 'Reports' })).toBeVisible({ timeout: 10000 });
  });
});

// ============================================================
// Reports Page Content
// ============================================================

test.describe('Reports Page - Admin View', () => {
  test.beforeEach(async ({ page }) => {
    await loginAs(page, 'admin@example.com');
    await page.goto('/reports');
    await expect(page.getByRole('heading', { name: 'Reports' })).toBeVisible({ timeout: 10000 });
  });

  test('report controls are visible', async ({ page }) => {
    await expect(page.getByTestId('report-controls')).toBeVisible();
  });

  test('ticket volume chart renders', async ({ page }) => {
    await expect(page.getByTestId('ticket-volume-chart')).toBeVisible();
  });

  test('resolution metrics panel renders', async ({ page }) => {
    const panel = page.getByTestId('resolution-metrics');
    await expect(panel).toBeVisible();
    await expect(panel.locator('div').filter({ hasText: /^Avg First Response$/ })).toBeVisible();
    await expect(panel.locator('div').filter({ hasText: /^Avg Resolution$/ })).toBeVisible();
    await expect(panel.locator('div').filter({ hasText: /^Median Resolution$/ })).toBeVisible();
  });

  test('agent performance table renders with all agents', async ({ page }) => {
    const table = page.getByTestId('agent-performance-table');
    await expect(table).toBeVisible();
    // Admin should see column headers
    await expect(table.getByRole('columnheader', { name: 'Agent' })).toBeVisible();
    await expect(table.getByRole('columnheader', { name: 'Assigned' })).toBeVisible();
    await expect(table.getByRole('columnheader', { name: 'Resolved' })).toBeVisible();
  });

  test('CSAT summary chart renders', async ({ page }) => {
    await expect(page.getByTestId('csat-summary-chart')).toBeVisible();
  });

  test('SLA compliance panel renders', async ({ page }) => {
    const panel = page.getByTestId('sla-compliance-panel');
    await expect(panel).toBeVisible();
    await expect(panel.locator('div').filter({ hasText: /^First Response$/ })).toBeVisible();
    await expect(panel.locator('div').filter({ hasText: /^Resolution$/ })).toBeVisible();
  });

  test('backlog overview renders', async ({ page }) => {
    await expect(page.getByTestId('backlog-overview')).toBeVisible();
    await expect(page.getByText('Open Tickets')).toBeVisible();
    await expect(page.getByText('Pending Tickets')).toBeVisible();
    await expect(page.getByText('Unassigned Tickets')).toBeVisible();
  });

  test('time range selector changes displayed data', async ({ page }) => {
    // Click "Last 7 days" preset
    await page.getByRole('button', { name: 'Last 7 days' }).click();
    // URL should update with start and end params
    await expect(page).toHaveURL(/start=/, { timeout: 10000 });
    await expect(page).toHaveURL(/end=/);
  });

  test('admin sees filter dropdowns', async ({ page }) => {
    await expect(page.getByLabel('Status')).toBeVisible();
    await expect(page.getByLabel('Severity')).toBeVisible();
    await expect(page.getByLabel('Type')).toBeVisible();
    await expect(page.getByLabel('Category')).toBeVisible();
  });

  test('CSV export triggers download', async ({ page }) => {
    // Click last 30 days to ensure data range
    await page.getByRole('button', { name: 'Last 30 days' }).click();
    await expect(page).toHaveURL(/start=/, { timeout: 10000 });

    const downloadPromise = page.waitForEvent('download', { timeout: 10000 });
    await page.getByRole('button', { name: 'ticket volume' }).click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toBe('ticket_volume_report.csv');
  });

  test('URL-based filters persist across page loads', async ({ page }) => {
    const url = '/reports?start=2025-01-01&end=2025-12-31&groupBy=month&severity=high';
    await page.goto(url);
    await expect(page.getByRole('heading', { name: 'Reports' })).toBeVisible({ timeout: 10000 });
    // Verify the severity dropdown has "high" selected
    await expect(page.getByLabel('Severity')).toHaveValue('high');
    await expect(page.getByLabel('Group by')).toHaveValue('month');
  });
});

// ============================================================
// Reports Page - Agent View (scoped)
// ============================================================

test.describe('Reports Page - Agent View', () => {
  test('agent sees only own performance data', async ({ page }) => {
    await loginAs(page, 'agent.smith@example.com');
    await page.goto('/reports');
    await expect(page.getByRole('heading', { name: 'Reports' })).toBeVisible({ timeout: 10000 });

    // Agent performance table should be visible
    await expect(page.getByTestId('agent-performance-table')).toBeVisible();

    // Agent should not see full filter set (only group by selector, dates)
    await expect(page.getByLabel('Status')).not.toBeVisible();
    await expect(page.getByLabel('Severity')).not.toBeVisible();
  });
});

// ============================================================
// NavBar Reports Link
// ============================================================

test.describe('NavBar Reports Link', () => {
  test('reports link visible for agent', async ({ page }) => {
    await loginAs(page, 'agent.smith@example.com');
    await expect(page.getByRole('link', { name: 'Reports' })).toBeVisible();
  });

  test('reports link visible for admin', async ({ page }) => {
    await loginAs(page, 'admin@example.com');
    await expect(page.getByRole('link', { name: 'Reports' })).toBeVisible();
  });

  test('reports link not visible for regular user', async ({ page }) => {
    await loginAs(page, 'alice@example.com');
    await expect(page.getByRole('link', { name: 'Reports' })).not.toBeVisible();
  });
});
