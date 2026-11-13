import { readFileSync } from 'fs';
import { test, expect, Page } from './fixtures';
import { loginViaForm } from '../helpers/auth';
import { createServiceRoleClient } from '../helpers/supabase';

async function loginAs(page: Page, email: string, password = 'Password123') {
  await loginViaForm(page, email, password);
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
  test('all report sections render correctly', async ({ page }) => {
    await loginAs(page, 'admin@example.com');
    await page.goto('/reports');
    await expect(page.getByRole('heading', { name: 'Reports' })).toBeVisible({ timeout: 10000 });

    // Report controls
    await expect(page.getByTestId('report-controls')).toBeVisible();

    // Ticket volume chart
    await expect(page.getByTestId('ticket-volume-chart')).toBeVisible();

    // Resolution metrics panel
    const resPanel = page.getByTestId('resolution-metrics');
    await expect(resPanel).toBeVisible();
    await expect(resPanel.locator('div').filter({ hasText: /^Avg First Response$/ })).toBeVisible();
    await expect(resPanel.locator('div').filter({ hasText: /^Avg Resolution$/ })).toBeVisible();
    await expect(resPanel.locator('div').filter({ hasText: /^Median Resolution$/ })).toBeVisible();

    // Agent performance table
    const table = page.getByTestId('agent-performance-table');
    await expect(table).toBeVisible();
    await expect(table.getByRole('columnheader', { name: 'Agent' })).toBeVisible();
    await expect(table.getByRole('columnheader', { name: 'Assigned' })).toBeVisible();
    await expect(table.getByRole('columnheader', { name: 'Resolved' })).toBeVisible();

    // CSAT summary chart
    await expect(page.getByTestId('csat-summary-chart')).toBeVisible();

    // SLA compliance panel
    const slaPanel = page.getByTestId('sla-compliance-panel');
    await expect(slaPanel).toBeVisible();
    await expect(slaPanel.locator('div').filter({ hasText: /^First Response$/ })).toBeVisible();
    await expect(slaPanel.locator('div').filter({ hasText: /^Resolution$/ })).toBeVisible();

    // Backlog overview
    await expect(page.getByTestId('backlog-overview')).toBeVisible();
    await expect(page.getByText('Open Tickets')).toBeVisible();
    await expect(page.getByText('Pending Tickets')).toBeVisible();
    await expect(page.getByText('Unassigned Tickets')).toBeVisible();

    // Admin filter dropdowns
    await expect(page.getByLabel('Status')).toBeVisible();
    await expect(page.getByLabel('Severity')).toBeVisible();
    await expect(page.getByLabel('Type')).toBeVisible();
    await expect(page.getByLabel('Category')).toBeVisible();
  });

  test('time range selector and URL-based filters', async ({ page }) => {
    await loginAs(page, 'admin@example.com');
    await page.goto('/reports');
    await expect(page.getByRole('heading', { name: 'Reports' })).toBeVisible({ timeout: 10000 });

    // Click "Last 7 days" preset
    await page.getByRole('button', { name: 'Last 7 days' }).click();
    // URL should update with start and end params
    await expect(page).toHaveURL(/start=/, { timeout: 10000 });
    await expect(page).toHaveURL(/end=/);

    // URL-based filters persist across page loads
    await page.goto('/reports?start=2025-01-01&end=2025-12-31&groupBy=month&severity=high');
    await expect(page.getByRole('heading', { name: 'Reports' })).toBeVisible({ timeout: 10000 });
    await expect(page.getByLabel('Severity')).toHaveValue('high');
    await expect(page.getByLabel('Group by')).toHaveValue('month', { timeout: 10000 });
  });

  test('CSV export triggers download', async ({ page }) => {
    await loginAs(page, 'admin@example.com');
    await page.goto('/reports');
    await expect(page.getByRole('heading', { name: 'Reports' })).toBeVisible({ timeout: 10000 });

    // Click last 30 days to ensure data range
    await page.getByRole('button', { name: 'Last 30 days' }).click();
    await expect(page).toHaveURL(/start=/, { timeout: 10000 });

    const downloadPromise = page.waitForEvent('download', { timeout: 10000 });
    await page.getByText('Export CSV').click();
    await page.getByRole('button', { name: 'Ticket volume' }).click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toBe('ticket_volume_report.csv');
  });
});

test.describe('Reports Page - empty range', () => {
  test('shows an em dash instead of 0% / 0m when there is no data', async ({ page }) => {
    await loginAs(page, 'admin@example.com');
    await page.goto('/reports?start=2001-01-01&end=2001-01-31');
    await expect(page.getByRole('heading', { name: 'Reports' })).toBeVisible({ timeout: 10000 });
    await expect(page.getByTestId('ticket-volume-chart')).toBeVisible();
    await expect(page.getByTestId('ticket-volume-chart').getByRole('heading', { name: 'Ticket Volume' })).toBeVisible();
    const sla = page.getByTestId('sla-compliance-panel');
    await expect(sla.getByText('—')).toHaveCount(2);
    await expect(sla.getByText('0%')).toHaveCount(0);
    await expect(sla.getByText('No tickets in period')).toHaveCount(2);
    await expect(page.getByTestId('resolution-metrics').getByText('0m')).toHaveCount(0);
  });

  test('a real 0% SLA compliance stays "0%" (not "—")', async ({ page }) => {
    const svc = createServiceRoleClient();
    const { data: alice } = await svc.from('profiles').select('id').eq('email', 'alice@example.com').single();
    const { data: typeData } = await svc.from('ticket_types').select('id').limit(1).single();
    const { data: ticket } = await svc
      .from('tickets')
      .insert({
        title: 'E2E Reports breached SLA ticket',
        slug: 'e2e-reports-breached-sla-ticket',
        creator_id: alice!.id,
        type_id: typeData!.id,
        created_at: '2099-06-15T12:00:00Z',
      })
      .select('id')
      .single();
    const ticketId = ticket!.id;
    try {
      await svc.from('sla_timers').upsert(
        {
          ticket_id: ticketId,
          first_response_met: false,
          resolution_met: false,
          created_at: '2099-06-15T12:00:00Z',
        },
        { onConflict: 'ticket_id' },
      );
      await loginAs(page, 'admin@example.com');
      await page.goto('/reports?start=2099-06-01&end=2099-06-30');
      const sla = page.getByTestId('sla-compliance-panel');
      // 2 gauges + 2 per-severity cells
      await expect(sla.getByText('0%')).toHaveCount(4, { timeout: 10000 });
      await expect(sla.getByText('—')).toHaveCount(0);
    } finally {
      await svc.from('sla_timers').delete().eq('ticket_id', ticketId);
      await svc.from('activity_log').delete().eq('ticket_id', ticketId);
      await svc.from('tickets').delete().eq('id', ticketId);
    }
  });

  test('presets: 12 months and all time, active preset is marked', async ({ page }) => {
    await loginAs(page, 'admin@example.com');
    await page.goto('/reports');
    await expect(page.getByRole('button', { name: 'Last 30 days' })).toHaveAttribute('aria-pressed', 'true', { timeout: 10000 });
    await page.getByRole('button', { name: 'All time' }).click();
    await expect(page).toHaveURL(/start=/, { timeout: 10000 });
    await expect(page.getByRole('button', { name: 'All time' })).toHaveAttribute('aria-pressed', 'true', { timeout: 10000 });
    await expect(page).toHaveURL(/groupBy=month/, { timeout: 10000 });
    await expect(page.getByLabel('Group by')).toHaveValue('month', { timeout: 10000 });
    await page.getByRole('button', { name: 'Last 12 months' }).click();
    await expect(page.getByRole('button', { name: 'Last 12 months' })).toHaveAttribute('aria-pressed', 'true', { timeout: 10000 });
    await expect(page.getByLabel('Group by')).toHaveValue('week', { timeout: 10000 });
  });

  test('no horizontal overflow at 390px', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 800 });
    await loginAs(page, 'admin@example.com');
    await page.goto('/reports');
    await expect(page.getByTestId('report-controls')).toBeVisible({ timeout: 10000 });
    const ok = await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth);
    expect(ok).toBe(true);
  });
});

// ============================================================
// Reports - inclusive end date, CSV, export menu, daily option
// Report ranges are UTC calendar days; the ticket is created at noon UTC on day D.
// ============================================================

test.describe('Reports - range, CSV and export menu', () => {
  const DAY = '2098-03-10';
  const TIER_DAY = '2098-04-10'; // own day: tests run in parallel and tickets are global

  test('a ticket at noon on the end day is counted and exported', async ({ page }) => {
    const svc = createServiceRoleClient();
    const { data: alice } = await svc.from('profiles').select('id').eq('email', 'alice@example.com').single();
    const { data: typeData } = await svc.from('ticket_types').select('id').limit(1).single();
    const { data: ticket } = await svc
      .from('tickets')
      .insert({
        title: 'E2E Reports inclusive end ticket',
        slug: 'e2e-reports-inclusive-end-ticket',
        creator_id: alice!.id,
        type_id: typeData!.id,
        created_at: `${DAY}T12:00:00Z`,
      })
      .select('id')
      .single();
    const ticketId = ticket!.id;
    try {
      await loginAs(page, 'admin@example.com');
      await page.goto(`/reports?start=${DAY}&end=${DAY}`);
      await expect(page.getByTestId('ticket-volume-chart')).toBeVisible({ timeout: 10000 });
      await expect(page.getByText('No data for this period')).toHaveCount(0);

      const downloadPromise = page.waitForEvent('download', { timeout: 10000 });
      await page.getByText('Export CSV').click();
      await page.getByRole('button', { name: 'Ticket volume' }).click();
      const download = await downloadPromise;
      const csv = readFileSync((await download.path())!, 'utf8');
      expect(csv.split('\n').map((l) => l.trim())).toContain(`${DAY},1`);
    } finally {
      await svc.from('activity_log').delete().eq('ticket_id', ticketId);
      await svc.from('tickets').delete().eq('id', ticketId);
    }
  });

  test('CSV export honours the tier filter', async ({ page }) => {
    const svc = createServiceRoleClient();
    const { data: alice } = await svc.from('profiles').select('id, tier_id').eq('email', 'alice@example.com').single();
    const { data: bob } = await svc.from('profiles').select('id').eq('email', 'bob@example.com').single();
    const { data: typeData } = await svc.from('ticket_types').select('id').limit(1).single();
    const tierKey = `rpt-tier-${Date.now()}`;
    const { data: tier } = await svc
      .from('subscription_tiers')
      .insert({ key: tierKey, display_name: 'Rpt tier', sort_order: 999 })
      .select('id')
      .single();
    const ids: number[] = [];
    try {
      await svc.from('profiles').update({ tier_id: tier!.id }).eq('id', alice!.id);
      for (const [n, creator] of [['tier', alice!.id], ['other', bob!.id]] as const) {
        const { data: t } = await svc
          .from('tickets')
          .insert({
            title: `E2E Reports tier csv ${n}`,
            slug: `e2e-reports-tier-csv-${n}-${Date.now()}`,
            creator_id: creator,
            type_id: typeData!.id,
            created_at: `${TIER_DAY}T12:00:00Z`,
          })
          .select('id')
          .single();
        ids.push(t!.id);
      }
      await loginAs(page, 'admin@example.com');
      await page.goto(`/reports?start=${TIER_DAY}&end=${TIER_DAY}&tier=${tierKey}`);
      await expect(page.getByLabel('Tier')).toHaveValue(tierKey, { timeout: 10000 });
      const downloadPromise = page.waitForEvent('download', { timeout: 10000 });
      await page.getByText('Export CSV').click();
      await page.getByRole('button', { name: 'Ticket volume' }).click();
      const csv = readFileSync((await (await downloadPromise).path())!, 'utf8');
      expect(csv.split('\n').map((l) => l.trim())).toContain(`${TIER_DAY},1`);
    } finally {
      for (const id of ids) {
        await svc.from('activity_log').delete().eq('ticket_id', id);
        await svc.from('tickets').delete().eq('id', id);
      }
      await svc.from('profiles').update({ tier_id: alice!.tier_id }).eq('id', alice!.id);
      await svc.from('subscription_tiers').delete().eq('id', tier!.id);
    }
  });

  test('a rejected export shows an alert', async ({ page }) => {
    await loginAs(page, 'admin@example.com');
    await page.goto('/reports?start=2098-03-10&end=2098-03-01');
    await expect(page.getByTestId('report-controls')).toBeVisible({ timeout: 10000 });
    await page.getByText('Export CSV').click();
    await page.getByRole('button', { name: 'Ticket volume' }).click();
    await expect(page.getByRole('alert')).toContainText('start date', { timeout: 10000 });
  });

  test('Escape and outside click close the export menu', async ({ page }) => {
    await loginAs(page, 'admin@example.com');
    await page.goto('/reports');
    const details = page.locator('details').filter({ hasText: 'Export CSV' });
    const summary = details.locator('summary');
    await summary.click();
    await expect(details).toHaveAttribute('open', '');
    await page.keyboard.press('Escape');
    await expect(details).not.toHaveAttribute('open', '');
    await expect(summary).toBeFocused();
    await summary.click();
    await expect(details).toHaveAttribute('open', '');
    await page.getByRole('heading', { name: 'Reports' }).click();
    await expect(details).not.toHaveAttribute('open', '');
  });

  test('Daily is disabled for ranges over 366 days', async ({ page }) => {
    await loginAs(page, 'admin@example.com');
    await page.goto('/reports?start=2020-01-01&end=2026-01-01');
    const daily = page.getByLabel('Group by').locator('option[value="day"]');
    await expect(daily).toBeDisabled({ timeout: 10000 });
    await expect(daily).toHaveText('Daily (up to 1 year)');
    await page.goto('/reports?start=2026-01-01&end=2026-12-31');
    await expect(page.getByLabel('Group by').locator('option[value="day"]')).toBeEnabled();
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
  test('reports link visibility by role', async ({ page }) => {
    // Agent sees Reports as a top-nav link
    await loginAs(page, 'agent.smith@example.com');
    await expect(page.getByRole('link', { name: 'Reports' })).toBeVisible();

    // Sign out and log in as admin
    await page.locator('summary[aria-haspopup="true"]').click();
    await page.getByRole('menuitem', { name: 'Sign out' }).click();
    await expect(page).toHaveURL('/login', { timeout: 10000 });

    await loginAs(page, 'admin@example.com');
    await expect(page.getByRole('link', { name: 'Reports' })).toBeVisible();

    // Sign out and log in as regular user
    await page.locator('summary[aria-haspopup="true"]').click();
    await page.getByRole('menuitem', { name: 'Sign out' }).click();
    await expect(page).toHaveURL('/login', { timeout: 10000 });

    await loginAs(page, 'alice@example.com');
    await expect(page.getByRole('link', { name: 'Reports' })).not.toBeVisible();
  });
});
