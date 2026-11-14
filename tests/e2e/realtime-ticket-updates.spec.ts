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

// Bell and agent dashboard use the same browser Realtime path as the ticket page.
test.describe('Bell and dashboard realtime updates', () => {
  const rtEmail = `e2e-rt-bell-${SUFFIX}@example.com`;
  const dashTitle = `E2E Realtime Dashboard ${SUFFIX}`;
  let bellUserId = '';

  test.afterEach(async () => {
    const svc = createServiceRoleClient();
    if (bellUserId) {
      const { error: nErr } = await svc.from('notifications').delete().eq('recipient_id', bellUserId);
      if (nErr) throw new Error(nErr.message);
      const { error: pErr } = await svc.from('profiles').delete().eq('id', bellUserId);
      if (pErr) throw new Error(pErr.message);
      const { error } = await svc.auth.admin.deleteUser(bellUserId);
      if (error && error.status !== 404) throw new Error(error.message);
      bellUserId = '';
    }
    const { error: tErr } = await svc.from('tickets').delete().eq('title', dashTitle);
    if (tErr) throw new Error(tErr.message);
  });

  test('bell count updates without a reload', async ({ page }) => {
    const svc = createServiceRoleClient();
    const { data: created, error: uErr } = await svc.auth.admin.createUser({
      email: rtEmail,
      password: 'Password123',
      email_confirm: true,
    });
    if (uErr) throw new Error(`createUser: ${uErr.message}`);
    bellUserId = created.user.id;

    await loginViaForm(page, rtEmail, 'Password123');
    await page.goto('/tickets');
    await expect(page.getByTestId('notifications-realtime-status')).toHaveAttribute('data-status', 'SUBSCRIBED', {
      timeout: 15000,
    });
    await expect(page.getByLabel('Notifications', { exact: true })).toBeVisible();

    const { error } = await svc.from('notifications').insert({
      recipient_id: bellUserId,
      event_type: 'new_post',
      ticket_id: null,
      message: `Realtime bell ${SUFFIX}`,
    });
    if (error) throw new Error(error.message);

    await expect(page.getByLabel('Notifications, 1 unread')).toBeVisible({ timeout: 15000 });
  });

  test('agent dashboard shows a new ticket without a reload', async ({ page }) => {
    await loginViaForm(page, 'agent.smith@example.com', 'Password123');
    await page.goto('/agent');
    await expect(page.getByTestId('dashboard-realtime-status')).toHaveAttribute('data-status', 'SUBSCRIBED', {
      timeout: 15000,
    });

    const svc = createServiceRoleClient();
    const { data: alice, error: aErr } = await svc.from('profiles').select('id').eq('email', 'alice@example.com').single();
    if (aErr) throw new Error(aErr.message);
    const { data: type, error: tErr } = await svc.from('ticket_types').select('id').limit(1).single();
    if (tErr) throw new Error(tErr.message);
    const { error } = await svc.from('tickets').insert({
      title: dashTitle,
      slug: `e2e-realtime-dashboard-${SUFFIX}`,
      creator_id: alice.id,
      type_id: type.id,
    });
    if (error) throw new Error(error.message);

    await expect(page.getByTestId('agent-ticket-table').getByText(dashTitle)).toBeVisible({ timeout: 15000 });
  });
});
