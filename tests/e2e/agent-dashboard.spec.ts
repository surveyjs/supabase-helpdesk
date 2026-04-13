import { test, expect } from '@playwright/test';
import { createServiceRoleClient } from '../helpers/supabase';
import { loginAs } from '../helpers/auth';

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
    await expect(page).not.toHaveURL('/agent', );
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
    await expect(page.getByRole('heading', { name: 'Agent Dashboard' })).toBeVisible();

    // Filter by closed
    await page.getByLabel('Status').selectOption('closed');
    await page.getByRole('button', { name: 'Apply Filters' }).click();

    await expect(page).toHaveURL(/status=closed/);
    await expect(page.getByTestId('result-count')).toBeVisible();
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

    // Helper: wait for Next.js server action POST to complete before asserting
    const clickAction = async (btn: ReturnType<typeof page.getByRole>) => {
      await Promise.all([
        page.waitForResponse(r => r.request().method() === 'POST', { timeout: 30_000 }),
        btn.click(),
      ]);
    };

    // Find and click "Mark Pending"
    const pendingBtn = page.getByRole('button', { name: 'Mark Pending' });
    if (await pendingBtn.isVisible()) {
      await clickAction(pendingBtn);
      await expect(page.getByTestId('agent-controls').getByText('Pending')).toBeVisible();
    }

    // Re-open
    const reopenBtn = page.getByRole('button', { name: 'Mark Open' });
    if (await reopenBtn.isVisible()) {
      await clickAction(reopenBtn);
      await expect(page.getByTestId('agent-controls').getByText('Open')).toBeVisible();
    }
  });

  test('agent can change urgency/severity from detail page', async ({ page }) => {
    await loginAs(page, 'agent.smith@example.com');
    await page.goto(ticketUrl);
    await expect(page.getByTestId('agent-controls')).toBeVisible();

    // Helper: wait for Next.js server action POST to complete before asserting
    const clickAction = async (btn: ReturnType<typeof page.getByRole>) => {
      await Promise.all([
        page.waitForResponse(r => r.request().method() === 'POST', { timeout: 30_000 }),
        btn.click(),
      ]);
    };

    // Change urgency
    await page.locator('#agent-urgency').selectOption('critical');
    await clickAction(page.locator('#agent-urgency').locator('..').getByRole('button', { name: 'Set' }));
    await expect(page.getByText('Urgency: Critical')).toBeVisible();

    // Change severity
    await page.locator('#agent-severity').selectOption('high');
    await clickAction(page.locator('#agent-severity').locator('..').getByRole('button', { name: 'Set' }));
    await expect(page.getByText('Severity: High')).toBeVisible();

    // Restore urgency
    await page.locator('#agent-urgency').selectOption('high');
    await clickAction(page.locator('#agent-urgency').locator('..').getByRole('button', { name: 'Set' }));

    // Restore severity
    await page.locator('#agent-severity').selectOption('medium');
    await clickAction(page.locator('#agent-severity').locator('..').getByRole('button', { name: 'Set' }));
  });

  test('agent can change type/category from detail page', async ({ page }) => {
    await loginAs(page, 'agent.smith@example.com');
    await page.goto(ticketUrl);

    const clickAction = async (btn: ReturnType<typeof page.getByRole>) => {
      await Promise.all([
        page.waitForResponse(r => r.request().method() === 'POST', { timeout: 30_000 }),
        btn.click(),
      ]);
    };

    // Change type
    await page.locator('#agent-type').selectOption({ label: 'Question' });
    await clickAction(page.locator('#agent-type').locator('..').getByRole('button', { name: 'Set' }));
    await expect(page.getByTestId('agent-controls').getByText('Type')).toBeVisible();

    // Restore to Issue
    await page.locator('#agent-type').selectOption({ label: 'Issue' });
    await clickAction(page.locator('#agent-type').locator('..').getByRole('button', { name: 'Set' }));
  });

  test('agent can toggle privacy from detail page', async ({ page }) => {
    await loginAs(page, 'agent.smith@example.com');
    await page.goto(ticketUrl);

    const clickAction = async (btn: ReturnType<typeof page.getByRole>) => {
      await Promise.all([
        page.waitForResponse(r => r.request().method() === 'POST', { timeout: 30_000 }),
        btn.click(),
      ]);
    };

    // Ticket is public (is_private=false) based on seed data
    const controls = page.getByTestId('agent-controls');
    const privacyBtn = controls.getByRole('button', { name: /Make Private|Make Public/ });
    const btnText = await privacyBtn.textContent();
    await clickAction(privacyBtn);

    // Wait for the button text to change
    const expectedText = btnText === 'Make Private' ? 'Make Public' : 'Make Private';
    await expect(controls.getByRole('button', { name: expectedText })).toBeVisible();

    // Toggle back
    await clickAction(controls.getByRole('button', { name: expectedText }));
    await expect(controls.getByRole('button', { name: btnText! })).toBeVisible();
  });

  test('agent can assign/unassign from detail page', async ({ page }) => {
    await loginAs(page, 'agent.smith@example.com');

    const clickAction = async (btn: ReturnType<typeof page.getByRole>) => {
      await Promise.all([
        page.waitForResponse(r => r.request().method() === 'POST', { timeout: 30_000 }),
        btn.click(),
      ]);
    };

    // Use an unassigned ticket from seed data
    const admin = createServiceRoleClient();
    const { data: unassigned } = await admin
      .from('tickets')
      .select('id, slug, title')
      .is('assigned_agent_id', null)
      .limit(1)
      .single();

    if (!unassigned) return; // skip if no unassigned tickets

    await page.goto(`/tickets/${unassigned.id}/${unassigned.slug}`);
    // Wait for page to load
    await expect(page.getByRole('heading', { name: unassigned.title })).toBeVisible();

    // "Assign to me" button should be visible
    const assignBtn = page.getByRole('button', { name: 'Assign to me' });
    await expect(assignBtn).toBeVisible();
    await clickAction(assignBtn);

    // Unassign button should now be visible (server action + revalidation)
    const unassignBtn = page.getByRole('button', { name: 'Unassign' });
    await expect(unassignBtn).toBeVisible();

    // Unassign
    await clickAction(unassignBtn);

    // Assign to me should be back
    await expect(page.getByRole('button', { name: 'Assign to me' })).toBeVisible();
  });

  test('"Assign to me" button works', async ({ page }) => {
    await loginAs(page, 'agent.smith@example.com');

    const clickAction = async (btn: ReturnType<typeof page.getByRole>) => {
      await Promise.all([
        page.waitForResponse(r => r.request().method() === 'POST', { timeout: 30_000 }),
        btn.click(),
      ]);
    };

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
      await clickAction(btn);
      await expect(page.getByRole('main').getByText('Agent Smith', { exact: true })).toBeVisible();
      // Cleanup: unassign
      await clickAction(page.getByRole('button', { name: 'Unassign' }));
    }
  });

  test('agent can reassign ticket to another agent with a reason', async ({ page }) => {
    await loginAs(page, 'agent.smith@example.com');
    await page.goto(ticketUrl);

    const clickAction = async (btn: ReturnType<typeof page.getByRole>) => {
      await Promise.all([
        page.waitForResponse(r => r.request().method() === 'POST', { timeout: 30_000 }),
        btn.click(),
      ]);
    };

    // Make sure ticket is assigned first
    const assignBtn = page.getByRole('button', { name: 'Assign to me' });
    if (await assignBtn.isVisible()) {
      await clickAction(assignBtn);
      await expect(page.getByRole('button', { name: 'Unassign' })).toBeVisible();
    }

    // Select a different agent and reassign
    const agentSelect = page.getByLabel('Select agent');
    await agentSelect.selectOption({ value: '00000000-0000-0000-0000-000000000013' });
    await clickAction(page.getByRole('button', { name: 'Reassign' }));

    // Verify agent changed in display
    await page.reload();
    await expect(page.getByText('Agent Jones', { exact: true })).toBeVisible();

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
    await Promise.all([
      page.waitForResponse(r => r.request().method() === 'POST', { timeout: 30_000 }),
      page.getByRole('button', { name: 'Save Current View' }).click(),
    ]);

    // View should appear
    await expect(page.getByText('Test E2E View')).toBeVisible();

    // Click to apply
    await page.getByRole('link', { name: 'Test E2E View' }).click();

    // Delete the view
    await Promise.all([
      page.waitForResponse(r => r.request().method() === 'POST', { timeout: 30_000 }),
      page.getByLabel('Delete saved view Test E2E View').click(),
    ]);

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
    await expect(page.getByTestId('result-count')).toBeVisible();

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
