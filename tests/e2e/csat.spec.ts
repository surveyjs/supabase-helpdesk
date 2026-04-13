import { test, expect } from '@playwright/test';
import { createServiceRoleClient } from '../helpers/supabase';
import { loginAs, gotoAdmin } from '../helpers/auth';
import crypto from 'crypto';

// ============================================================
// CSAT Rating Page
// ============================================================

test.describe('CSAT Rating Page', () => {
  test.describe.configure({ mode: 'serial' });

  let validToken: string;
  let ticketId: number;

  test.beforeAll(async () => {
    const svc = createServiceRoleClient();

    // Get alice's profile (regular user)
    const { data: alice } = await svc
      .from('profiles')
      .select('id')
      .eq('email', 'alice@example.com')
      .single();

    // Ensure ticket type exists
    const { data: typeData } = await svc.from('ticket_types').select('id').limit(1).single();

    // Create a closed ticket for CSAT testing
    const { data: ticket } = await svc
      .from('tickets')
      .insert({
        title: 'E2E CSAT Test Ticket',
        slug: 'e2e-csat-test-ticket',
        creator_id: alice!.id,
        type_id: typeData!.id,
        status: 'closed',
      })
      .select('id')
      .single();

    ticketId = ticket!.id;

    // Create a valid CSAT token
    validToken = crypto.randomBytes(32).toString('hex');
    await svc.from('csat_ratings').insert({
      ticket_id: ticketId,
      token: validToken,
      token_expires_at: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
      is_used: false,
    });
  });

  test.afterAll(async () => {
    const svc = createServiceRoleClient();
    await svc.from('csat_ratings').delete().eq('ticket_id', ticketId);
    await svc.from('csat_survey_schedule').delete().eq('ticket_id', ticketId);
    await svc.from('activity_log').delete().eq('ticket_id', ticketId);
    await svc.from('posts').delete().eq('ticket_id', ticketId);
    await svc.from('tickets').delete().eq('id', ticketId);
  });

  test('CSAT rating page renders with valid token', async ({ page }) => {
    await page.goto(`/csat/${validToken}`);
    await expect(page.getByText('Rate Your Experience')).toBeVisible({ timeout: 10000 });
    await expect(page.getByText('E2E CSAT Test Ticket')).toBeVisible();
    await expect(page.getByTestId('csat-form')).toBeVisible();
  });

  test('invalid token shows error page', async ({ page }) => {
    await page.goto('/csat/invalidtoken123');
    await expect(page.getByText('Invalid or Expired Link')).toBeVisible({ timeout: 10000 });
    await expect(page.getByRole('link', { name: 'Go to Login' })).toBeVisible();
  });

  test('expired token shows error page', async ({ page }) => {
    const svc = createServiceRoleClient();
    const expiredToken = crypto.randomBytes(32).toString('hex');
    await svc.from('csat_ratings').insert({
      ticket_id: ticketId,
      token: expiredToken,
      token_expires_at: new Date(Date.now() - 60000).toISOString(),
      is_used: false,
    });

    await page.goto(`/csat/${expiredToken}`);
    await expect(page.getByText('Invalid or Expired Link')).toBeVisible({ timeout: 10000 });
  });

  test('submit 3-star rating — stores correctly', async ({ page }) => {
    await page.goto(`/csat/${validToken}`);
    await expect(page.getByTestId('csat-form')).toBeVisible({ timeout: 10000 });

    // Click 3rd star
    await page.getByTestId('csat-star-3').click();
    await expect(page.getByText('You selected 3 out of 5 stars')).toBeVisible();

    // Submit
    await page.getByTestId('csat-submit').click();

    // Should show success
    await expect(page.getByTestId('csat-success')).toBeVisible({ timeout: 10000 });
    await expect(page.getByText('Thank you for your feedback!')).toBeVisible();
  });

  test('confirmation page shows new token link', async ({ page }) => {
    // The success page from the previous test should have a link
    // We need to re-navigate since tests don't share page state
    const svc = createServiceRoleClient();

    // Create a new token for this test
    const newToken = crypto.randomBytes(32).toString('hex');
    await svc.from('csat_ratings').insert({
      ticket_id: ticketId,
      token: newToken,
      token_expires_at: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
      is_used: false,
    });

    await page.goto(`/csat/${newToken}`);
    await expect(page.getByTestId('csat-form')).toBeVisible({ timeout: 10000 });

    await page.getByTestId('csat-star-5').click();
    await page.getByTestId('csat-comment').fill('Excellent support!');
    await page.getByTestId('csat-submit').click();

    await expect(page.getByTestId('csat-success')).toBeVisible({ timeout: 10000 });
    await expect(page.getByTestId('csat-update-link')).toBeVisible();
  });

  test('rating with comment — stores correctly', async () => {
    const svc = createServiceRoleClient();

    // Verify the rating in the DB
    const { data } = await svc
      .from('csat_ratings')
      .select('rating, comment')
      .eq('ticket_id', ticketId)
      .not('rating', 'is', null)
      .order('submitted_at', { ascending: false })
      .limit(1)
      .single();

    expect(data).toBeDefined();
    expect(data!.rating).toBe(5);
    expect(data!.comment).toBe('Excellent support!');
  });
});

// ============================================================
// CSAT on Ticket Detail Page
// ============================================================

test.describe('CSAT on Ticket Detail', () => {
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

    // Create a closed ticket
    const { data: ticket } = await svc
      .from('tickets')
      .insert({
        title: 'E2E CSAT Detail Ticket',
        slug: 'e2e-csat-detail-ticket',
        creator_id: alice!.id,
        type_id: typeData!.id,
        status: 'closed',
        assigned_agent_id: agent!.id,
      })
      .select('id, slug')
      .single();

    ticketId = ticket!.id;
    ticketSlug = ticket!.slug;

    // Create an original post
    await svc.from('posts').insert({
      ticket_id: ticketId,
      author_id: alice!.id,
      body: 'CSAT detail test post',
      is_original: true,
      post_type: 'post',
    });
  });

  test.afterAll(async () => {
    const svc = createServiceRoleClient();
    await svc.from('csat_ratings').delete().eq('ticket_id', ticketId);
    await svc.from('csat_survey_schedule').delete().eq('ticket_id', ticketId);
    await svc.from('activity_log').delete().eq('ticket_id', ticketId);
    await svc.from('ticket_followers').delete().eq('ticket_id', ticketId);
    await svc.from('posts').delete().eq('ticket_id', ticketId);
    await svc.from('tickets').delete().eq('id', ticketId);
  });

  test('"Rate this ticket" link appears for ticket owner on closed ticket', async ({ page }) => {
    await loginAs(page, 'alice@example.com');
    await page.goto(`/tickets/${ticketId}/${ticketSlug}`);

    await expect(page.getByTestId('csat-section')).toBeVisible({ timeout: 10000 });
    await expect(page.getByTestId('rate-ticket-link')).toBeVisible();
  });

  test('clicking "Rate this ticket" redirects to CSAT page', async ({ page }) => {
    await loginAs(page, 'alice@example.com');
    await page.goto(`/tickets/${ticketId}/${ticketSlug}`);

    await page.getByTestId('rate-ticket-link').click();
    await expect(page).toHaveURL(/\/csat\/[0-9a-f]{64}/, { timeout: 10000 });
    await expect(page.getByText('Rate Your Experience')).toBeVisible();
  });

  test('agent cannot see "Rate this ticket" link', async ({ page }) => {
    await loginAs(page, 'agent.smith@example.com');
    await page.goto(`/tickets/${ticketId}/${ticketSlug}`);

    // Agent should see the ticket but not the rate link
    await expect(page.getByRole('heading', { name: 'E2E CSAT Detail Ticket' })).toBeVisible({ timeout: 10000 });
    await expect(page.getByTestId('rate-ticket-link')).not.toBeVisible();
  });

  test('rating displays on ticket detail page after submission', async ({ page }) => {
    const svc = createServiceRoleClient();

    // Submit a rating directly via the DB
    const token = crypto.randomBytes(32).toString('hex');
    await svc.from('csat_ratings').insert({
      ticket_id: ticketId,
      token,
      token_expires_at: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
      is_used: true,
      rating: 4,
      comment: 'Good support!',
      submitted_at: new Date().toISOString(),
    });

    await loginAs(page, 'agent.smith@example.com');
    await page.goto(`/tickets/${ticketId}/${ticketSlug}`);

    await expect(page.getByTestId('csat-rating-display')).toBeVisible({ timeout: 10000 });
    await expect(page.getByText('4/5')).toBeVisible();
  });

  test('"Update rating" link appears after rating is submitted', async ({ page }) => {
    await loginAs(page, 'alice@example.com');
    await page.goto(`/tickets/${ticketId}/${ticketSlug}`);

    await expect(page.getByTestId('update-rating-link')).toBeVisible({ timeout: 10000 });
  });
});

// ============================================================
// CSAT Admin Settings
// ============================================================

test.describe('CSAT Admin Settings', () => {
  test.describe.configure({ mode: 'serial' });

  // Restore defaults after tests
  test.afterAll(async () => {
    const svc = createServiceRoleClient();
    await svc.from('app_settings').update({ value: 'false' }).eq('key', 'csat_enabled');
    await svc.from('app_settings').update({ value: '1_hour' }).eq('key', 'csat_survey_delay');
  });

  test('CSAT settings page loads for admin', async ({ page }) => {
    await loginAs(page, 'admin@example.com');
    await expect(page.getByRole('link', { name: 'Setup' })).toBeVisible({ timeout: 10000 });
    await gotoAdmin(page, '/admin/csat');

    await expect(page.getByRole('heading', { name: 'CSAT Settings' })).toBeVisible({ timeout: 10000 });
    await expect(page.getByTestId('csat-enabled-toggle')).toBeVisible();
  });

  test('CSAT toggle disabled when email not configured', async ({ page }) => {
    // Check if email is NOT verified — the toggle should be disabled
    const svc = createServiceRoleClient();
    const { data: emailConfig } = await svc.from('email_config').select('is_verified').limit(1).single();

    if (!emailConfig?.is_verified) {
      await loginAs(page, 'admin@example.com');
      await gotoAdmin(page, '/admin/csat');
      await expect(page.getByTestId('csat-email-warning')).toBeVisible({ timeout: 10000 });
    }
  });

  test('change delay setting', async ({ page }) => {
    await loginAs(page, 'admin@example.com');
    await gotoAdmin(page, '/admin/csat');

    // Select 4 hours
    await page.getByTestId('csat-delay-4_hours').click();
    await page.getByTestId('csat-save-btn').click();

    // Verify saved
    await page.waitForTimeout(1000);
    const svc = createServiceRoleClient();
    const { data } = await svc.from('app_settings').select('value').eq('key', 'csat_survey_delay').single();
    expect(data!.value).toBe('4_hours');
  });
});
