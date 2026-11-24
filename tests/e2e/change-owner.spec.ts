import { test, expect } from './fixtures';
import { createServiceRoleClient } from '../helpers/supabase';
import { loginViaForm } from '../helpers/auth';

// #108: an agent can make another user the owner of a ticket.

const SLUG = 'e2e-change-ticket-owner';

test.describe('Change ticket owner', () => {
  test.describe.configure({ mode: 'serial' });
  let url: string;
  let ticketId: number;

  test.beforeAll(async () => {
    const admin = createServiceRoleClient();
    const { data: stale } = await admin.from('tickets').select('id').eq('slug', SLUG);
    if (stale?.length) {
      const ids = stale.map((t: { id: number }) => t.id);
      await admin.from('activity_log').delete().in('ticket_id', ids);
      await admin.from('posts').delete().in('ticket_id', ids);
      await admin.from('tickets').delete().in('id', ids);
    }
    const { data: alice } = await admin.from('profiles').select('id').eq('email', 'alice@example.com').single();
    const { data: type } = await admin.from('ticket_types').select('id').limit(1).single();
    const { data: ticket, error } = await admin
      .from('tickets')
      .insert({ title: 'E2E Change Ticket Owner', slug: SLUG, creator_id: alice!.id, type_id: type!.id, is_private: true })
      .select('id, slug')
      .single();
    if (error) throw new Error(error.message);
    const { error: pErr } = await admin.from('posts').insert({
      ticket_id: ticket!.id, author_id: alice!.id, body: 'Owner change test.', is_original: true, post_type: 'post',
    });
    if (pErr) throw new Error(pErr.message);
    ticketId = ticket!.id;
    url = `/tickets/${ticket!.id}/${ticket!.slug}`;
  });

  test('customers get no Change control', async ({ page }) => {
    await loginViaForm(page, 'alice@example.com');
    await page.goto(url);
    await expect(page.getByTestId('ticket-owner')).toBeVisible();
    await expect(page.getByTestId('change-owner-btn')).toHaveCount(0);
  });

  test('an agent moves the ticket to another user, who can then open it', async ({ page }) => {
    await loginViaForm(page, 'agent.smith@example.com');
    await page.goto(url);
    await page.getByTestId('change-owner-btn').click();
    await page.getByTestId('change-owner-input').fill('bob@example.com');
    const option = page.getByTestId('change-owner-option').filter({ hasText: 'bob@example.com' });
    await option.click();
    await expect(page.getByTestId('change-owner-panel')).toHaveCount(0);

    const admin = createServiceRoleClient();
    const { data: bob } = await admin.from('profiles').select('id, display_name').eq('email', 'bob@example.com').single();
    await expect.poll(async () => {
      const { data } = await admin.from('tickets').select('creator_id').eq('id', ticketId).single();
      return data?.creator_id;
    }).toBe(bob!.id);
    if (bob!.display_name) await expect(page.getByTestId('ticket-owner')).toContainText(bob!.display_name);

    await page.getByTestId('logs-tab').click();
    await expect(page.locator('[data-testid^="activity-"]').filter({ hasText: /changed\s*owner/ })).toHaveCount(1);

    // The private ticket is now Bob's.
    await loginViaForm(page, 'bob@example.com');
    const res = await page.goto(url);
    expect(res!.status()).toBe(200);
    await expect(page.getByTestId('ticket-owner')).toBeVisible();
  });
});
