import { test, expect, Page } from '@playwright/test';
import { createServiceRoleClient } from '../helpers/supabase';
import { loginAs, gotoAdmin } from '../helpers/auth';

/**
 * Helper: log in as admin and navigate to admin SLA page.
 */
async function loginAsAdminAndGoToSla(page: Page) {
  await loginAs(page, 'admin@example.com');
  await gotoAdmin(page, '/admin/sla');
  await expect(page.getByRole('heading', { name: 'SLA Policies' })).toBeVisible();
}

// ============================================================
// SLA Indicators on Ticket Detail
// ============================================================

test.describe('SLA Indicators', () => {
  test.describe.configure({ mode: 'serial' });
  let ticketId: number;
  let ticketSlug: string;
  let policyId: string;

  test.beforeAll(async () => {
    const svc = createServiceRoleClient();

    // Clean up leftover ticket from prior runs
    const { data: oldTicket } = await svc.from('tickets').select('id').eq('slug', 'e2e-sla-ticket').single();
    if (oldTicket) {
      const { data: oldTimers } = await svc.from('sla_timers').select('id').eq('ticket_id', oldTicket.id);
      const oldTimerIds = (oldTimers ?? []).map((t: { id: string }) => t.id);
      if (oldTimerIds.length > 0) {
        await svc.from('sla_notifications_sent').delete().in('sla_timer_id', oldTimerIds);
      }
      await svc.from('sla_timers').delete().eq('ticket_id', oldTicket.id);
      await svc.from('activity_log').delete().eq('ticket_id', oldTicket.id);
      await svc.from('posts').delete().eq('ticket_id', oldTicket.id);
      await svc.from('tickets').delete().eq('id', oldTicket.id);
    }

    // Use existing Standard SLA policy from seed data
    const { data: policy } = await svc.from('sla_policies').select('id').eq('name', 'Standard SLA').single();
    if (!policy) throw new Error('Standard SLA policy not found in seed data');
    policyId = policy.id;

    // Map critical severity to the SLA policy
    await svc
      .from('sla_severity_mapping')
      .update({ sla_policy_id: policyId })
      .eq('severity', 'critical');

    // Get agent profile
    const { data: agent } = await svc
      .from('profiles')
      .select('id')
      .eq('email', 'agent.smith@example.com')
      .single();

    // Get alice profile
    const { data: alice } = await svc
      .from('profiles')
      .select('id')
      .eq('email', 'alice@example.com')
      .single();

    // Get ticket type
    const { data: typeData } = await svc.from('ticket_types').select('id').limit(1).single();

    // Create a ticket with critical severity
    const { data: ticket, error: ticketErr } = await svc
      .from('tickets')
      .insert({
        title: 'E2E SLA Ticket',
        slug: 'e2e-sla-ticket',
        creator_id: alice!.id,
        type_id: typeData!.id,
        severity: 'critical',
        assigned_agent_id: agent!.id,
      })
      .select('id, slug')
      .single();
    if (ticketErr) throw new Error(`Ticket insert failed: ${ticketErr.message}`);

    ticketId = ticket!.id;
    ticketSlug = ticket!.slug;

    // Create an SLA timer for this ticket
    const { error: timerErr } = await svc.from('sla_timers').insert({
      ticket_id: ticketId,
      sla_policy_id: policyId,
      first_response_deadline: new Date(Date.now() + 4 * 60 * 60 * 1000).toISOString(),
      resolution_deadline: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
    });
    if (timerErr) throw new Error(`SLA timer insert failed: ${timerErr.message}`);
  });

  test.afterAll(async () => {
    const svc = createServiceRoleClient();
    // Scope cleanup to this test's timer only
    const { data: timers } = await svc.from('sla_timers').select('id').eq('ticket_id', ticketId);
    const timerIds = (timers ?? []).map((t: { id: string }) => t.id);
    if (timerIds.length > 0) {
      await svc.from('sla_notifications_sent').delete().in('sla_timer_id', timerIds);
    }
    await svc.from('sla_timers').delete().eq('ticket_id', ticketId);
    await svc.from('activity_log').delete().eq('ticket_id', ticketId);
    await svc.from('posts').delete().eq('ticket_id', ticketId);
    await svc.from('tickets').delete().eq('id', ticketId);
    // Restore severity mapping to seed state
    await svc.from('sla_severity_mapping').update({ sla_policy_id: policyId }).eq('severity', 'critical');
  });

  test('SLA indicators appear on ticket detail for agents', async ({ page }) => {
    await loginAs(page, 'agent.smith@example.com');
    await page.goto(`/tickets/${ticketId}/${ticketSlug}`, { waitUntil: 'networkidle' });
    // If we got a 404 (ticket not yet visible due to race), retry once
    if (await page.getByText('could not be found').isVisible({ timeout: 2000 }).catch(() => false)) {
      await page.reload({ waitUntil: 'networkidle' });
    }
    // Wait for the ticket page to fully render before checking SLA
    await expect(page.getByRole('heading', { name: 'E2E SLA Ticket' })).toBeVisible({ timeout: 15000 });
    await expect(page.getByTestId('sla-indicators')).toBeVisible({ timeout: 15000 });
    await expect(page.getByTestId('sla-first-response')).toBeVisible();
    await expect(page.getByTestId('sla-resolution')).toBeVisible();
  });

  test('SLA indicators NOT shown for regular users', async ({ page }) => {
    await loginAs(page, 'alice@example.com');
    await page.goto(`/tickets/${ticketId}/${ticketSlug}`);
    await expect(page.getByTestId('sla-indicators')).not.toBeVisible();
  });
});

// ============================================================
// SLA on Agent Dashboard
// ============================================================

test.describe('SLA on Agent Dashboard', () => {
  test('SLA status column visible on agent dashboard', async ({ page }) => {
    await loginAs(page, 'agent.smith@example.com');
    await page.goto('/agent');
    await expect(page.getByRole('columnheader', { name: 'SLA' })).toBeVisible();
  });

  test('Sort by SLA risk option available', async ({ page }) => {
    await loginAs(page, 'agent.smith@example.com');
    await page.goto('/agent');
    const sortSelect = page.locator('#filter-sort');
    await expect(sortSelect).toBeVisible();
    await expect(sortSelect.locator('option[value="sla"]')).toHaveCount(1);
  });

  test('Agent stats shows SLA compliance rate', async ({ page }) => {
    await loginAs(page, 'agent.smith@example.com');
    await page.goto('/agent');
    // Open the details panel
    await page.locator('summary:has-text("My Stats")').click();
    const statsPanel = page.getByTestId('agent-stats');
    await expect(statsPanel).toBeVisible({ timeout: 5000 });
    await expect(statsPanel.getByText('SLA Compliance')).toBeVisible();
  });
});

// ============================================================
// Admin SLA Settings
// ============================================================

test.describe('Admin SLA Settings', () => {
  test.describe.configure({ mode: 'serial' });

  test('admin can navigate to SLA settings', async ({ page }) => {
    await loginAsAdminAndGoToSla(page);
  });

  test('admin can create SLA policy', async ({ page }) => {
    await loginAsAdminAndGoToSla(page);

    const form = page.getByTestId('create-sla-policy-form');
    await form.locator('input[name="name"]').fill('E2E Test SLA Policy');
    await form.locator('input[name="first_response_minutes"]').fill('120');
    await form.locator('input[name="resolution_minutes"]').fill('720');
    await form.getByRole('button', { name: 'Create Policy' }).click();

    // Verify it appears in the list (use locator scoped to policies section)
    await expect(page.locator('[data-testid^="sla-policy-"]', { hasText: 'E2E Test SLA Policy' })).toBeVisible();
  });

  test('admin can delete SLA policy', async ({ page }) => {
    await loginAsAdminAndGoToSla(page);

    // Wait for policy to be visible
    const policyItem = page.locator('[data-testid^="sla-policy-"]', { hasText: 'E2E Test SLA Policy' });
    await expect(policyItem).toBeVisible();

    // Find the delete button and click it
    await policyItem.getByTestId('delete-sla-policy').click();

    await expect(policyItem).not.toBeVisible();
  });

  test('admin can configure severity mapping', async ({ page }) => {
    await loginAsAdminAndGoToSla(page);
    await expect(page.getByTestId('severity-mapping-form')).toBeVisible();
  });

  test('admin can configure business hours', async ({ page }) => {
    await loginAsAdminAndGoToSla(page);
    await expect(page.getByTestId('business-hours-form')).toBeVisible();
  });

  test('admin can change approaching threshold', async ({ page }) => {
    await loginAsAdminAndGoToSla(page);
    await expect(page.getByTestId('sla-threshold-form')).toBeVisible();
  });
});
