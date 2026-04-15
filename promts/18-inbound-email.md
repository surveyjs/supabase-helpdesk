# Phase 18 — Inbound Email

## Context

You are building inbound email processing — creating tickets and replies by email — for a **HelpDesk** application. Read `docs/requirements.md` sections 15.1–15.6, 16.8, 16.9, and `docs/architecture.md` constraints 1, 2, 3, 9, 11.

Phases 0–17 are complete: project init, database schema, authentication, tickets, agent dashboard, taxonomy, posts/comments/notes, admin setup, file attachments, email notifications, real-time/in-app notifications, CSAT ratings, SLA policies, knowledge base, reporting, user profile/account management, canned responses/follow/custom fields, and advanced ticket operations.

This phase adds inbound email processing: creating tickets from email, replying to tickets by email, handling unknown senders, email signature stripping, auto-reply rate limiting, and the admin configuration section for inbound email.

### Existing Infrastructure

- **Email sending** via `src/lib/email/send.ts`: `sendEmail(to, subject, body)` and `sendTestEmailRaw()`.
- **Email templates** via `src/lib/email/templates.ts`: `renderTemplate(eventType, placeholders)`.
- **Notification templates table** (`notification_templates`) with event types for various notification events.
- **App settings table** (`app_settings`) with key-value pairs for system configuration.
- **Admin setup page** at `/admin` with 19 sidebar sections. This phase adds the "Inbound Email" section.
- **SMTP configuration** already set up in admin at `/admin/email` (Phase 9).
- **File attachments** via `src/lib/actions/attachments.ts`: `uploadAttachments()` with file type/size/count validation.
- **SVG sanitization** via `src/lib/utils/svg-sanitize.ts`: `sanitizeSvg()`.
- **Ticket creation** via `src/lib/actions/tickets.ts`: `createTicket(formData)` with rate limiting, default values, custom fields.
- **Ticket reply** via `src/lib/actions/tickets.ts`: `replyToTicket(formData)` with status auto-transition.
- **Profile lookup by email** is possible via `profiles` table.
- **Blocked user check**: `profiles.is_blocked` column.
- **Ticket creation rate limit** stored in `app_settings` key `ticket_creation_rate_limit`.
- **Custom fields** with `default_value` for email-created tickets (see 16.14).
- **Architecture constraint 11**: `pg_cron` jobs — Phase 18 adds a daily cleanup job for `auto_reply_log` rows older than 24 hours.

## Tasks

### 1. Migration: `supabase/migrations/016_inbound_email.sql`

```sql
-- ============================================================
-- Phase 18 — Inbound Email
-- ============================================================

-- Auto-reply rate limiting log
CREATE TABLE auto_reply_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  recipient_email TEXT NOT NULL,
  reply_type TEXT NOT NULL CHECK (reply_type IN (
    'unknown_sender', 'blocked_user', 'duplicate_ticket', 'rate_limit'
  )),
  sent_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_auto_reply_log_recipient_sent
  ON auto_reply_log (recipient_email, sent_at DESC);

-- RLS: only service_role can read/write (system-generated)
ALTER TABLE auto_reply_log ENABLE ROW LEVEL SECURITY;

-- Inbound email configuration settings
INSERT INTO app_settings (key, value) VALUES
  ('inbound_email_enabled', 'false'),
  ('inbound_email_reply_to_address', '')
ON CONFLICT (key) DO NOTHING;

-- Auto-reply notification templates
INSERT INTO notification_templates (event_type, subject, body) VALUES
  ('auto_reply_unknown_sender',
   'Unable to process your email',
   'Your email could not be processed because your address is not registered in our system. Please register at {{registrationUrl}} to create support tickets.')
ON CONFLICT (event_type) DO NOTHING;

INSERT INTO notification_templates (event_type, subject, body) VALUES
  ('auto_reply_blocked_user',
   'Unable to process your email',
   'Your email could not be processed because your account is currently restricted. Please contact support for assistance.')
ON CONFLICT (event_type) DO NOTHING;

INSERT INTO notification_templates (event_type, subject, body) VALUES
  ('auto_reply_duplicate_ticket',
   'Unable to process your reply',
   'Your reply could not be processed because this ticket has been closed as a duplicate. Please continue the conversation at the original ticket: [#{{originalTicketId}}](/tickets/{{originalTicketId}}).')
ON CONFLICT (event_type) DO NOTHING;

INSERT INTO notification_templates (event_type, subject, body) VALUES
  ('auto_reply_rate_limit',
   'Ticket creation limit reached',
   'Your email could not be processed because you have reached the maximum number of tickets that can be created in a 24-hour period. Please try again later or use the web interface.')
ON CONFLICT (event_type) DO NOTHING;

-- pg_cron: daily cleanup of auto_reply_log rows older than 24 hours
-- (Integrates with the existing daily cron pattern from architecture constraint 11)
SELECT cron.schedule(
  'cleanup-auto-reply-log',
  '0 3 * * *',  -- daily at 3 AM
  $$DELETE FROM auto_reply_log WHERE sent_at < now() - interval '24 hours'$$
);
```

### 2. Server Actions: Inbound Email Processing

**`src/lib/actions/inbound-email.ts`** (new file):

#### Helper: Auto-Reply Rate Limiting

```typescript
async function canSendAutoReply(
  recipientEmail: string,
): Promise<boolean> {
  // Query auto_reply_log for rows with matching recipient_email
  // where sent_at > now() - interval '1 hour'
  // Return true if count < 3, false otherwise
}

async function logAutoReply(
  recipientEmail: string,
  replyType: 'unknown_sender' | 'blocked_user' | 'duplicate_ticket' | 'rate_limit',
): Promise<void> {
  // Insert a row into auto_reply_log
}
```

#### Helper: Email Signature Stripping

```typescript
function stripEmailSignature(body: string): string {
  // Strip common signature delimiters:
  //   "-- " (standard sig separator), "___" (3+ underscores),
  //   "Sent from my iPhone", "Sent from my iPad",
  //   "Sent from my Android", "Get Outlook for"
  // Strip quoted reply blocks: lines starting with ">"
  // Strip forwarded message headers: "---------- Forwarded message ----------"
  // Keep only the new content above the first matched delimiter
  // If stripping results in empty/whitespace-only content, return the original body as fallback
}
```

#### Helper: Thread Matching

```typescript
function extractTicketIdFromSubject(subject: string): number | null {
  // Match pattern [Ticket #123] in the email subject
  // Return the ticket ID or null if no match
}
```

#### Main Processing Action

- `processInboundEmail(payload: InboundEmailPayload)`:
  - This is a Server Action invoked by an API route (webhook endpoint)
  - Extract: sender email, subject, body (plain text), attachments (array of `{ filename, content, contentType, size }`)
  - **Check inbound email enabled**: query `app_settings` for `inbound_email_enabled`. If `'false'`, discard silently.

  **Step 1: Identify sender**
  - Look up `profiles` by email (case-insensitive)
  - If no match → **unknown sender**:
    - Check auto-reply rate limit for sender email
    - If under limit: send auto-reply using `auto_reply_unknown_sender` template with `{{registrationUrl}}` placeholder (configured app URL + `/auth/signup`), log auto-reply
    - Discard email, return

  **Step 2: Check blocked status**
  - If sender profile has `is_blocked = true`:
    - Check auto-reply rate limit
    - If under limit: send auto-reply using `auto_reply_blocked_user` template, log auto-reply
    - Discard email, return

  **Step 3: Strip email signature**
  - Call `stripEmailSignature(body)`
  - If result is empty/whitespace-only after stripping AND the original body was also empty/whitespace-only → discard email (no ticket/post created)

  **Step 4: Determine if reply or new ticket**
  - Call `extractTicketIdFromSubject(subject)`
  - If ticket ID found → **process as reply** (go to Step 5)
  - If no ticket ID → **process as new ticket** (go to Step 6)

  **Step 5: Process as reply (§15.3)**
  - Fetch the ticket by ID
  - If ticket doesn't exist → discard
  - Check if sender has permission to view the ticket (creator, agent, or teammate if private) → if not, discard
  - If ticket has `duplicate_of_id IS NOT NULL` and sender is not an agent:
    - Check auto-reply rate limit
    - If under limit: send auto-reply using `auto_reply_duplicate_ticket` template with `{{originalTicketId}}` = `duplicate_of_id`, log auto-reply
    - Discard
  - Create a new post on the ticket:
    - `ticket_id` = ticket ID, `author_id` = sender's profile ID, `post_type = 'post'`, body = stripped email content
  - Handle attachments (same as Step 6 attachment handling)
  - Auto-transition status:
    - If sender is NOT an agent and ticket status is `'closed'` or `'pending'` → update status to `'open'` (same as §3.5/§9.2)
    - Agent email replies do NOT auto-transition status (§9.2)
  - Trigger `notifyTicketRecipients` for event `'new_post'` (same as web reply)
  - SLA side effects: if this is the first agent post → call `stopFirstResponseTimer(ticketId)`

  **Step 6: Process as new ticket (§15.2)**
  - Check ticket creation rate limit:
    - Query tickets created by this user in the last 24 hours
    - Compare against the user's effective rate limit (tier override or global `ticket_creation_rate_limit` from `app_settings`)
    - If exceeded:
      - Check auto-reply rate limit
      - If under limit: send auto-reply using `auto_reply_rate_limit` template, log auto-reply
      - Discard
  - Create the ticket:
    - `title` = email subject (trimmed, max 300 chars)
    - `creator_id` = sender's profile ID
    - `status` = `'open'`
    - `urgency` = `'medium'`, `severity` = `'medium'`
    - `is_private` = admin-configured default (`ticket_default_privacy` from `app_settings`)
    - `type_id` = system default ticket type
    - `category_id` = null
    - No tags
    - `custom_fields` = populate with each custom field's `default_value`
  - Create the original post: `is_original = true`, body = stripped email content
  - Handle attachments:
    - For each attachment in the email:
      - Check file type against allowed types (from `app_settings` file upload settings)
      - Check file size against max size (from `app_settings`, with tier override if applicable)
      - Check files-per-post limit
      - Sanitize SVG attachments using `sanitizeSvg()`
      - Upload valid attachments to Supabase Storage
    - For excluded attachments, append a note to the post body:
      `"\n\n---\n*The following attachments were not included: {filename} ({reason}), ...*"`
  - Generate slug, initialize SLA timer, auto-follow creator
  - Trigger standard new-ticket notifications
  - **Do NOT** apply AI auto-categorization or duplicate detection to email-created tickets

### 3. API Route: Inbound Email Webhook

**`src/app/api/inbound-email/route.ts`** (new file):

- `POST` handler for receiving inbound emails from the email provider (webhook)
- Parse the inbound email payload (provider-specific format — use a generic parser that extracts sender, subject, body, attachments)
- Call `processInboundEmail()` Server Action
- Return `200 OK` regardless of processing outcome (to prevent email provider retries on expected rejections)
- Validate the webhook request authenticity (provider-specific signature verification if available)

> **Note:** The specific payload format depends on the email service provider (e.g., SendGrid Inbound Parse, Mailgun Routes, Postmark Inbound). Implement a generic parser with a provider-specific adapter pattern. The admin configures which provider is in use from the admin panel.

### 4. Admin UI: Inbound Email Configuration

Update the admin setup page to add a new sidebar section:

**Route**: `/admin/inbound-email` (add to the admin sidebar navigation, after "Notification Templates")

**Inbound Email Configuration section:**
- **Enable inbound email** — toggle (default: off)
- **Reply-to address** — text input for the support email address (e.g., `support@example.com`). This address is used as the `Reply-To` header in outbound notification emails so replies route back to the system.
- **Save** button
- Validation: reply-to address must be a valid email format when inbound is enabled
- Save action updates `app_settings` keys: `inbound_email_enabled`, `inbound_email_reply_to_address`
- Changes recorded in admin audit log

**Auto-reply templates section** (below configuration):
- Link to the notification templates page with guidance: "Auto-reply templates can be edited in the Notification Templates section"
- Or: inline list of the 4 auto-reply templates (`auto_reply_unknown_sender`, `auto_reply_blocked_user`, `auto_reply_duplicate_ticket`, `auto_reply_rate_limit`) with "Edit" links to the template editor

### 5. Update Outbound Email Reply-To Header

Update `src/lib/email/send.ts`:
- When sending notification emails, check `app_settings` for `inbound_email_reply_to_address`
- If configured and inbound email is enabled:
  - Set the `Reply-To` header to the configured address
  - Include `[Ticket #ID]` in the email subject line so replies can be matched to tickets

### 6. Tests

**`tests/db/017-inbound-email.test.ts`** (new file):

- **auto_reply_log table:**
  - Service role can insert and query rows
  - Regular users cannot access (RLS)
  - Rate limiting: correctly counts rows within 1-hour window
  - Cleanup: rows older than 24 hours can be deleted

- **Settings:**
  - `inbound_email_enabled` and `inbound_email_reply_to_address` exist in `app_settings`
  - Admin can update these settings

- **Auto-reply templates:**
  - All 4 auto-reply templates exist in `notification_templates`
  - Templates can be customized by admin

**`tests/e2e/inbound-email.spec.ts`** (new file):

- **Admin configuration:**
  - Admin can navigate to `/admin/inbound-email`
  - Toggle inbound email on/off
  - Set reply-to address with validation
  - Settings persist after save

- **Email signature stripping** (unit-level tests, can be in a separate test file or inline):
  - Strips `-- ` signature delimiter
  - Strips `___` delimiter
  - Strips `Sent from my iPhone` footer
  - Strips quoted reply blocks (`>` lines)
  - Strips forwarded message headers
  - Returns original body if stripping results in empty content
  - Handles empty body gracefully

- **Thread matching:**
  - Extracts ticket ID from `[Ticket #123]` pattern
  - Returns null for subjects without ticket reference
  - Handles edge cases (multiple brackets, no number)

- **New ticket creation by email** (integration — may require mocking the webhook):
  - Email from known user creates a ticket with correct defaults
  - Email subject becomes ticket title (truncated to 300 chars)
  - Email body becomes original post (signature stripped)
  - Custom fields populated with defaults
  - Valid attachments uploaded, invalid ones listed in post body footnote
  - Blocked user email rejected with auto-reply
  - Rate-limited user email rejected with auto-reply
  - Unknown sender email rejected with auto-reply

- **Reply by email:**
  - Reply with `[Ticket #123]` subject creates post on ticket
  - Non-agent reply to closed/pending ticket re-opens it
  - Agent reply does not auto-transition status
  - Reply to duplicate ticket by non-agent rejected with auto-reply
  - Reply to duplicate ticket by agent is processed normally
  - Blocked user reply rejected
  - User without ticket access: email discarded silently

- **Auto-reply rate limiting:**
  - First 3 auto-replies within 1 hour are sent
  - 4th auto-reply within 1 hour is silently discarded
  - After 1 hour, auto-replies resume

## Implementation Notes

- **Webhook security:** Validate inbound webhook requests using provider-specific authentication (e.g., SendGrid's `X-Twilio-Email-Event-Webhook-Signature` header). If no provider-specific auth is available, use a shared secret in the webhook URL.
- **Email body format:** Prefer plain text over HTML for parsing. If only HTML is available, strip HTML tags before processing.
- **Attachment handling:** Email attachments are typically base64-encoded. Decode before uploading to Supabase Storage.
- **Idempotency:** Use the email's `Message-ID` header to prevent duplicate processing if the webhook is retried.
- **Error handling:** All processing steps should be wrapped in try/catch. Failures should be logged but should not cause the webhook to return an error (which would trigger retries).
- **The pg_cron cleanup job** for `auto_reply_log` integrates with the existing daily cron pattern from architecture constraint 11. Add it alongside the existing notification cleanup and SLA monitoring jobs.

## Verification Checklist

- [ ] `auto_reply_log` table created with RLS (service_role only)
- [ ] 4 auto-reply notification templates seeded
- [ ] Admin can enable/disable inbound email and set reply-to address
- [ ] Email signature stripping handles common patterns
- [ ] Thread matching extracts ticket ID from `[Ticket #123]` subject
- [ ] New ticket created from email with correct defaults and custom field defaults
- [ ] Attachments validated (type, size, count), excluded files noted in post body
- [ ] SVG attachments sanitized
- [ ] Reply by email creates post on matched ticket
- [ ] Non-agent reply to closed/pending ticket auto-transitions to open
- [ ] Agent reply does not auto-transition status
- [ ] Reply to duplicate ticket by non-agent rejected with auto-reply
- [ ] Unknown sender gets auto-reply with registration link
- [ ] Blocked user gets auto-reply about restricted account
- [ ] Rate-limited user gets auto-reply about limit
- [ ] Auto-reply rate limited to 3 per recipient per hour
- [ ] Auto-reply log cleaned up daily (rows older than 24 hours)
- [ ] Outbound emails include `Reply-To` header and `[Ticket #ID]` in subject when inbound is enabled
- [ ] AI features (auto-categorization, duplicate detection) NOT applied to email-created tickets
- [ ] Webhook endpoint returns 200 OK for all outcomes
- [ ] `npm run test:db` passes inbound-email tests
- [ ] `npm run test:e2e` passes inbound-email tests
