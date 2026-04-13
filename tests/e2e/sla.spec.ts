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
  await expect(page.getByRole('button', { name: 'Sign out' })).toBeVisible({ timeout: 10000 });
}

/** Navigate to an admin page. */
async function gotoAdmin(page: Page, path: string) {
  await page.goto(path);
  if (!page.url().includes('/admin')) {
    await page.goto(path);
  }
}

// ============================================================
// SLA Indicators on Ticket Detail (Agent view)
// ============================================================

test.describe('SLA Indicators on Ticket Detail', () => {
  test.describe.configure({ mode: 'serial' });

  let ticketId: number;
  let ticketSlug: string;

  test.beforeAll(async () => {
    const svc = createServiceRoleClient();

    const { data: alice } = await svc
      .from('profiles')
      .select('id')
      .eq('email', 'alice@example.com')
      .single();

    const { data: agent } = await svc
      .from('profiles')
      .select('id')
      .eq('email', 'agent.smith@example.com')
      .single();

    const { data: typeData } = await svc.from('ticket_types').select('id').limit(1).single();

    // Ensure an SLA policy exists
    let policyId: string;
    const { data: existingPolicy } = await svc
      .from('sla_policies')
      .select('id')
      .limit(1)
      .single();
    if (existingPolicy) {
      policyId = existingPolicy.id;
    } else {
      const { data: newPolicy } = await svc
        .from('sla_policies')
        .insert({ name: 'E2E SLA Test Policy', first_response_minutes: 240, resolution_minutes: 1440 })
        .select('id')
        .single();
      policyId = newPolicy!.id;
    }

    // Create a ticket with an SLA timer
    const { data: ticket } = await svc
      .from('tickets')
      .insert({
        title: 'E2E SLA Indicator Ticket',
        slug: 'e2e-sla-indicator-ticket',
        creator_id: alice!.id,
        type_id: typeData!.id,
        assigned_agent_id: agent!.id,
      })
      .select('id, slug')
      .single();

    ticketId = ticket!.id;
    ticketSlug = ticket!.slug;

    // Create an SLA timer for this ticket (on_track, with a far deadline)
    const frDeadline = new Date(Date.now() + 4 * 60 * 60 * 1000).toISOString(); // 4h from now
    const resDeadline = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(); // 24h from now
    await svc.from('sla_timers').insert({
      ticket_id: ticketId,
      sla_policy_id: policyId,
      first_response_deadline: frDeadline,
      resolution_deadline: resDeadline,
    });
  });

  test.afterAll(async () => {
    const svc = createServiceRoleClient();
    await svc.from('sla_notifications_sent').delete().in(
      'sla_timer_id',
      (await svc.from('sla_timers').select('id').eq('ticket_id', ticketId)).data?.map((t: { id: string }) => t.id) ?? [],
    );
    await svc.from('sla_timers').delete().eq('ticket_id', ticketId);
    await svc.from('activity_log').delete().eq('ticket_id', ticketId);
    await svc.from('posts').delete().eq('ticket_id', ticketId);
    await svc.from('ticket_followers').delete().eq('ticket_id', ticketId);
    await svc.from('tickets').delete().eq('id', ticketId);
  });

  test('agent sees SLA indicators on ticket detail page', async ({ page }) => {
    await loginAs(page, 'agent.smith@example.com');
    await page.goto(`/tickets/${ticketId}/${ticketSlug}`);

    // SLA section should be visible for agents
    await expect(page.getByText('SLA Status')).toBeVisible({ timeout: 10000 });
    await expect(page.getByText('First Response')).toBeVisible();
    await expect(page.getByText('Resolution')).toBeVisible();
  });

  test('regular user does NOT see SLA indicators', async ({ page }) => {
    await loginAs(page, 'alice@example.com');
    await page.goto(`/tickets/${ticketId}/${ticketSlug}`);

    // The ticket title should be visible but SLA should not
    await expect(page.getByText('E2E SLA Indicator Ticket')).toBeVisible({ timeout: 10000 });
    await expect(page.getByText('SLA Status')).not.toBeVisible();
  });
});

// ============================================================
// SLA Column on Agent Dashboard
// ============================================================

test.describe('SLA on Agent Dashboard', () => {
  test('agent dashboard shows SLA column header', async ({ page }) => {
    await loginAs(page, 'agent.smith@example.com');
    await page.goto('/agent');
    await expect(page.getByRole('heading', { name: 'Agent Dashboard' })).toBeVisible({ timeout: 10000 });
    await expect(page.getByText('SLA', { exact: true })).toBeVisible();
  });

  test('SLA Risk sort option is available', async ({ page }) => {
    await loginAs(page, 'agent.smith@example.com');
    await page.goto('/agent');
    await expect(page.getByRole('heading', { name: 'Agent Dashboard' })).toBeVisible({ timeout: 10000 });

    const sortSelect = page.getByLabel('Sort');
    await expect(sortSelect).toBeVisible();

    // Check that SLA Risk is an option
    const options = sortSelect.locator('option');
    const optionTexts = await options.allTextContents();
    expect(optionTexts).toContain('SLA Risk');
  });

  test('sorting by SLA Risk works', async ({ page }) => {
    await loginAs(page, 'agent.smith@example.com');
    await page.goto('/agent');
    await expect(page.getByRole('heading', { name: 'Agent Dashboard' })).toBeVisible({ timeout: 10000 });

    await page.getByLabel('Sort').selectOption('sla');
    await page.getByRole('button', { name: 'Apply Filters' }).click();

    await expect(page).toHaveURL(/sort=sla/);
    const resultText = await page.getByTestId('result-count').textContent();
    expect(resultText).toMatch(/\d+ tickets? found/);
  });
});

// ============================================================
// SLA Admin — CRUD
// ============================================================

test.describe('SLA Admin Settings', () => {
  test.describe.configure({ mode: 'serial' });

  test.beforeAll(async () => {
    const svc = createServiceRoleClient();
    // Clean up leftover test policy from prior runs
    await svc.from('sla_policies').delete().eq('name', 'E2E Test Policy');
  });

  test('admin sidebar shows SLA Policies link', async ({ page }) => {
    await loginAs(page, 'admin@example.com');
    await gotoAdmin(page, '/admin/sla');
    await expect(page.getByRole('link', { name: 'SLA Policies' })).toBeVisible({ timeout: 10000 });
  });

  test('SLA admin page loads with policies section', async ({ page }) => {
    await loginAs(page, 'admin@example.com');
    await gotoAdmin(page, '/admin/sla');
    await expect(page.locator('h1')).toBeVisible({ timeout: 10000 });
    await expect(page.getByRole('heading', { name: 'Severity Mapping' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Business Hours' })).toBeVisible();
  });

  test('admin can create a new SLA policy', async ({ page }) => {
    await loginAs(page, 'admin@example.com');
    await gotoAdmin(page, '/admin/sla');
    await expect(page.locator('h1')).toBeVisible({ timeout: 10000 });

    // Fill in the create form
    await page.getByPlaceholder('e.g. Standard SLA').fill('E2E Test Policy');
    await page.getByPlaceholder('240').fill('30');
    await page.getByPlaceholder('1440').fill('120');
    await page.getByTestId('create-policy-btn').click();

    // Should reload and show the new policy in the table
    await expect(page.getByRole('cell', { name: 'E2E Test Policy', exact: true })).toBeVisible({ timeout: 10000 });
  });

  test('admin can delete the created policy', async ({ page }) => {
    await loginAs(page, 'admin@example.com');
    await gotoAdmin(page, '/admin/sla');
    await expect(page.getByRole('cell', { name: 'E2E Test Policy', exact: true })).toBeVisible({ timeout: 10000 });

    // Find the row with the policy and click delete
    const row = page.locator('tr', { hasText: 'E2E Test Policy' });
    await row.getByRole('button', { name: /delete/i }).click();

    // Should no longer appear
    await expect(page.getByRole('cell', { name: 'E2E Test Policy', exact: true })).not.toBeVisible({ timeout: 10000 });
  });

  test('approaching threshold section exists', async ({ page }) => {
    await loginAs(page, 'admin@example.com');
    await gotoAdmin(page, '/admin/sla');
    await expect(page.getByRole('heading', { name: 'SLA Approaching Threshold' })).toBeVisible({ timeout: 10000 });
  });
});
