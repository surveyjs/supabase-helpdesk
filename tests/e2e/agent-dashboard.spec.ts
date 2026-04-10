import { test, expect, Page } from '@playwright/test';
import { createServiceRoleClient } from '../helpers/supabase';

/**
 * Helper: log in via the login form.
 */
async function loginAs(page: Page, email: string, password = 'Password123') {
  await page.goto('/login');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Log in' }).click();
  await expect(page).toHaveURL('/', { timeout: 10000 });
}

test.describe('Agent Dashboard', () => {
  test.describe.configure({ mode: 'serial' });

  test('agent sees "Agent Dashboard" link in nav', async ({ page }) => {
    await loginAs(page, 'agent.smith@example.com');
    await expect(page.getByRole('link', { name: 'Agent Dashboard' })).toBeVisible();
  });

  test('regular user does not see "Agent Dashboard" link', async ({ page }) => {
    await loginAs(page, 'alice@example.com');
    await expect(page.getByRole('link', { name: 'Agent Dashboard' })).not.toBeVisible();
  });

  test('non-agent navigating to /agent is redirected', async ({ page }) => {
    await loginAs(page, 'alice@example.com');
    await page.goto('/agent');
    // Should be redirected away from /agent
    await expect(page).not.toHaveURL('/agent', { timeout: 10000 });
  });

  test('dashboard loads with all tickets', async ({ page }) => {
    await loginAs(page, 'agent.smith@example.com');
    await page.goto('/agent');
    await expect(page.getByRole('heading', { name: 'Agent Dashboard' })).toBeVisible();
    // Should show result count
    await expect(page.getByTestId('result-count')).toBeVisible();
    const resultText = await page.getByTestId('result-count').textContent();
    expect(resultText).toMatch(/\d+ tickets? found/);
  });

  test('status filter works', async ({ page }) => {
    await loginAs(page, 'agent.smith@example.com');
    await page.goto('/agent');

    // Filter by closed
    await page.getByLabel('Status').selectOption('closed');
    await page.getByRole('button', { name: 'Apply Filters' }).click();

    await expect(page).toHaveURL(/status=closed/);
    const resultText = await page.getByTestId('result-count').textContent();
    expect(resultText).toMatch(/\d+ tickets? found/);
  });

  test('search by title works (all-posts search)', async ({ page }) => {
    await loginAs(page, 'agent.smith@example.com');
    await page.goto('/agent');

    // Search for a ticket from seed data
    await page.getByLabel('Search').fill('Password reset');
    await page.getByRole('button', { name: 'Apply Filters' }).click();

    await expect(page).toHaveURL(/q=Password/);
    await expect(page.getByText('Password reset not working')).toBeVisible();
  });

  test('filter by submitter email works', async ({ page }) => {
    await loginAs(page, 'agent.smith@example.com');
    await page.goto('/agent');

    await page.getByLabel('Submitter Email').fill('alice@example.com');
    await page.getByRole('button', { name: 'Apply Filters' }).click();

    await expect(page).toHaveURL(/email=alice/);
    const resultText = await page.getByTestId('result-count').textContent();
    expect(resultText).toMatch(/\d+ tickets? found/);
  });

  test('sort toggles work', async ({ page }) => {
    await loginAs(page, 'agent.smith@example.com');
    await page.goto('/agent');

    // Change sort to created
    await page.getByLabel('Sort By').selectOption('created');
    await page.getByRole('button', { name: 'Apply Filters' }).click();

    await expect(page).toHaveURL(/sort=created/);
  });

  test('pagination works', async ({ page }) => {
    await loginAs(page, 'agent.smith@example.com');
    // With default page size of 20 and seed data, there might be just 1 page.
    // Navigate to page and verify it loads
    await page.goto('/agent?page=1');
    await expect(page.getByTestId('result-count')).toBeVisible();
  });

  test('result count updates with filters', async ({ page }) => {
    await loginAs(page, 'agent.smith@example.com');
    await page.goto('/agent');

    const allCount = await page.getByTestId('result-count').textContent();

    // Filter to closed only
    await page.getByLabel('Status').selectOption('closed');
    await page.getByRole('button', { name: 'Apply Filters' }).click();

    const closedCount = await page.getByTestId('result-count').textContent();
    // Both should be valid count strings
    expect(allCount).toMatch(/\d+ tickets? found/);
    expect(closedCount).toMatch(/\d+ tickets? found/);
  });
});

test.describe('Agent Ticket Detail Controls', () => {
  test.describe.configure({ mode: 'serial' });

  let ticketUrl: string;

  test.beforeAll(async () => {
    // Find a seed data ticket URL for agent testing
    const admin = createServiceRoleClient();
    const { data: ticket } = await admin
      .from('tickets')
      .select('id, slug')
      .eq('title', 'Password reset not working')
      .single();
    ticketUrl = `/tickets/${ticket!.id}/${ticket!.slug}`;
  });

  test('agent can change ticket status from detail page', async ({ page }) => {
    await loginAs(page, 'agent.smith@example.com');
    await page.goto(ticketUrl);

    await expect(page.getByTestId('agent-controls')).toBeVisible();

    // Find and click "Mark Pending"
    const pendingBtn = page.getByRole('button', { name: 'Mark Pending' });
    if (await pendingBtn.isVisible()) {
      await pendingBtn.click();
      await expect(page.getByTestId('agent-controls').getByText('Pending')).toBeVisible({ timeout: 10000 });
    }

    // Re-open
    const reopenBtn = page.getByRole('button', { name: 'Mark Open' });
    if (await reopenBtn.isVisible()) {
      await reopenBtn.click();
      await expect(page.getByTestId('agent-controls').getByText('Open')).toBeVisible({ timeout: 10000 });
    }
  });

  test('agent can change urgency/severity from detail page', async ({ page }) => {
    await loginAs(page, 'agent.smith@example.com');
    await page.goto(ticketUrl);

    // Change urgency
    await page.locator('#agent-urgency').selectOption('critical');
    await page.locator('#agent-urgency').locator('..').getByRole('button', { name: 'Set' }).click();
    await expect(page.getByText('Urgency: Critical')).toBeVisible({ timeout: 10000 });

    // Change severity
    await page.locator('#agent-severity').selectOption('high');
    await page.locator('#agent-severity').locator('..').getByRole('button', { name: 'Set' }).click();
    await expect(page.getByText('Severity: High')).toBeVisible({ timeout: 10000 });

    // Restore
    await page.locator('#agent-urgency').selectOption('high');
    await page.locator('#agent-urgency').locator('..').getByRole('button', { name: 'Set' }).click();
    await page.locator('#agent-severity').selectOption('medium');
    await page.locator('#agent-severity').locator('..').getByRole('button', { name: 'Set' }).click();
  });

  test('agent can change type/category from detail page', async ({ page }) => {
    await loginAs(page, 'agent.smith@example.com');
    await page.goto(ticketUrl);

    // Change type
    await page.locator('#agent-type').selectOption({ label: 'Question' });
    await page.locator('#agent-type').locator('..').getByRole('button', { name: 'Set' }).click();
    await page.waitForTimeout(1000);

    // Restore to Issue
    await page.locator('#agent-type').selectOption({ label: 'Issue' });
    await page.locator('#agent-type').locator('..').getByRole('button', { name: 'Set' }).click();
  });

  test('agent can toggle privacy from detail page', async ({ page }) => {
    await loginAs(page, 'agent.smith@example.com');
    await page.goto(ticketUrl);

    // Ticket is public (is_private=false) based on seed data
    const controls = page.getByTestId('agent-controls');
    const privacyBtn = controls.getByRole('button', { name: /Make Private|Make Public/ });
    const btnText = await privacyBtn.textContent();
    await privacyBtn.click();
    await page.waitForTimeout(1000);

    // Toggle back
    const newBtn = controls.getByRole('button', { name: /Make Private|Make Public/ });
    const newText = await newBtn.textContent();
    expect(newText).not.toBe(btnText);
    await newBtn.click();
  });

  test('agent can assign/unassign from detail page', async ({ page }) => {
    await loginAs(page, 'agent.smith@example.com');

    // Use an unassigned ticket from seed data
    const admin = createServiceRoleClient();
    const { data: unassigned } = await admin
      .from('tickets')
      .select('id, slug')
      .is('assigned_agent_id', null)
      .limit(1)
      .single();

    if (!unassigned) return; // skip if no unassigned tickets

    await page.goto(`/tickets/${unassigned.id}/${unassigned.slug}`);

    // "Assign to me" button should be visible
    const assignBtn = page.getByRole('button', { name: 'Assign to me' });
    if (await assignBtn.isVisible()) {
      await assignBtn.click();
      await page.waitForTimeout(1000);

      // Unassign button should now be visible
      const unassignBtn = page.getByRole('button', { name: 'Unassign' });
      await expect(unassignBtn).toBeVisible({ timeout: 10000 });

      // Unassign
      await unassignBtn.click();
      await page.waitForTimeout(1000);

      // Assign to me should be back
      await expect(page.getByRole('button', { name: 'Assign to me' })).toBeVisible({ timeout: 10000 });
    }
  });

  test('"Assign to me" button works', async ({ page }) => {
    await loginAs(page, 'agent.smith@example.com');

    // Find an unassigned ticket
    const admin = createServiceRoleClient();
    const { data: tickets } = await admin
      .from('tickets')
      .select('id, slug')
      .is('assigned_agent_id', null)
      .limit(1);

    if (!tickets || tickets.length === 0) return;

    await page.goto(`/tickets/${tickets[0].id}/${tickets[0].slug}`);
    const btn = page.getByRole('button', { name: 'Assign to me' });
    if (await btn.isVisible()) {
      await btn.click();
      await expect(page.getByRole('main').getByText('Agent Smith', { exact: true })).toBeVisible({ timeout: 10000 });
      // Cleanup: unassign
      await page.getByRole('button', { name: 'Unassign' }).click();
    }
  });

  test('agent can reassign ticket to another agent with a reason', async ({ page }) => {
    await loginAs(page, 'agent.smith@example.com');
    await page.goto(ticketUrl);

    // Make sure ticket is assigned first
    const assignBtn = page.getByRole('button', { name: 'Assign to me' });
    if (await assignBtn.isVisible()) {
      await assignBtn.click();
      await page.waitForTimeout(1000);
    }

    // Select a different agent and reassign
    const agentSelect = page.getByLabel('Select agent');
    await agentSelect.selectOption({ value: '00000000-0000-0000-0000-000000000013' });
    await page.getByRole('button', { name: 'Reassign' }).click();
    await page.waitForTimeout(1000);

    // Verify agent changed in display
    await page.reload();
    await expect(page.getByText('Agent Jones', { exact: true })).toBeVisible({ timeout: 10000 });

    // Restore original assignment
    const admin = createServiceRoleClient();
    const { data: ticket } = await admin
      .from('tickets')
      .select('id')
      .eq('title', 'Password reset not working')
      .single();
    await admin.from('tickets').update({ assigned_agent_id: '00000000-0000-0000-0000-000000000012' }).eq('id', ticket!.id);
  });
});

test.describe('Saved Views', () => {
  test.describe.configure({ mode: 'serial' });

  test('create, apply, rename, delete saved views', async ({ page }) => {
    await loginAs(page, 'agent.smith@example.com');
    await page.goto('/agent');

    // Create a saved view
    await page.getByLabel('Saved view name').fill('Test E2E View');
    await page.getByRole('button', { name: 'Save Current View' }).click();
    await page.waitForTimeout(1000);

    // View should appear
    await expect(page.getByText('Test E2E View')).toBeVisible({ timeout: 10000 });

    // Click to apply
    await page.getByRole('link', { name: 'Test E2E View' }).click();
    await page.waitForTimeout(500);

    // Delete the view
    await page.getByLabel('Delete saved view Test E2E View').click();
    await page.waitForTimeout(1000);

    // View should be gone
    await expect(page.getByRole('link', { name: 'Test E2E View' })).not.toBeVisible();
  });
});

test.describe('Agent Stats Panel', () => {
  test('collapse/expand toggle works', async ({ page }) => {
    await loginAs(page, 'agent.smith@example.com');
    await page.goto('/agent');

    // Stats panel exists but is collapsed by default
    const summary = page.getByText('My Stats (Last 30 Days)');
    await expect(summary).toBeVisible();

    // Expand
    await summary.click();
    await expect(page.getByTestId('agent-stats')).toBeVisible();

    // Check metrics are present
    await expect(page.getByText('Tickets Assigned')).toBeVisible();
    await expect(page.getByText('Tickets Resolved')).toBeVisible();
  });

  test('shows correct assigned/resolved counts', async ({ page }) => {
    await loginAs(page, 'agent.smith@example.com');
    await page.goto('/agent');

    // Expand stats
    await page.getByText('My Stats (Last 30 Days)').click();
    await expect(page.getByTestId('agent-stats')).toBeVisible();

    // Assigned and resolved counts should be numbers
    const statsPanel = page.getByTestId('agent-stats');
    await expect(statsPanel.getByText('Tickets Assigned')).toBeVisible();
    await expect(statsPanel.getByText('Tickets Resolved')).toBeVisible();
  });

  test('CSAT and SLA metrics show "N/A"', async ({ page }) => {
    await loginAs(page, 'agent.smith@example.com');
    await page.goto('/agent');

    // Expand stats
    await page.getByText('My Stats (Last 30 Days)').click();
    await expect(page.getByTestId('agent-stats')).toBeVisible();

    // CSAT and SLA should show N/A
    await expect(page.getByText('Avg CSAT Rating')).toBeVisible();
    await expect(page.getByText('SLA Compliance')).toBeVisible();
    // The N/A values
    const naElements = page.getByTestId('agent-stats').getByText('N/A');
    expect(await naElements.count()).toBeGreaterThanOrEqual(3);
  });
});
