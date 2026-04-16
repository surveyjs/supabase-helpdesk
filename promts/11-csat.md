# Phase 11 — CSAT (Customer Satisfaction)

## Context

You are building the Customer Satisfaction (CSAT) rating system for a **HelpDesk** application. Read `docs/requirements.md` sections 3.10, 16.19, 16.23, and `docs/architecture.md` constraints 2, 11.

Phases 0–10 are complete: project init, database schema, authentication, tickets, agent dashboard, taxonomy, posts/comments/notes, admin setup, file attachments, email notifications (SMTP, preferences, coalescing), and real-time/in-app notifications. The notification infrastructure (`notifyUser`, `notifyAgent`, `notifyTicketRecipients` in `src/lib/email/notify.ts`) and the admin notification templates table are in place.

This phase adds CSAT token-based rating, the rating page, rating display on ticket detail, CSAT survey email scheduling via pg_cron, and the admin CSAT settings section.

## Tasks

### 1. Migration: `supabase/migrations/010_csat.sql`

#### CSAT Ratings Table

```sql
CREATE TABLE csat_ratings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id BIGINT NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  token TEXT NOT NULL UNIQUE,
  rating INTEGER CHECK (rating >= 1 AND rating <= 5),
  comment TEXT CHECK (char_length(comment) <= 5000),
  submitted_at TIMESTAMPTZ,
  token_expires_at TIMESTAMPTZ NOT NULL,
  is_used BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_csat_ratings_ticket_id ON csat_ratings (ticket_id);
CREATE INDEX idx_csat_ratings_token ON csat_ratings (token);

ALTER TABLE csat_ratings ENABLE ROW LEVEL SECURITY;

-- Public (unauthenticated) read by token for the rating page
CREATE POLICY csat_ratings_select_by_token ON csat_ratings
  FOR SELECT USING (true);

-- Insert via service role (system-generated tokens)
CREATE POLICY csat_ratings_insert ON csat_ratings
  FOR INSERT WITH CHECK (true);

-- Update via service role (rating submission)
CREATE POLICY csat_ratings_update ON csat_ratings
  FOR UPDATE USING (true);
```

> **Note:** The CSAT rating page is token-based and does not require login (§3.10). The RLS policies are intentionally open for SELECT/UPDATE because access control is enforced at the application level via token validation. The token is cryptographically random (32+ bytes) and single-use, making it functionally equivalent to a capability URL.

#### CSAT Survey Schedule Table

```sql
CREATE TABLE csat_survey_schedule (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id BIGINT NOT NULL REFERENCES tickets(id) ON DELETE CASCADE UNIQUE,
  scheduled_at TIMESTAMPTZ NOT NULL,
  is_sent BOOLEAN NOT NULL DEFAULT false,
  is_cancelled BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_csat_survey_schedule_pending
  ON csat_survey_schedule (scheduled_at)
  WHERE is_sent = false AND is_cancelled = false;

ALTER TABLE csat_survey_schedule ENABLE ROW LEVEL SECURITY;

-- Service role only — no direct user access
CREATE POLICY csat_survey_schedule_select ON csat_survey_schedule
  FOR SELECT USING (is_admin());
CREATE POLICY csat_survey_schedule_insert ON csat_survey_schedule
  FOR INSERT WITH CHECK (true);
CREATE POLICY csat_survey_schedule_update ON csat_survey_schedule
  FOR UPDATE USING (true);
```

#### CSAT Settings in app_settings

```sql
INSERT INTO app_settings (key, value) VALUES
  ('csat_enabled', 'false'),
  ('csat_survey_delay', '1_hour')
ON CONFLICT (key) DO NOTHING;
```

Valid `csat_survey_delay` values: `'immediately'`, `'1_hour'`, `'4_hours'`, `'24_hours'`.

#### CSAT Notification Template

```sql
INSERT INTO notification_templates (event_type, subject, body)
VALUES (
  'csat_survey',
  'How was your experience? Rate ticket #{{ticketId}}',
  'Hi {{userName}},\n\nYour ticket "{{ticketTitle}}" has been resolved. We''d love to hear how we did!\n\nPlease rate your experience:\n{{csatLink}}\n\nThis link expires in 30 days.\n\nThank you!'
)
ON CONFLICT (event_type) DO NOTHING;

INSERT INTO notification_templates (event_type, subject, body)
VALUES (
  'csat_submitted',
  'New CSAT rating on ticket #{{ticketId}}',
  'A {{rating}}-star rating was submitted on ticket "{{ticketTitle}}" by {{userName}}.\n\n{{comment}}'
)
ON CONFLICT (event_type) DO NOTHING;
```

#### CSAT Survey Cron Job

```sql
-- Process pending CSAT survey emails every 5 minutes
SELECT cron.schedule(
  'send-csat-surveys',
  '*/5 * * * *',
  $$
  -- This cron job marks rows as sent; the actual email sending
  -- is handled by a Server Action invoked by the cron via pg_net or
  -- by querying pending surveys in the notification coalescing job.
  UPDATE csat_survey_schedule
  SET is_sent = true
  WHERE is_sent = false
    AND is_cancelled = false
    AND scheduled_at <= now();
  $$
);
```

> **Implementation note:** The cron job marks surveys as ready. The actual email dispatch should be handled by extending the existing notification coalescing cron logic (Phase 9) or by a dedicated Server Action endpoint. The simplest approach: in the existing coalescing job processing, also query `csat_survey_schedule` for rows where `is_sent = false AND is_cancelled = false AND scheduled_at <= now()` and send the CSAT email for each, then mark `is_sent = true`.

### 2. CSAT Token Utilities

**`src/lib/utils/csat.ts`** (new file):

- `generateCsatToken(): string` — Generate a cryptographically random token with at least 32 bytes of entropy. Use `crypto.randomBytes(32).toString('hex')` (Node.js crypto module). Returns a 64-character hex string.

- `createCsatToken(ticketId: number): Promise<string>` — Insert a new `csat_ratings` row with the generated token, `token_expires_at = now() + 30 days`, `is_used = false`. Returns the token. Uses the service-role Supabase client.

- `reissueCsatToken(ticketId: number): Promise<string>` — Invalidate any existing unused token for this ticket (mark `is_used = true`), then create a new token. Returns the new token. Used when the user wants to update their rating from the ticket detail page.

- `validateCsatToken(token: string): Promise<{ valid: boolean; ticketId?: number; existingRating?: number }>` — Look up the token; return invalid if not found, expired (`token_expires_at < now()`), or already used (`is_used = true` and no rating submitted). If a rating was already submitted via this token (from a previous submission with reissue), return the existing rating and ticket info.

### 3. Server Actions for CSAT

**`src/lib/actions/csat.ts`** (new file):

- `submitCsatRating(token: string, rating: number, comment?: string)`:
  - Validate token via `validateCsatToken`
  - Validate rating is 1–5 integer
  - Validate comment length (max 5000 chars)
  - Check that the ticket owner is not an agent/admin (agents cannot rate, §3.10)
  - Update the `csat_ratings` row: set `rating`, `comment`, `submitted_at = now()`, `is_used = true`
  - Issue a **new token** (reissue) so the confirmation page can provide an update link
  - Log in `activity_log` on the ticket
  - Notify the assigned agent (`csat_submitted` event) via `notifyAgent()`
  - Return `{ success: true, newToken: string }`

- `scheduleCsatSurvey(ticketId: number)`:
  - Read `csat_enabled` from `app_settings`. If disabled, return early.
  - Check if the ticket already has a CSAT rating submitted. If yes, do not schedule (§16.19).
  - Read `csat_survey_delay` from `app_settings`. Calculate `scheduled_at` based on delay.
  - Upsert into `csat_survey_schedule` (if a cancelled row exists, update it with new schedule).
  - Uses service-role client.

- `cancelCsatSurvey(ticketId: number)`:
  - Mark any pending (unsent, uncancelled) survey for this ticket as `is_cancelled = true`.
  - Called when a closed ticket is re-opened before the survey is sent.

- `getCsatRating(ticketId: number)`:
  - Return the latest submitted CSAT rating for a ticket (rating, comment, submitted_at), or null.

- `requestCsatToken(ticketId: number)`:
  - Called from the "Rate this ticket" / "Update rating" link on ticket detail.
  - Verify the current user is the ticket owner and is a regular user (not agent/admin).
  - Call `reissueCsatToken(ticketId)`.
  - Redirect to `/csat/{token}`.

### 4. CSAT Rating Page

**`src/app/csat/[token]/page.tsx`** (new route — outside `(auth)` and `(main)` layouts):
- This page does **not** require authentication
- Validate the token via `validateCsatToken()`
- If invalid/expired: render a friendly error page using the CSAT token error template from `notification_templates` (event_type `csat_token_error`) or a default message. Include a link to the login page.
- If valid:
  - Show the ticket title (fetched via service-role client)
  - If a previous rating exists, pre-fill the star value
  - Star rating input (1–5 clickable stars)
  - Optional comment text area (max 5000 chars)
  - Submit button
- On submit: call `submitCsatRating` Server Action
- On success: show a confirmation page with:
  - "Thank you for your feedback!" message
  - The submitted rating displayed
  - A persistent link with the new token: "Bookmark this link to update your rating later: `/csat/{newToken}`"

**Layout:** Use a minimal layout (no NavBar, no sidebar) — just a centered card on the page background. The page should feel lightweight and self-contained.

### 5. CSAT Display on Ticket Detail

Update `src/app/(main)/tickets/[id]/[slug]/page.tsx`:

- In the ticket metadata/sidebar area, display the CSAT rating if one exists:
  - Show star icons (filled/empty) with the numeric rating (e.g., "★★★★☆ 4/5")
  - Show the comment text below (if any), truncated with "show more"
  - Show the submission timestamp

- **For the ticket owner (regular user only):**
  - If the ticket is closed and **no rating** exists: show a **"Rate this ticket"** link
  - If a rating exists: show an **"Update rating"** link
  - Both links call the `requestCsatToken` Server Action which redirects to `/csat/{token}`

- **For agents:** show the rating as read-only. No rate/update links.

### 6. Integration with Ticket Status Changes

Update `src/lib/actions/agent.ts` — `changeTicketStatus`:
- When status changes to **closed**: call `scheduleCsatSurvey(ticketId)`
- When status changes from **closed** to **open** (re-open): call `cancelCsatSurvey(ticketId)`

Update `src/lib/actions/tickets.ts` — `replyToTicket`:
- When a user reply auto-transitions a ticket from closed to open: call `cancelCsatSurvey(ticketId)`

> **Important:** Do NOT schedule CSAT surveys when a ticket is closed due to being marked as duplicate (§9.4). The duplicate marking flow in Phase 17 will handle this by skipping `scheduleCsatSurvey`. For now, always schedule on close — Phase 17 will add the guard.

### 7. CSAT Survey Email Dispatch

Extend the notification coalescing/dispatch logic (Phase 9):

**`src/lib/email/csat.ts`** (new file):
- `processPendingCsatSurveys()`:
  - Query `csat_survey_schedule` for rows where `is_sent = false AND is_cancelled = false AND scheduled_at <= now()`
  - For each:
    - Fetch ticket info (title, owner)
    - Check that CSAT is still enabled (setting may have changed)
    - Check that no rating has been submitted yet
    - Generate a CSAT token via `createCsatToken(ticketId)`
    - Render the `csat_survey` email template with placeholders: `{{userName}}`, `{{ticketTitle}}`, `{{ticketId}}`, `{{csatLink}}` (full URL to `/csat/{token}`)
    - Send the email via the existing SMTP infrastructure
    - Mark `is_sent = true`
  - This function is called from the cron job processing path

### 8. Admin CSAT Settings Section

Add a new section to the Admin Setup sidebar: **"CSAT Settings"** (route: `/admin/csat`).

**`src/app/(main)/admin/csat/page.tsx`**:
- Require admin role
- **Enable CSAT surveys** toggle:
  - Disabled with warning message if email is not configured/verified (check `email_config.is_verified`)
  - Reads/writes `app_settings` key `csat_enabled`
- **Survey delay** selector:
  - Radio buttons or dropdown: "Immediately", "1 hour" (default), "4 hours", "24 hours"
  - Reads/writes `app_settings` key `csat_survey_delay`
- Save button + success/error feedback
- Log changes to `admin_audit_log`

**Server Actions** (add to `src/lib/actions/admin.ts`):
- `updateCsatSettings(enabled: boolean, delay: string)`:
  - Require admin
  - Validate delay is one of: `'immediately'`, `'1_hour'`, `'4_hours'`, `'24_hours'`
  - Update `app_settings`
  - Log to `admin_audit_log`
  - Revalidate

### 9. NavBar Update

Update the Admin Setup sidebar navigation (created in Phase 7) to include the "CSAT Settings" link.

### 10. Tests

**`tests/db/011-csat.test.ts`** (new file):
- CSAT token creation generates valid 64-char hex token
- Token validation returns valid for fresh token
- Token validation returns invalid for expired token
- Token validation returns invalid for used token
- Rating submission stores rating and comment correctly
- Rating submission marks token as used
- New token is issued after rating submission (reissue)
- CSAT rating is associated with correct ticket
- Only one active token per ticket at a time
- CSAT survey schedule inserts correctly
- Cancelling a survey updates `is_cancelled`
- Duplicate schedule (UNIQUE constraint on ticket_id) upserts correctly
- CSAT table CASCADE deletes when ticket is deleted
- Agent/admin cannot submit CSAT via Server Action (role check)

**`tests/e2e/csat.spec.ts`** (new file):
- CSAT rating page renders with valid token
- Invalid token shows error page
- Expired token shows error page
- Submit 1–5 star rating — stores correctly
- Submit rating with comment — stores correctly
- Confirmation page shows new token link
- Rating displays on ticket detail page (agent view)
- "Rate this ticket" link appears for ticket owner on closed ticket
- "Update rating" link appears after rating is submitted
- Clicking "Rate this ticket" redirects to CSAT page
- Updating a rating overwrites previous one
- Agent cannot see "Rate this ticket" link on own tickets
- CSAT settings page: toggle enable/disable, change delay
- CSAT settings: toggle disabled when email not configured

## Implementation Notes

- **Token security:** CSAT tokens must use `crypto.randomBytes(32)` — do NOT use `Math.random()` or `uuid`. The 64-char hex string provides 256 bits of entropy, making tokens unguessable.
- **No login required:** The `/csat/[token]` route must be accessible without authentication. It should NOT use the `(auth)` or `(main)` layout groups. Create it directly under `src/app/csat/`.
- **Service-role client:** All CSAT operations (token creation, validation, rating submission, survey scheduling) use the service-role Supabase client because they operate across user boundaries.
- **Survey scheduling integration:** When `changeTicketStatus` sets status to 'closed', call `scheduleCsatSurvey`. When a ticket transitions from closed to open (either via agent action or user reply), call `cancelCsatSurvey`.
- **Idempotency:** If a ticket is closed, re-opened, and closed again, a new survey should be scheduled only if no rating has been submitted yet (§16.19).
- **Error template:** The error page for invalid CSAT tokens is configured via `notification_templates` (event_type set up for error pages in Phase 7), or fallback to a hardcoded friendly message.

## Deferred Features (Added by Later Phases)

- Duplicate close does NOT trigger CSAT survey — Phase 17
- Merge cancels source ticket's pending CSAT survey — Phase 17
- Bulk close triggers CSAT scheduling per ticket — Phase 17
- CSAT summary chart in reporting — Phase 14

## Verification Checklist

- [ ] CSAT token generated with 32+ bytes cryptographic randomness
- [ ] Rating page works without login
- [ ] Invalid/expired tokens show error page
- [ ] 1–5 star rating submits and stores correctly
- [ ] Comment stores correctly (max 5000 chars)
- [ ] Token is single-use; new token issued on submission
- [ ] Confirmation page shows bookmarkable link with new token
- [ ] Rating displays on ticket detail (stars + comment + timestamp)
- [ ] "Rate this ticket" link for owner on closed ticket with no rating
- [ ] "Update rating" link for owner when rating exists
- [ ] Agent/admin cannot rate tickets
- [ ] CSAT survey email scheduled on ticket close (when enabled)
- [ ] Survey cancelled when ticket re-opened before send
- [ ] No duplicate survey when ticket closed again after rating submitted
- [ ] Admin CSAT settings: enable toggle, delay selection
- [ ] CSAT toggle disabled when email not configured
- [ ] Activity log records CSAT submission
- [ ] Assigned agent notified on rating submission
- [ ] `npm run typecheck` passes with no errors
- [ ] `npm run lint` passes with no errors
- [ ] `npm run test:db` passes CSAT tests
- [ ] `npm run test:e2e` passes CSAT e2e tests
