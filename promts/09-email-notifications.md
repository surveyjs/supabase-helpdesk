# Phase 9 — Email Notifications

## Context

You are building email notification infrastructure for a **HelpDesk** application. Read `docs/requirements.md` sections 14.1–14.6, 16.7, 16.8, 16.26, 16.29, and `docs/architecture.md` constraint 11.

Phases 0–8 are complete: project init, database schema, authentication, tickets, agent dashboard, taxonomy, posts/comments/notes, admin setup, and file attachments. Notification templates were created in Phase 7 (migration `005_admin.sql`) with default subject/body for the event types that exist so far.

This phase adds the SMTP email sending infrastructure, user notification preferences, notification coalescing, and integrates notifications with all existing ticket actions.

## Tasks

### 1. Migration: `supabase/migrations/007_notifications.sql`

#### Email Configuration Table

```sql
CREATE TABLE email_config (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  smtp_host TEXT NOT NULL DEFAULT '',
  smtp_port INTEGER NOT NULL DEFAULT 587,
  smtp_username TEXT NOT NULL DEFAULT '',
  smtp_password TEXT NOT NULL DEFAULT '',
  sender_email TEXT NOT NULL DEFAULT '',
  sender_name TEXT NOT NULL DEFAULT 'HelpDesk',
  is_verified BOOLEAN NOT NULL DEFAULT false,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE email_config ENABLE ROW LEVEL SECURITY;

CREATE POLICY email_config_select ON email_config
  FOR SELECT USING (is_admin());
CREATE POLICY email_config_update ON email_config
  FOR UPDATE USING (is_admin());
CREATE POLICY email_config_insert ON email_config
  FOR INSERT WITH CHECK (is_admin());

-- Seed a single config row (only one config is used)
INSERT INTO email_config (id) VALUES (gen_random_uuid());
```

#### User Notification Preferences Table

```sql
CREATE TABLE notification_preferences (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE UNIQUE,
  preferences JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE notification_preferences ENABLE ROW LEVEL SECURITY;

-- Users can read/write their own preferences
CREATE POLICY notification_preferences_select ON notification_preferences
  FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY notification_preferences_insert ON notification_preferences
  FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY notification_preferences_update ON notification_preferences
  FOR UPDATE USING (auth.uid() = user_id);
```

The `preferences` JSONB stores a map of event_type → `{ email: boolean, in_app: boolean }`. Example:
```json
{
  "new_post": { "email": true, "in_app": true },
  "status_changed": { "email": true, "in_app": true },
  "agent_assigned": { "email": false, "in_app": true }
}
```

When a preference is not set, the system-wide defaults (from admin settings, §16.26) are used.

#### Notification Coalescing Queue Table

```sql
CREATE TABLE notification_coalescing_queue (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id BIGINT NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  recipient_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  events JSONB NOT NULL DEFAULT '[]',
  triggering_agent_id UUID REFERENCES profiles(id),
  send_after TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX idx_coalescing_queue_ticket_recipient
  ON notification_coalescing_queue (ticket_id, recipient_id);

CREATE INDEX idx_coalescing_queue_send_after
  ON notification_coalescing_queue (send_after);

ALTER TABLE notification_coalescing_queue ENABLE ROW LEVEL SECURITY;

-- Only service role (cron job) needs to access this table
-- Application code uses service role client for queue operations
CREATE POLICY coalescing_queue_service ON notification_coalescing_queue
  FOR ALL USING (auth.uid() IS NOT NULL);
```

#### Default Notification Preferences in app_settings

```sql
INSERT INTO app_settings (key, value) VALUES
  ('default_notification_preferences', '{"new_post":{"email":true,"in_app":true},"status_changed":{"email":true,"in_app":true},"agent_assigned":{"email":true,"in_app":true},"agent_assigned_to_agent":{"email":true,"in_app":true},"user_reply_to_agent":{"email":true,"in_app":true},"auto_reopen":{"email":true,"in_app":true}}'),
  ('notification_coalescing_delay_minutes', '2')
ON CONFLICT (key) DO NOTHING;
```

### 2. Email Sending Infrastructure

**`src/lib/email/send.ts`** (new file):
- Install `nodemailer`: `npm install nodemailer` and `npm install -D @types/nodemailer`
- `sendEmail(to, subject, htmlBody)` function:
  - Read SMTP config from `email_config` table (via service role client to bypass RLS)
  - If SMTP is not configured/verified, log a warning and skip
  - Create nodemailer transporter and send
  - Handle errors gracefully (log, don't crash)

**`src/lib/email/templates.ts`** (new file):
- `renderTemplate(eventType, placeholders)` function:
  - Fetch the template from `notification_templates` by `event_type`
  - Replace `{{placeholder}}` tokens with actual values
  - Render Markdown body to HTML using the same pipeline as posts (same sanitization)
  - Return `{ subject, html }`
- Default templates constant object — used as fallback when `is_customized = false`

**`src/lib/email/notify.ts`** (new file):
- `notifyUser(recipientId, eventType, ticketId, placeholders)` — primary notification dispatch function:
  - Fetch recipient's notification preferences (or use system defaults)
  - Check if email notifications are enabled for this event type
  - If coalescing is enabled (delay > 0) and this is an agent-triggered notification to a user/follower:
    - **Enqueue**: Insert/update `notification_coalescing_queue`
    - If a queue entry exists for this ticket+recipient: update `send_after` to `now() + delay`, append event to events JSONB array (apply post/comment edit coalescing if applicable)
    - If no entry exists: insert new queue entry
  - If coalescing is not applicable (agent-to-agent, or delay = 0): send immediately via `sendEmail`
  
- `notifyAgent(agentId, eventType, ticketId, placeholders)` — agent notification (never coalesced):
  - Check agent's notification preferences
  - Send immediately if enabled

- `notifyTicketRecipients(ticketId, eventType, placeholders, excludeUserId?)` — convenience function:
  - Determine recipients: ticket owner + followers
  - Exclude the actor (person who triggered the event)
  - Call `notifyUser` for each recipient

### 3. Notification Coalescing Cron Job

**`supabase/migrations/007_notifications.sql`** (append):

```sql
-- Enable pg_cron extension (may already be enabled in hosted Supabase)
CREATE EXTENSION IF NOT EXISTS pg_cron;

-- Cron job: process coalescing queue every 1 minute
SELECT cron.schedule(
  'process-notification-queue',
  '* * * * *',
  $$
  SELECT net.http_post(
    url := current_setting('app.settings.site_url', true) || '/api/cron/notifications',
    body := '{}',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || current_setting('app.settings.service_role_key', true)
    )
  );
  $$
);
```

> **Alternative approach:** If `pg_cron` calling an HTTP endpoint is complex for local dev, implement the coalescing processor as part of the notification send logic — check and process pending entries on each notification event. For now, the coalescing delay defaults to 2 minutes.

**`src/app/api/cron/notifications/route.ts`** (new file):
- POST endpoint (secured with service role key check)
- Query `notification_coalescing_queue` where `send_after <= now()`
- For each entry:
  - If single event: render and send using the standard event template
  - If multiple events: render using the "consolidated update" template (list all changes)
  - Apply post/comment edit coalescing (merge "created" + "edited" events for the same post)
  - Delete the processed queue entry
  - Log any errors but continue processing

### 4. Integrate Notifications with Existing Actions

Update these existing Server Actions to trigger notifications:

**`src/lib/actions/tickets.ts`**:
- `replyToTicket` → notify ticket owner + followers (event: `new_post`), notify assigned agent (event: `user_reply_to_agent`)
  - If auto-transition occurred: also notify with `status_changed` / `auto_reopen`
  - Skip notification to the person who posted
  - Private notes/drafts do NOT trigger user notifications

**`src/lib/actions/agent.ts`**:
- `changeTicketStatus` → notify owner + followers (event: `status_changed`)
- `assignAgent` → notify owner + followers (event: `agent_assigned`), notify the assigned agent (event: `agent_assigned_to_agent`)
- `reassignAgent` → notify owner + followers (event: `agent_assigned`), notify the new agent (event: `agent_assigned_to_agent` with reason)
- `unassignAgent` → notify owner + followers (event: `agent_assigned`, with "unassigned" detail)
- `changeUrgency` → notify owner + followers (event: `urgency_changed`)
- `changeSeverity` → notify owner + followers (event: `severity_changed`)
- `toggleTicketPrivacy` → notify owner + followers (event: `privacy_changed`)
- All agent actions are subject to coalescing (if delay > 0)

**`src/lib/actions/tickets.ts`** (new entries for Phase 6 actions):
- `publishDraft` → notify owner + followers (event depends on post type: `new_post` for post/comment drafts published)
- `addComment` → notify owner + followers (event: `new_post`), notify assigned agent if commenter is user

> **Important:** The actor (person who performed the action) never receives a notification for their own action. Use `excludeUserId` parameter.

> **Important:** Notifications for duplicate tickets: when a ticket is marked as duplicate (Phase 4/17), the automatic closure does NOT trigger notifications. Handle this by checking `duplicate_of_id` before sending status_changed notifications.

### 5. User Notification Preferences Page

**`src/app/(main)/notifications/settings/page.tsx`** (new file):
- Accessible via the "Notification Settings" link in the NavBar dropdown (created in Phase 2)
- Show a table of all notification event types
- For each event: two toggle columns — Email and In-App (in-app toggles are placeholders until Phase 10)
- Current values: from user's `notification_preferences` row, falling back to system defaults
- "Save" button to persist changes

**Server Actions** (new `src/lib/actions/notifications.ts`):
- `updateNotificationPreferences(preferences)` — validate the JSONB structure, upsert into `notification_preferences`, revalidate

### 6. Admin Email Configuration (§16.7)

**`src/app/(main)/admin/email/page.tsx`**:
- SMTP configuration form:
  - SMTP host, port, username, password (masked), sender email, sender name
  - "Save" button
  - "Send Test Email" button — sends a test email to the admin's own email address using the saved config
  - Verification status indicator (green check / red X)
- Log changes to admin audit log (passwords logged as "changed" without value)

**Server Actions** (add to `src/lib/actions/admin.ts`):
- `updateEmailConfig(config)` — require admin, validate, update `email_config`, log audit, revalidate
- `sendTestEmail()` — require admin, send test email using current config, update `is_verified`, revalidate

### 7. Admin Notification Templates Update (§16.8)

Update the templates admin page (`src/app/(main)/admin/templates/page.tsx`) to include:
- All event types with their available placeholders
- Group templates by category: "User Notifications", "Agent Notifications", "Auto-Replies"
- Show which placeholders are available per template (e.g., `{{ticketTitle}}`, `{{ticketId}}`, `{{ticketUrl}}`, `{{authorName}}`, `{{postBody}}`, `{{ownerName}}`)
- The "Consolidated Update" template (for coalesced notifications): supports `{{changeList}}`, `{{ticketTitle}}`, `{{ticketId}}`, `{{ticketUrl}}`, `{{agentName}}`, `{{ownerName}}`

Add any missing default templates to the seed/migration for new events:
- `urgency_changed`
- `severity_changed`
- `privacy_changed`
- `consolidated_update` — the coalescing template

### 8. Admin Default Notification Preferences (§16.26 part 2)

Update `src/app/(main)/admin/user-settings/page.tsx`:
- Replace the placeholder notification preferences section with the actual UI:
  - Table listing all notification event types
  - Two toggle columns per event: Email (default), In-App (default)
  - "Save" button updates `app_settings.default_notification_preferences`
  - Changes affect only new user registrations, not existing users
  - Log changes to admin audit log

### 9. Admin Notification Coalescing Delay (§16.29)

Add to the email configuration page or create a dedicated section:

**`src/app/(main)/admin/email/page.tsx`** (append section):
- **Coalescing delay** — numeric input in minutes (min 0, max 15, default 2)
  - 0 = disabled (notifications sent immediately)
  - Show explanation text: "How long to wait after an agent action before sending email notifications. Additional agent actions during this window are consolidated into a single email."
- Stored in `app_settings.notification_coalescing_delay_minutes`
- Log changes to admin audit log

### 10. Admin Sidebar Update

Add new sections to the admin sidebar (in `src/app/(main)/admin/layout.tsx`):
- "Email" → `/admin/email` (after "Templates")

Reorder sidebar to have a logical flow:
1. Ticket Types
2. Categories
3. Tags
4. Teams
5. Agents & Admins
6. Custom Fields
7. Ticket Privacy
8. Pagination
9. Rate Limit
10. File Uploads
11. Email
12. Templates
13. User Settings
14. Audit Log

### 11. Tests

**`tests/db/009-notifications.test.ts`** (new file):
- Email config: admin can read/update
- Email config: non-admin cannot read (RLS)
- Notification preferences: user can read/update own preferences
- Notification preferences: user cannot read others' preferences (RLS)
- Coalescing queue: entries are created with correct structure
- Coalescing queue: updating existing entry extends send_after and appends events
- Coalescing queue: entries are deleted when ticket is deleted (CASCADE)
- Default notification preferences in app_settings are parseable JSON
- Notification template rendering: placeholders are replaced correctly

**`tests/e2e/notifications.spec.ts`** (new file):
- Notification settings page: toggle email/in-app preferences
- Notification settings page: changes persist after reload
- Admin email config: save SMTP settings
- Admin email config: send test email (mock/stub the actual SMTP — in local dev, use Inbucket)
- Admin coalescing delay: change delay value
- Admin default preferences: change defaults, verify new user inherits them (create new user, check preferences)
- Admin templates: edit template, verify placeholder syntax preserved
- Notification trigger: agent replies to ticket → email sent (check Inbucket in local dev)
- Notification trigger: agent changes status → email sent
- Notification coalescing: agent makes two changes in quick succession → single email sent (after delay)
- User disables email for an event → no email sent for that event

## Implementation Notes

- **Nodemailer**: Use `nodemailer` for SMTP email sending. It's the standard Node.js email library and works well with Next.js Server Actions.
- **Local dev email testing**: Supabase local dev includes Inbucket at `http://localhost:54324`. Configure the SMTP settings to use Inbucket's SMTP endpoint (`localhost:54325`) for testing. This allows E2E tests to verify emails were actually sent by checking Inbucket's API.
- **Coalescing implementation**: The queue is simple — on each agent action, either insert a new entry or update the existing one for the same ticket+recipient pair. The UNIQUE index on `(ticket_id, recipient_id)` makes this efficient with `INSERT ... ON CONFLICT`.
- **Template defaults**: Store defaults in a TypeScript constants file (`src/lib/email/defaults.ts`). The migration seeds them into `notification_templates`, and the "Reset to Default" button restores from the constants file.
- **Post/comment edit coalescing**: When appending events to the queue, check if the last event is a "created" event for the same post ID as the current "edited" event. If so, replace the "created" event's body with the latest content and don't add a separate "edited" event.
- **Blocked users**: Do not send notifications to blocked users (check `is_blocked` before sending).
- **Self-notification prevention**: The actor never receives a notification for their own action. When an agent closes a ticket assigned to themselves, they don't get the closure notification.

## Deferred Features (Added by Later Phases)

- In-app notifications — Phase 10
- CSAT survey email — Phase 11
- SLA breach/approaching notifications — Phase 12
- Merge/duplicate notification templates — Phase 17
- Bulk action notification batching — Phase 17
- Inbound email processing — Phase 18

## Verification Checklist

- [ ] SMTP configuration saves and validates
- [ ] Test email sends successfully (via Inbucket in local dev)
- [ ] Agent reply triggers email notification to ticket owner
- [ ] Status change triggers email notification
- [ ] Agent assignment triggers notification to both user and agent
- [ ] User can toggle notification preferences
- [ ] Disabled notification types don't send
- [ ] Notification coalescing: multiple agent actions within delay produce single email
- [ ] Actor doesn't receive notification for own action
- [ ] Blocked users don't receive notifications
- [ ] Admin default preferences apply to new users
- [ ] Template customization works with placeholders
- [ ] Audit log captures email config and template changes
- [ ] `npm run typecheck` passes with no errors
- [ ] `npm run lint` passes with no errors
- [ ] `npm run test:db` passes notification tests
- [ ] `npm run test:e2e` passes notification e2e tests
