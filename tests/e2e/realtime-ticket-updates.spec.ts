import { test, expect } from './fixtures';
import { createServiceRoleClient } from '../helpers/supabase';
import { loginViaForm } from '../helpers/auth';

// A user and ticket owned by this spec, so no other spec's data is touched.
const SUFFIX = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
const EMAIL = `e2e-rt-${SUFFIX}@example.com`;
const TITLE = `E2E Realtime Ticket ${SUFFIX}`;

let userId = '';
let ticketId = 0;
let ticketUrl = '';

test.describe('Ticket page realtime updates', () => {
  test.beforeAll(async () => {
    const svc = createServiceRoleClient();
    const { data: created, error: uErr } = await svc.auth.admin.createUser({
      email: EMAIL,
      password: 'Password123',
      email_confirm: true,
      user_metadata: { display_name: 'Realtime E2E' },
    });
    if (uErr) throw new Error(`createUser: ${uErr.message}`);
    userId = created.user.id;
    const { data: type, error: tErr } = await svc.from('ticket_types').select('id').limit(1).single();
    if (tErr) throw new Error(tErr.message);
    const { data: ticket, error } = await svc
      .from('tickets')
      .insert({
        title: TITLE,
        slug: `e2e-realtime-ticket-${SUFFIX}`,
        creator_id: userId,
        type_id: type.id,
        urgency: 'low',
        is_private: true,
      })
      .select('id, slug')
      .single();
    if (error) throw new Error(error.message);
    ticketId = ticket.id as number;
    ticketUrl = `/tickets/${ticket.id}/${ticket.slug}`;
    const { error: pErr } = await svc.from('posts').insert({
      ticket_id: ticketId,
      author_id: userId,
      body: 'Realtime original post.',
      is_original: true,
      post_type: 'post',
    });
    if (pErr) throw new Error(pErr.message);
  });

  test.afterAll(async () => {
    const svc = createServiceRoleClient();
    const { error: tErr } = await svc.from('tickets').delete().eq('id', ticketId);
    if (tErr) throw new Error(tErr.message);
    const { error: pErr } = await svc.from('profiles').delete().eq('id', userId);
    if (pErr) throw new Error(pErr.message);
    const { error } = await svc.auth.admin.deleteUser(userId);
    if (error && error.status !== 404) throw new Error(error.message);
  });

  test('a new post appears on the open ticket page without a reload', async ({ page }) => {
    await loginViaForm(page, EMAIL, 'Password123');
    await page.goto(ticketUrl);
    await expect(page.getByTestId('realtime-status')).toHaveAttribute('data-status', 'SUBSCRIBED', {
      timeout: 15000,
    });

    const text = `Realtime reply ${SUFFIX}`;
    const { error } = await createServiceRoleClient().from('posts').insert({
      ticket_id: ticketId,
      author_id: userId,
      body: text,
      post_type: 'post',
    });
    if (error) throw new Error(error.message);

    await expect(page.getByText(text)).toBeVisible({ timeout: 15000 });
  });

  test('a ticket field change from elsewhere appears without a reload', async ({ page }) => {
    const svc = createServiceRoleClient();
    const { error: resetErr } = await svc.from('tickets').update({ urgency: 'low' }).eq('id', ticketId);
    if (resetErr) throw new Error(resetErr.message);

    await loginViaForm(page, EMAIL, 'Password123');
    await page.goto(ticketUrl);
    const urgency = page.getByTestId('ticket-sidebar-survey').locator('.sd-question[data-name="urgency"]');
    await expect(urgency).toContainText('Low', { timeout: 15000 });
    await expect(page.getByTestId('realtime-status')).toHaveAttribute('data-status', 'SUBSCRIBED', {
      timeout: 15000,
    });

    const { error } = await svc.from('tickets').update({ urgency: 'critical' }).eq('id', ticketId);
    if (error) throw new Error(error.message);

    await expect(urgency).toContainText('Critical', { timeout: 15000 });
  });
});
