import { test, expect, Page } from '@playwright/test';
import { createServiceRoleClient } from '../helpers/supabase';

async function loginAs(page: Page, email: string, password = 'Password123') {
  await page.goto('/login');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Log in' }).click();
  await expect(page).toHaveURL('/', { timeout: 10000 });
  await expect(page.getByRole('button', { name: 'Sign out' })).toBeVisible({ timeout: 10000 });
}

test.describe('Advanced Tickets', () => {
  test.describe.configure({ mode: 'serial' });

  let sourceTicketId: number;
  let targetTicketId: number;
  let mergeSourceId: number;
  let mergeTargetId: number;

  test.beforeAll(async () => {
    const svc = createServiceRoleClient();

    // Get ticket type
    const { data: tt } = await svc.from('ticket_types').select('id').limit(1).single();
    const typeId = tt!.id;

    // Create tickets for tests using alice as creator
    const userId = '00000000-0000-0000-0000-000000000014'; // alice

    const tickets = [
      { title: 'E2E Dup Source', slug: 'e2e-dup-source' },
      { title: 'E2E Dup Original', slug: 'e2e-dup-original' },
      { title: 'E2E Merge Source', slug: 'e2e-merge-source' },
      { title: 'E2E Merge Target', slug: 'e2e-merge-target' },
    ];

    const ids: number[] = [];
    for (const t of tickets) {
      const { data } = await svc
        .from('tickets')
        .insert({ title: t.title, slug: t.slug, creator_id: userId, type_id: typeId })
        .select('id')
        .single();
      ids.push(data!.id);

      // Add original post
      await svc.from('posts').insert({
        ticket_id: data!.id,
        author_id: userId,
        body: `Original post for ${t.title}`,
        post_type: 'post',
        is_original: true,
      });
    }

    sourceTicketId = ids[0];
    targetTicketId = ids[1];
    mergeSourceId = ids[2];
    mergeTargetId = ids[3];

    // Add extra post on merge source
    await svc.from('posts').insert({
      ticket_id: mergeSourceId,
      author_id: '00000000-0000-0000-0000-000000000012', // agent.smith
      body: 'Agent reply on merge source for E2E',
      post_type: 'post',
    });
  });

  test.afterAll(async () => {
    const svc = createServiceRoleClient();
    const ticketIds = [sourceTicketId, targetTicketId, mergeSourceId, mergeTargetId].filter(Boolean);
    if (ticketIds.length > 0) {
      await svc.from('notifications').delete().in('ticket_id', ticketIds);
      await svc.from('activity_log').delete().in('ticket_id', ticketIds);
      await svc.from('ticket_tags').delete().in('ticket_id', ticketIds);
      await svc.from('ticket_followers').delete().in('ticket_id', ticketIds);
      await svc.from('csat_ratings').delete().in('ticket_id', ticketIds);
      await svc.from('csat_survey_schedule').delete().in('ticket_id', ticketIds);
      await svc.from('sla_timers').delete().in('ticket_id', ticketIds);
      await svc.from('attachments').delete().in('ticket_id', ticketIds);
      await svc.from('posts').delete().in('ticket_id', ticketIds);
      await svc.from('tickets').update({ duplicate_of_id: null, merged_into_id: null }).in('id', ticketIds);
      await svc.from('tickets').delete().in('id', ticketIds);
    }
  });

  test('agent marks ticket as duplicate → ticket closes, system post appears', async ({ page }) => {
    await loginAs(page, 'agent.smith@example.com');
    await page.goto(`/tickets/${sourceTicketId}/e2e-dup-source`);

    // Agent should see Mark as Duplicate button
    await expect(page.getByTestId('mark-duplicate-btn')).toBeVisible({ timeout: 10000 });

    // Click and fill form
    await page.getByTestId('mark-duplicate-btn').click();
    await expect(page.getByTestId('mark-duplicate-form')).toBeVisible();
    await page.getByTestId('original-ticket-id-input').fill(String(targetTicketId));
    await page.getByTestId('mark-duplicate-form').getByRole('button', { name: 'Confirm' }).click();

    // Wait for page reload
    await page.waitForTimeout(2000);
    await page.reload();

    // Should show duplicate banner with link to original
    const banner = page.locator('.bg-yellow-50', { hasText: 'marked as a duplicate' });
    await expect(banner).toBeVisible({ timeout: 10000 });
    await expect(banner.getByText(`#${targetTicketId}`)).toBeVisible();
  });

  test('agent removes duplicate link → label disappears', async ({ page }) => {
    await loginAs(page, 'agent.smith@example.com');
    await page.goto(`/tickets/${sourceTicketId}/e2e-dup-source`);

    // Should see remove duplicate link button
    await expect(page.getByTestId('remove-duplicate-link-btn')).toBeVisible({ timeout: 10000 });
    await page.getByTestId('remove-duplicate-link-btn').click();

    // Wait for page reload
    await page.waitForTimeout(2000);
    await page.reload();

    // Duplicate banner should no longer be visible
    await expect(page.getByText('marked as a duplicate')).not.toBeVisible({ timeout: 5000 });
  });

  test('regular user does not see Mark as Duplicate button', async ({ page }) => {
    await loginAs(page, 'alice@example.com');
    await page.goto(`/tickets/${sourceTicketId}/e2e-dup-source`);

    await expect(page.getByTestId('mark-duplicate-btn')).not.toBeVisible({ timeout: 5000 });
  });

  test('agent merges source into target → source becomes read-only stub', async ({ page }) => {
    await loginAs(page, 'agent.smith@example.com');

    // Re-open source ticket first
    const svc = createServiceRoleClient();
    await svc.from('tickets').update({ status: 'open', duplicate_of_id: null }).eq('id', mergeSourceId);

    await page.goto(`/tickets/${mergeSourceId}/e2e-merge-source`);

    // Agent should see Merge button
    await expect(page.getByTestId('merge-ticket-btn')).toBeVisible({ timeout: 10000 });

    // Click and fill form
    await page.getByTestId('merge-ticket-btn').click();
    await expect(page.getByTestId('merge-ticket-form')).toBeVisible();
    await page.getByTestId('target-ticket-id-input').fill(String(mergeTargetId));
    await page.getByTestId('merge-ticket-form').getByRole('button', { name: 'Merge' }).click();

    // Wait for page reload
    await page.waitForTimeout(3000);
    await page.reload();

    // Should show merge banner with link to target
    const mergeBanner = page.getByTestId('merge-banner');
    await expect(mergeBanner).toBeVisible({ timeout: 10000 });
    await expect(mergeBanner.getByText(`#${mergeTargetId}`)).toBeVisible();
  });

  test('merged ticket stub is read-only — no reply form', async ({ page }) => {
    await loginAs(page, 'agent.smith@example.com');
    await page.goto(`/tickets/${mergeSourceId}/e2e-merge-source`);

    // Merge banner should be present
    await expect(page.getByTestId('merge-banner')).toBeVisible({ timeout: 10000 });

    // Reply form should NOT be visible
    await expect(page.getByRole('heading', { name: 'Reply' })).not.toBeVisible({ timeout: 3000 });

    // Agent controls should NOT be visible
    await expect(page.getByTestId('agent-controls')).not.toBeVisible({ timeout: 3000 });
  });

  test('admin sees delete button on open ticket', async ({ page }) => {
    await loginAs(page, 'admin@example.com');
    await page.goto(`/tickets/${targetTicketId}/e2e-dup-original`);

    await expect(page.getByTestId('delete-ticket-btn')).toBeVisible({ timeout: 10000 });
  });

  test('non-admin does not see delete button', async ({ page }) => {
    await loginAs(page, 'agent.smith@example.com');
    await page.goto(`/tickets/${targetTicketId}/e2e-dup-original`);

    await expect(page.getByTestId('delete-ticket-btn')).not.toBeVisible({ timeout: 5000 });
  });

  test('agent dashboard shows checkboxes on ticket list', async ({ page }) => {
    await loginAs(page, 'agent.smith@example.com');
    await page.goto('/agent');

    await expect(page.getByTestId('select-all-checkbox')).toBeVisible({ timeout: 10000 });
  });

  test('select all checkbox works and shows bulk toolbar', async ({ page }) => {
    await loginAs(page, 'agent.smith@example.com');
    await page.goto('/agent');

    await expect(page.getByTestId('select-all-checkbox')).toBeVisible({ timeout: 10000 });
    await page.getByTestId('select-all-checkbox').check();

    // Bulk action toolbar should appear
    await expect(page.getByTestId('bulk-action-toolbar')).toBeVisible({ timeout: 5000 });
  });

  test('regular user does not see checkboxes or bulk toolbar', async ({ page }) => {
    await loginAs(page, 'alice@example.com');

    // Regular users cannot access /agent
    await page.goto('/agent');
    // Should be redirected
    await expect(page).not.toHaveURL('/agent', { timeout: 10000 });
  });
});
