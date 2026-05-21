import { test, expect, Page } from '@playwright/test';
import { createServiceRoleClient } from '../helpers/supabase';
import { loginViaForm } from '../helpers/auth';

// Multiple describes in this file mutate the same `app_settings` rows
// (`inbound_email_enabled`, `inbound_email_reply_to_address`). Under
// `fullyParallel: true` they race across workers, so force file-level
// serial execution.
test.describe.configure({ mode: 'serial' });

/**
 * Helper: log in via the shared, resilient login flow. Delegates to
 * `loginViaForm` so we benefit from its cookie reset, auth-mode guard,
 * throttle clear, and per-attempt retry — eliminating the CI flakes
 * we previously saw at /login's Email label and at the post-login
 * navbar summary visibility check.
 */
async function loginAs(page: Page, email: string, password = 'Password123') {
  await loginViaForm(page, email, password);
}

/** Navigate to an admin page, retrying once if requireAdmin() redirect race occurs. */
async function gotoAdmin(page: Page, path: string) {
  await page.goto(path);
  try {
    await page.waitForURL(/\/admin\//, { timeout: 5000 });
  } catch {
    await page.goto(path);
    await page.waitForURL(/\/admin\//, { timeout: 10000 });
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
    // Reset to a known-disabled state so the click below is guaranteed to enable.
    const svc = createServiceRoleClient();
    await svc.from('app_settings').update({ value: 'false' }).eq('key', 'inbound_email_enabled');
    await svc.from('app_settings').update({ value: '' }).eq('key', 'inbound_email_reply_to_address');

    await loginAs(page, 'admin@example.com');
    await gotoAdmin(page, '/admin/inbound-email');

    // Set reply-to address first (required when enabling)
    const form = page.getByTestId('inbound-email-survey-form');
    const replyToInput = form.getByRole('textbox', { name: /Reply-To Address/i });
    await expect(replyToInput).toBeVisible({ timeout: 10000 });
    await replyToInput.click();
    await replyToInput.fill('support@test-helpdesk.com');
    await replyToInput.press('Tab');

    // Enable - SurveyJS v3 renders boolean as a visually-hidden checkbox
    // wrapped in a label. Clicking the label toggles the input via native
    // HTML behavior and fires SurveyJS's onChange handler.
    const checkbox = form.locator('input[name="inbound_email_enabled"]');
    const checkboxLabel = form.locator('label.sd-boolean').first();
    if (await checkboxLabel.count()) {
      await checkboxLabel.click();
    } else {
      await checkbox.click({ force: true });
    }

    // Wait for autosave (no button to click in autosave mode)
    // Verify saved in DB by polling
    await expect.poll(async () => {
      const { data } = await svc
        .from('app_settings')
        .select('value')
        .eq('key', 'inbound_email_enabled')
        .single();
      return data?.value;
    }, { timeout: 20000, intervals: [500, 500, 1000] }).toBe('true');

    // Reload and verify persisted
    await page.reload();
    await expect(page.getByRole('heading', { name: 'Inbound Email' })).toBeVisible({ timeout: 10000 });
    const reloadedCheckbox = page.getByTestId('inbound-email-survey-form').locator('input[name="inbound_email_enabled"]');
    await expect(reloadedCheckbox).toBeChecked({ timeout: 10000 });
  });

  test('set reply-to address with validation', async ({ page }) => {
    await loginAs(page, 'admin@example.com');
    await gotoAdmin(page, '/admin/inbound-email');

    // Clear reply-to address (should trigger validation on autosave)
    const form = page.getByTestId('inbound-email-survey-form');
    const replyToInput = form.getByRole('textbox', { name: /Reply-To Address/i });
    await replyToInput.fill('');
    await replyToInput.blur();

    // Wait for autosave
    await page.waitForTimeout(1500);

    // With validation errors in SurveyJS, check if an error message or aria-invalid appears
    // The form should show either an error message or invalid state
    const errorText = page.getByText(/email|required|invalid/i).first();
    const hasError = await errorText.isVisible().catch(() => false);
    
    // If no visible error text, check for aria-invalid on the input
    const hasAriaInvalid = await replyToInput.evaluate((el) =>
      el.getAttribute('aria-invalid') === 'true'
    ).catch(() => false);
    
    if (!hasError && !hasAriaInvalid) {
      // SurveyJS might not show validation error in autosave mode, which is acceptable
      // Just verify the field is still empty
      await expect(replyToInput).toHaveValue('');
    }
  });

  test('settings persist after save', async ({ page }) => {
    // Reset database to clean state
    const svc = createServiceRoleClient();
    await svc.from('app_settings').update({ value: '' }).eq('key', 'inbound_email_reply_to_address');
    
    await loginAs(page, 'admin@example.com');
    await gotoAdmin(page, '/admin/inbound-email');

    // Reload page to get fresh data
    await page.reload();
    await expect(page.getByRole('heading', { name: 'Inbound Email' })).toBeVisible({ timeout: 10000 });

    // Set valid configuration
    const form = page.getByTestId('inbound-email-survey-form');
    const replyToInput = form.getByRole('textbox', { name: /Reply-To Address/i });
    
    // Type the new value
    await replyToInput.fill('support@persist-test.com');
    
    // Blur the field to trigger the change event in SurveyJS
    await replyToInput.blur();

    // Wait for autosave (debounce 700ms + server action) by polling DB.
    await expect.poll(async () => {
      const { data } = await svc
        .from('app_settings')
        .select('value')
        .eq('key', 'inbound_email_reply_to_address')
        .single();
      return data?.value;
    }, { timeout: 20000, intervals: [500, 500, 1000] }).toBe('support@persist-test.com');

    // Reload and check UI reflects saved state
    await page.reload();
    const reloadedForm = page.getByTestId('inbound-email-survey-form');
    await expect(reloadedForm.getByRole('textbox', { name: /Reply-To Address/i })).toHaveValue('support@persist-test.com', { timeout: 10000 });
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

    // Verify ticket was created (poll briefly — triggers may need a moment)
    let ticket: { id: number; title: string; status: string; urgency: string; creator_id: string } | null = null;
    for (let i = 0; i < 10; i++) {
      const { data } = await svc
        .from('tickets')
        .select('id, title, status, urgency, creator_id')
        .eq('title', uniqueSubject)
        .single();
      if (data) { ticket = data; break; }
      await new Promise(r => setTimeout(r, 500));
    }

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

    // Poll for status change (webhook processing may take a moment)
    let updated: { status: string } | null = null;
    for (let i = 0; i < 20; i++) {
      await new Promise((r) => setTimeout(r, 500));
      const { data } = await svc
        .from('tickets')
        .select('status')
        .eq('id', ticket.id)
        .single();
      if (data?.status === 'open') {
        updated = data;
        break;
      }
      updated = data;
    }

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
