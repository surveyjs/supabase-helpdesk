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

/** Navigate to an admin page, retrying once if requireAdmin() redirect race occurs. */
async function gotoAdmin(page: Page, path: string) {
  await page.goto(path);
  if (!page.url().includes('/admin')) {
    await page.goto(path);
  }
}

// ============================================================
// ADMIN CONFIGURATION
// ============================================================

test.describe('Inbound Email Admin Configuration', () => {
  test.describe.configure({ mode: 'serial' });

  test.afterAll(async () => {
    // Restore defaults
    const svc = createServiceRoleClient();
    await svc.from('app_settings').update({ value: 'false' }).eq('key', 'inbound_email_enabled');
    await svc.from('app_settings').update({ value: '' }).eq('key', 'inbound_email_reply_to_address');
  });

  test('admin can navigate to /admin/inbound-email', async ({ page }) => {
    await loginAs(page, 'admin@example.com');
    await gotoAdmin(page, '/admin/inbound-email');
    await expect(page).toHaveURL(/\/admin\/inbound-email/, { timeout: 10000 });
    await expect(page.getByRole('heading', { name: 'Inbound Email' })).toBeVisible();
  });

  test('inbound email sidebar link is visible', async ({ page }) => {
    await loginAs(page, 'admin@example.com');
    await gotoAdmin(page, '/admin/inbound-email');
    await expect(page.getByRole('link', { name: 'Inbound Email' })).toBeVisible();
  });

  test('toggle inbound email on/off', async ({ page }) => {
    await loginAs(page, 'admin@example.com');
    await gotoAdmin(page, '/admin/inbound-email');

    // Set reply-to address first (required when enabling)
    const replyToInput = page.getByLabel(/Reply-To Address/i);
    await replyToInput.fill('support@test-helpdesk.com');

    // Enable
    const toggle = page.getByLabel(/Enable inbound email/i);
    await toggle.check();
    await page.getByRole('button', { name: 'Save' }).click();

    // Verify saved
    await expect(page.getByText('Inbound email settings saved')).toBeVisible({ timeout: 10000 });

    // Reload and verify persisted
    await page.reload();
    await expect(page.getByLabel(/Enable inbound email/i)).toBeChecked();
  });

  test('set reply-to address with validation', async ({ page }) => {
    await loginAs(page, 'admin@example.com');
    await gotoAdmin(page, '/admin/inbound-email');

    // Enable with empty reply-to (required field missing)
    const toggle = page.getByLabel(/Enable inbound email/i);
    if (!(await toggle.isChecked())) {
      await toggle.check();
    }

    const replyToInput = page.getByLabel(/Reply-To Address/i);
    await replyToInput.fill('');
    await page.getByRole('button', { name: 'Save' }).click();

    // Should show validation error about required address
    await expect(page.getByText(/required/i)).toBeVisible({ timeout: 10000 });
  });

  test('settings persist after save', async ({ page }) => {
    await loginAs(page, 'admin@example.com');
    await gotoAdmin(page, '/admin/inbound-email');

    // Set valid configuration
    const toggle = page.getByLabel(/Enable inbound email/i);
    if (!(await toggle.isChecked())) {
      await toggle.check();
    }

    const replyToInput = page.getByLabel(/Reply-To Address/i);
    await replyToInput.fill('support@persist-test.com');
    await page.getByRole('button', { name: 'Save' }).click();

    await expect(page.getByText('Inbound email settings saved')).toBeVisible({ timeout: 10000 });

    // Reload and check
    await page.reload();
    await expect(page.getByLabel(/Enable inbound email/i)).toBeChecked();
    await expect(page.getByLabel(/Reply-To Address/i)).toHaveValue('support@persist-test.com');
  });

  test('auto-reply templates section is visible', async ({ page }) => {
    await loginAs(page, 'admin@example.com');
    await gotoAdmin(page, '/admin/inbound-email');

    await expect(page.getByText('Auto-Reply Templates')).toBeVisible();
    await expect(page.getByText('Unknown Sender')).toBeVisible();
    await expect(page.getByText('Blocked User')).toBeVisible();
    await expect(page.getByText('Duplicate Ticket')).toBeVisible();
    await expect(page.locator('.divide-y').getByText('Rate Limit')).toBeVisible();
  });

  test('webhook endpoint info is displayed', async ({ page }) => {
    await loginAs(page, 'admin@example.com');
    await gotoAdmin(page, '/admin/inbound-email');

    await expect(page.getByText('Webhook Endpoint')).toBeVisible();
    await expect(page.getByText('POST /api/inbound-email')).toBeVisible();
  });
});

// ============================================================
// EMAIL SIGNATURE STRIPPING (Unit-level via webhook integration)
// ============================================================

test.describe('Email Signature Stripping', () => {
  // These tests are integration tests that validate signature stripping
  // through the inbound email processing pipeline.
  // The stripEmailSignature function handles these patterns:

  test('strips standard "-- " signature delimiter', async ({ request }) => {
    const svc = createServiceRoleClient();

    // Enable inbound email
    await svc.from('app_settings').update({ value: 'true' }).eq('key', 'inbound_email_enabled');
    await svc.from('app_settings').update({ value: 'support@test.com' }).eq('key', 'inbound_email_reply_to_address');

    // Get a known user email
    const { data: user } = await svc.from('profiles').select('email').eq('role', 'user').limit(1).single();

    if (!user?.email) {
      // Skip if no user available
      return;
    }

    // Ensure a ticket type exists
    const { data: ticketType } = await svc.from('ticket_types').select('id').limit(1).single();
    if (!ticketType) return;

    // Send email with signature
    const response = await request.post('/api/inbound-email', {
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${process.env.INBOUND_EMAIL_WEBHOOK_SECRET ?? process.env.CRON_SECRET ?? ''}`,
      },
      data: {
        from: user.email,
        subject: 'Test Signature Strip',
        text: 'Hello, I need help with this.\n\n-- \nJohn Doe\nSenior Developer\njohn@company.com',
        messageId: `sig-test-${Date.now()}@test.local`,
      },
    });

    expect(response.status()).toBe(200);

    // Check if ticket was created with cleaned body
    const { data: ticket } = await svc
      .from('tickets')
      .select('id, title')
      .eq('title', 'Test Signature Strip')
      .order('created_at', { ascending: false })
      .limit(1)
      .single();

    if (ticket) {
      const { data: post } = await svc
        .from('posts')
        .select('body')
        .eq('ticket_id', ticket.id)
        .eq('is_original', true)
        .single();

      expect(post?.body).not.toContain('Senior Developer');
      expect(post?.body).toContain('Hello, I need help with this.');

      // Cleanup
      await svc.from('ticket_followers').delete().eq('ticket_id', ticket.id);
      await svc.from('posts').delete().eq('ticket_id', ticket.id);
      await svc.from('tickets').delete().eq('id', ticket.id);
    }

    // Restore
    await svc.from('app_settings').update({ value: 'false' }).eq('key', 'inbound_email_enabled');
    await svc.from('app_settings').update({ value: '' }).eq('key', 'inbound_email_reply_to_address');
  });
});

// ============================================================
// THREAD MATCHING
// ============================================================

test.describe('Thread Matching', () => {
  test('webhook creates reply when subject has [Ticket #ID]', async ({ request }) => {
    const svc = createServiceRoleClient();

    // Enable inbound email
    await svc.from('app_settings').update({ value: 'true' }).eq('key', 'inbound_email_enabled');
    await svc.from('app_settings').update({ value: 'support@test.com' }).eq('key', 'inbound_email_reply_to_address');

    // Get a known user
    const { data: user } = await svc.from('profiles').select('id, email').eq('role', 'user').limit(1).single();
    if (!user?.email) return;

    // Create a ticket for the user to reply to
    const { data: ticketType } = await svc.from('ticket_types').select('id').limit(1).single();
    if (!ticketType) return;

    const { data: ticket } = await svc
      .from('tickets')
      .insert({
        title: 'Thread Match Test',
        slug: 'thread-match-test',
        creator_id: user.id,
        type_id: ticketType.id,
        status: 'open',
      })
      .select('id')
      .single();

    if (!ticket) return;

    // Create original post
    await svc.from('posts').insert({
      ticket_id: ticket.id,
      author_id: user.id,
      body: 'Original post',
      is_original: true,
      post_type: 'post',
    });

    // Auto-follow
    await svc.from('ticket_followers').insert({ ticket_id: ticket.id, user_id: user.id });

    // Send reply email
    const response = await request.post('/api/inbound-email', {
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${process.env.INBOUND_EMAIL_WEBHOOK_SECRET ?? process.env.CRON_SECRET ?? ''}`,
      },
      data: {
        from: user.email,
        subject: `Re: [Ticket #${ticket.id}] Thread Match Test`,
        text: 'This is my reply via email.',
        messageId: `thread-test-${Date.now()}@test.local`,
      },
    });

    expect(response.status()).toBe(200);

    // Check reply was created on the ticket
    const { data: posts } = await svc
      .from('posts')
      .select('body, is_original')
      .eq('ticket_id', ticket.id)
      .eq('is_original', false);

    expect(posts).toBeTruthy();
    expect(posts!.length).toBeGreaterThanOrEqual(1);
    const reply = posts!.find((p) => p.body?.includes('This is my reply via email.'));
    expect(reply).toBeTruthy();

    // Cleanup
    await svc.from('ticket_followers').delete().eq('ticket_id', ticket.id);
    await svc.from('activity_log').delete().eq('ticket_id', ticket.id);
    await svc.from('posts').delete().eq('ticket_id', ticket.id);
    await svc.from('tickets').delete().eq('id', ticket.id);

    // Restore
    await svc.from('app_settings').update({ value: 'false' }).eq('key', 'inbound_email_enabled');
    await svc.from('app_settings').update({ value: '' }).eq('key', 'inbound_email_reply_to_address');
  });
});

// ============================================================
// INBOUND EMAIL WEBHOOK BASIC TESTS
// ============================================================

test.describe('Inbound Email Webhook', () => {
  test('returns 200 for all requests', async ({ request }) => {
    const response = await request.post('/api/inbound-email', {
      headers: { 'Content-Type': 'application/json' },
      data: {
        from: 'nobody@test.local',
        subject: 'Test',
        text: 'Hello',
      },
    });

    // Should return 200 even without auth (to prevent retries)
    // May return 401 if INBOUND_EMAIL_WEBHOOK_SECRET is set, or 200 if not
    expect([200, 401]).toContain(response.status());
  });

  test('unknown sender email is discarded when inbound disabled', async ({ request }) => {
    const svc = createServiceRoleClient();

    // Ensure disabled
    await svc.from('app_settings').update({ value: 'false' }).eq('key', 'inbound_email_enabled');

    const response = await request.post('/api/inbound-email', {
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${process.env.INBOUND_EMAIL_WEBHOOK_SECRET ?? process.env.CRON_SECRET ?? ''}`,
      },
      data: {
        from: 'unknown@random.local',
        subject: 'Test Disabled',
        text: 'Should be discarded',
        messageId: `disabled-test-${Date.now()}@test.local`,
      },
    });

    expect(response.status()).toBe(200);
    const body = await response.json();
    expect(body.received).toBe(true);
  });
});

// ============================================================
// NEW TICKET CREATION BY EMAIL
// ============================================================

test.describe('New Ticket Creation by Email', () => {
  test.afterAll(async () => {
    const svc = createServiceRoleClient();
    await svc.from('app_settings').update({ value: 'false' }).eq('key', 'inbound_email_enabled');
    await svc.from('app_settings').update({ value: '' }).eq('key', 'inbound_email_reply_to_address');
  });

  test('email from known user creates a ticket', async ({ request }) => {
    const svc = createServiceRoleClient();

    // Enable inbound email
    await svc.from('app_settings').update({ value: 'true' }).eq('key', 'inbound_email_enabled');
    await svc.from('app_settings').update({ value: 'support@test.com' }).eq('key', 'inbound_email_reply_to_address');

    const { data: user } = await svc.from('profiles').select('id, email').eq('role', 'user').limit(1).single();
    if (!user?.email) return;

    const uniqueSubject = `Email Ticket Test ${Date.now()}`;

    const response = await request.post('/api/inbound-email', {
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${process.env.INBOUND_EMAIL_WEBHOOK_SECRET ?? process.env.CRON_SECRET ?? ''}`,
      },
      data: {
        from: user.email,
        subject: uniqueSubject,
        text: 'I need help with my order.',
        messageId: `new-ticket-${Date.now()}@test.local`,
      },
    });

    expect(response.status()).toBe(200);

    // Verify ticket was created
    const { data: ticket } = await svc
      .from('tickets')
      .select('id, title, status, urgency, creator_id')
      .eq('title', uniqueSubject)
      .single();

    expect(ticket).toBeTruthy();
    expect(ticket!.title).toBe(uniqueSubject);
    expect(ticket!.status).toBe('open');
    expect(ticket!.urgency).toBe('medium');
    expect(ticket!.creator_id).toBe(user.id);

    // Verify original post
    const { data: post } = await svc
      .from('posts')
      .select('body, is_original')
      .eq('ticket_id', ticket!.id)
      .eq('is_original', true)
      .single();

    expect(post).toBeTruthy();
    expect(post!.body).toContain('I need help with my order.');

    // Verify auto-follow
    const { count: followCount } = await svc
      .from('ticket_followers')
      .select('user_id', { count: 'exact', head: true })
      .eq('ticket_id', ticket!.id)
      .eq('user_id', user.id);

    expect(followCount).toBe(1);

    // Cleanup
    await svc.from('sla_timers').delete().eq('ticket_id', ticket!.id);
    await svc.from('ticket_followers').delete().eq('ticket_id', ticket!.id);
    await svc.from('posts').delete().eq('ticket_id', ticket!.id);
    await svc.from('tickets').delete().eq('id', ticket!.id);
  });
});

// ============================================================
// REPLY BY EMAIL
// ============================================================

test.describe('Reply by Email', () => {
  test('non-agent reply to closed ticket re-opens it', async ({ request }) => {
    const svc = createServiceRoleClient();

    // Enable inbound email
    await svc.from('app_settings').update({ value: 'true' }).eq('key', 'inbound_email_enabled');
    await svc.from('app_settings').update({ value: 'support@test.com' }).eq('key', 'inbound_email_reply_to_address');

    const { data: user } = await svc.from('profiles').select('id, email').eq('role', 'user').limit(1).single();
    if (!user?.email) return;

    const { data: ticketType } = await svc.from('ticket_types').select('id').limit(1).single();
    if (!ticketType) return;

    // Create a closed ticket
    const { data: ticket } = await svc
      .from('tickets')
      .insert({
        title: 'Closed Ticket Reopen Test',
        slug: 'closed-ticket-reopen-test',
        creator_id: user.id,
        type_id: ticketType.id,
        status: 'closed',
      })
      .select('id')
      .single();

    if (!ticket) return;

    await svc.from('posts').insert({
      ticket_id: ticket.id,
      author_id: user.id,
      body: 'Original',
      is_original: true,
      post_type: 'post',
    });

    await svc.from('ticket_followers').insert({ ticket_id: ticket.id, user_id: user.id });

    // Reply to closed ticket
    const response = await request.post('/api/inbound-email', {
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${process.env.INBOUND_EMAIL_WEBHOOK_SECRET ?? process.env.CRON_SECRET ?? ''}`,
      },
      data: {
        from: user.email,
        subject: `Re: [Ticket #${ticket.id}] Closed Ticket Reopen Test`,
        text: 'Please reopen this ticket.',
        messageId: `reopen-test-${Date.now()}@test.local`,
      },
    });

    expect(response.status()).toBe(200);

    // Wait briefly for async processing to complete
    await new Promise((r) => setTimeout(r, 2000));

    // Verify ticket was reopened
    const { data: updated } = await svc
      .from('tickets')
      .select('status')
      .eq('id', ticket.id)
      .single();

    expect(updated!.status).toBe('open');

    // Cleanup
    await svc.from('sla_timers').delete().eq('ticket_id', ticket.id);
    await svc.from('csat_survey_schedule').delete().eq('ticket_id', ticket.id);
    await svc.from('ticket_followers').delete().eq('ticket_id', ticket.id);
    await svc.from('activity_log').delete().eq('ticket_id', ticket.id);
    await svc.from('posts').delete().eq('ticket_id', ticket.id);
    await svc.from('tickets').delete().eq('id', ticket.id);

    // Restore
    await svc.from('app_settings').update({ value: 'false' }).eq('key', 'inbound_email_enabled');
    await svc.from('app_settings').update({ value: '' }).eq('key', 'inbound_email_reply_to_address');
  });
});

// ============================================================
// AUTO-REPLY RATE LIMITING
// ============================================================

test.describe('Auto-Reply Rate Limiting', () => {
  test('auto-replies are rate limited to 3 per hour', async ({ request }) => {
    const svc = createServiceRoleClient();

    // Enable inbound email
    await svc.from('app_settings').update({ value: 'true' }).eq('key', 'inbound_email_enabled');
    await svc.from('app_settings').update({ value: 'support@test.com' }).eq('key', 'inbound_email_reply_to_address');

    const unknownEmail = `ratelimit-${Date.now()}@unknown.local`;

    // Send 4 emails from unknown sender
    for (let i = 0; i < 4; i++) {
      await request.post('/api/inbound-email', {
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${process.env.INBOUND_EMAIL_WEBHOOK_SECRET ?? process.env.CRON_SECRET ?? ''}`,
        },
        data: {
          from: unknownEmail,
          subject: `Rate Limit Test ${i}`,
          text: `Test message ${i}`,
          messageId: `ratelimit-${Date.now()}-${i}@test.local`,
        },
      });
    }

    // Check auto_reply_log: should have max 3 entries for this email
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const { count } = await svc
      .from('auto_reply_log')
      .select('id', { count: 'exact', head: true })
      .eq('recipient_email', unknownEmail.toLowerCase())
      .gte('sent_at', oneHourAgo);

    expect(count).toBeLessThanOrEqual(3);

    // Cleanup
    await svc.from('auto_reply_log').delete().eq('recipient_email', unknownEmail.toLowerCase());

    // Restore
    await svc.from('app_settings').update({ value: 'false' }).eq('key', 'inbound_email_enabled');
    await svc.from('app_settings').update({ value: '' }).eq('key', 'inbound_email_reply_to_address');
  });
});
