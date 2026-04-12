# Phase 12 — SLA Policies

## Context

You are building the SLA (Service Level Agreement) system for a **HelpDesk** application. Read `docs/requirements.md` sections 17.1–17.5, 16.15, 8.16, and `docs/architecture.md` constraints 2, 11.

Phases 0–11 are complete: project init, database schema, authentication, tickets, agent dashboard, taxonomy, posts/comments/notes, admin setup, file attachments, email notifications, real-time/in-app notifications, and CSAT ratings.

This phase adds SLA policies, business hours configuration, SLA timer tracking, SLA indicators on ticket detail and agent dashboard, SLA breach/approaching notifications via pg_cron, and the admin SLA configuration section.

## Tasks

### 1. Migration: `supabase/migrations/011_sla.sql`

#### SLA Policies Table

```sql
CREATE TABLE sla_policies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL UNIQUE CHECK (char_length(name) <= 100),
  first_response_minutes INTEGER NOT NULL CHECK (first_response_minutes > 0),
  resolution_minutes INTEGER NOT NULL CHECK (resolution_minutes > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE sla_policies ENABLE ROW LEVEL SECURITY;

CREATE POLICY sla_policies_select ON sla_policies
  FOR SELECT USING (auth.uid() IS NOT NULL);
CREATE POLICY sla_policies_insert ON sla_policies
  FOR INSERT WITH CHECK (is_admin());
CREATE POLICY sla_policies_update ON sla_policies
  FOR UPDATE USING (is_admin());
CREATE POLICY sla_policies_delete ON sla_policies
  FOR DELETE USING (is_admin());
```

#### SLA Severity Mapping Table

```sql
CREATE TABLE sla_severity_mapping (
  severity priority_level PRIMARY KEY,
  sla_policy_id UUID REFERENCES sla_policies(id) ON DELETE SET NULL
);

-- Seed all severity levels with no mapping
INSERT INTO sla_severity_mapping (severity) VALUES
  ('low'), ('medium'), ('high'), ('critical');

ALTER TABLE sla_severity_mapping ENABLE ROW LEVEL SECURITY;

CREATE POLICY sla_severity_mapping_select ON sla_severity_mapping
  FOR SELECT USING (auth.uid() IS NOT NULL);
CREATE POLICY sla_severity_mapping_update ON sla_severity_mapping
  FOR UPDATE USING (is_admin());
```

#### SLA Timers Table

```sql
CREATE TABLE sla_timers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id BIGINT NOT NULL REFERENCES tickets(id) ON DELETE CASCADE UNIQUE,
  sla_policy_id UUID REFERENCES sla_policies(id) ON DELETE SET NULL,
  first_response_deadline TIMESTAMPTZ,
  resolution_deadline TIMESTAMPTZ,
  first_response_elapsed_minutes INTEGER NOT NULL DEFAULT 0,
  resolution_elapsed_minutes INTEGER NOT NULL DEFAULT 0,
  first_response_paused_at TIMESTAMPTZ,
  resolution_paused_at TIMESTAMPTZ,
  first_response_met BOOLEAN,
  resolution_met BOOLEAN,
  first_response_at TIMESTAMPTZ,
  resolved_at TIMESTAMPTZ,
  is_paused BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_sla_timers_ticket_id ON sla_timers (ticket_id);
CREATE INDEX idx_sla_timers_first_response_deadline 
  ON sla_timers (first_response_deadline) 
  WHERE first_response_met IS NULL;
CREATE INDEX idx_sla_timers_resolution_deadline 
  ON sla_timers (resolution_deadline) 
  WHERE resolution_met IS NULL;

ALTER TABLE sla_timers ENABLE ROW LEVEL SECURITY;

-- Agents and admins can see SLA timers
CREATE POLICY sla_timers_select ON sla_timers
  FOR SELECT USING (is_agent());
-- System manages timers via service role
CREATE POLICY sla_timers_insert ON sla_timers
  FOR INSERT WITH CHECK (true);
CREATE POLICY sla_timers_update ON sla_timers
  FOR UPDATE USING (true);
```

#### SLA Notifications Sent (dedup tracking)

```sql
CREATE TABLE sla_notifications_sent (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sla_timer_id UUID NOT NULL REFERENCES sla_timers(id) ON DELETE CASCADE,
  notification_type TEXT NOT NULL CHECK (notification_type IN ('approaching_first_response', 'approaching_resolution', 'breached_first_response', 'breached_resolution')),
  sent_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (sla_timer_id, notification_type)
);

ALTER TABLE sla_notifications_sent ENABLE ROW LEVEL SECURITY;

CREATE POLICY sla_notifications_sent_select ON sla_notifications_sent
  FOR SELECT USING (is_agent());
CREATE POLICY sla_notifications_sent_insert ON sla_notifications_sent
  FOR INSERT WITH CHECK (true);
```

#### Business Hours Settings

```sql
INSERT INTO app_settings (key, value) VALUES
  ('sla_business_hours', '{"timezone":"UTC","schedule":{"monday":{"start":"09:00","end":"17:00"},"tuesday":{"start":"09:00","end":"17:00"},"wednesday":{"start":"09:00","end":"17:00"},"thursday":{"start":"09:00","end":"17:00"},"friday":{"start":"09:00","end":"17:00"},"saturday":null,"sunday":null}}'),
  ('sla_approaching_threshold', '75')
ON CONFLICT (key) DO NOTHING;
```

#### SLA Notification Templates

```sql
INSERT INTO notification_templates (event_type, subject, body) VALUES
  ('sla_approaching_first_response', 'SLA Warning: First response approaching on ticket #{{ticketId}}', 'The first response SLA target for ticket "{{ticketTitle}}" is approaching. {{elapsedTime}} of {{targetTime}} business hours elapsed ({{percentage}}%).'),
  ('sla_approaching_resolution', 'SLA Warning: Resolution approaching on ticket #{{ticketId}}', 'The resolution SLA target for ticket "{{ticketTitle}}" is approaching. {{elapsedTime}} of {{targetTime}} business hours elapsed ({{percentage}}%).'),
  ('sla_breached_first_response', 'SLA Breached: First response overdue on ticket #{{ticketId}}', 'The first response SLA target for ticket "{{ticketTitle}}" has been breached. Target was {{targetTime}} business hours; {{elapsedTime}} has elapsed.'),
  ('sla_breached_resolution', 'SLA Breached: Resolution overdue on ticket #{{ticketId}}', 'The resolution SLA target for ticket "{{ticketTitle}}" has been breached. Target was {{targetTime}} business hours; {{elapsedTime}} has elapsed.')
ON CONFLICT (event_type) DO NOTHING;
```

#### SLA Monitoring Cron Job

```sql
-- Check SLA timers every 5 minutes
SELECT cron.schedule(
  'check-sla-timers',
  '*/5 * * * *',
  $$
  -- This triggers a Server Action or pg_net call to process SLA checks.
  -- The actual logic (business hours calculation, notification dispatch)
  -- runs in the application layer.
  SELECT net.http_post(
    url := current_setting('app.settings.base_url', true) || '/api/cron/sla',
    headers := jsonb_build_object('Authorization', 'Bearer ' || current_setting('app.settings.cron_secret', true)),
    body := '{}'
  );
  $$
);
```

### 2. Business Hours Calculator

**`src/lib/utils/business-hours.ts`** (new file):

- `getBusinessHoursConfig(): Promise<BusinessHoursConfig>` — Read the `sla_business_hours` JSON from `app_settings`. Parse into a typed config: `{ timezone: string, schedule: Record<DayOfWeek, { start: string, end: string } | null> }`.

- `calculateBusinessMinutesElapsed(startTime: Date, endTime: Date, config: BusinessHoursConfig): number` — Calculate the number of business minutes between two timestamps, accounting for the configured business hours schedule and timezone. Skip non-working days and non-working hours.

- `addBusinessMinutes(startTime: Date, minutes: number, config: BusinessHoursConfig): Date` — Calculate the deadline by adding the given number of business minutes to the start time. Returns the calendar datetime when the SLA target expires.

- `calculateSlaPercentage(elapsedMinutes: number, targetMinutes: number): number` — Return percentage (0–100+).

> **Critical:** Business hours calculations must correctly handle timezone conversions, DST transitions, and working-day boundaries. Test edge cases like end-of-day, weekends, and start times outside business hours.

### 3. SLA Timer Management

**`src/lib/utils/sla.ts`** (new file):

- `initializeSlaTimer(ticketId: number, severity: string)`:
  - Look up the SLA policy for the given severity via `sla_severity_mapping`
  - If no policy mapped, return (no SLA tracking)
  - Calculate deadlines using business hours:
    - `first_response_deadline = addBusinessMinutes(now, policy.first_response_minutes)`
    - `resolution_deadline = addBusinessMinutes(now, policy.resolution_minutes)`
  - Insert into `sla_timers`
  - Uses service-role client

- `pauseSlaTimer(ticketId: number)`:
  - Called when ticket transitions to **pending**
  - Calculate elapsed business minutes so far, store in `first_response_elapsed_minutes` / `resolution_elapsed_minutes`
  - Set `is_paused = true`, `first_response_paused_at = now()`, `resolution_paused_at = now()`
  - Clear deadlines (they'll be recalculated on resume)

- `resumeSlaTimer(ticketId: number)`:
  - Called when ticket transitions from **pending** to **open**
  - Recalculate deadlines: `addBusinessMinutes(now, remaining_minutes)` where `remaining_minutes = target - elapsed`
  - Set `is_paused = false`, clear paused_at timestamps

- `stopFirstResponseTimer(ticketId: number)`:
  - Called when the first agent reply is posted
  - Set `first_response_at = now()`, calculate final elapsed, set `first_response_met = (elapsed <= target)`

- `stopResolutionTimer(ticketId: number)`:
  - Called when ticket is closed
  - Set `resolved_at = now()`, calculate final elapsed, set `resolution_met = (elapsed <= target)`

- `recalculateSlaTargets(ticketId: number, newSeverity: string)`:
  - Called when severity changes
  - Look up new SLA policy for the new severity
  - If no policy, delete the timer (no SLA applies)
  - If policy exists, update the timer with new targets but **preserve existing elapsed time** (retroactive application per §17.3)
  - Recalculate remaining deadlines from current elapsed

- `getSlaStatus(timer: SlaTimer): { firstResponse: SlaIndicator, resolution: SlaIndicator }`:
  - Returns an object with status for each timer: `'on_track' | 'approaching' | 'breached'`
  - Read `sla_approaching_threshold` from settings (default 75%)
  - Calculate current elapsed time (for running timers, compute live elapsed from paused_at or now)

### 4. SLA Integration with Ticket Actions

Update `src/lib/actions/tickets.ts` — `createTicket`:
- After inserting the ticket: call `initializeSlaTimer(ticketId, 'medium')` (severity defaults to medium)

Update `src/lib/actions/agent.ts`:

- `changeTicketStatus`:
  - When changing to **pending**: call `pauseSlaTimer(ticketId)`
  - When changing from **pending** to **open**: call `resumeSlaTimer(ticketId)`
  - When changing to **closed**: call `stopResolutionTimer(ticketId)`
  - When re-opening (closed → open): call `resumeSlaTimer(ticketId)` (resolution timer resumes, §17.3)

- `changeSeverity`:
  - After updating severity: call `recalculateSlaTargets(ticketId, newSeverity)`

Update `src/lib/actions/tickets.ts` — `replyToTicket`:
- When an agent posts a reply: check if this is the first agent reply on the ticket. If yes, call `stopFirstResponseTimer(ticketId)`.
- When a user reply auto-transitions pending → open: call `resumeSlaTimer(ticketId)`
- When a user reply auto-transitions closed → open: call `resumeSlaTimer(ticketId)`

### 5. SLA Breach/Approaching Check Endpoint

**`src/app/api/cron/sla/route.ts`** (new API route):
- Verify the cron secret from the request header
- Query `sla_timers` for active (non-paused, non-completed) timers
- For each timer:
  - Calculate current elapsed business minutes
  - Read the approaching threshold from `app_settings`
  - Check if first_response or resolution is approaching or breached
  - For each alert condition not yet notified (check `sla_notifications_sent`):
    - Send notification to assigned agent (if any) via `notifyAgent()`
    - Send notification to **all admins** (§17.5) — query `profiles` for admin role
    - Insert into `sla_notifications_sent` to avoid duplicate notifications
- Return 200 OK

### 6. SLA Indicators on Ticket Detail

Update `src/app/(main)/tickets/[id]/[slug]/page.tsx`:

- For agents: show SLA status in the ticket metadata/sidebar:
  - **First Response SLA:** status indicator (green/yellow/red circle) + "X of Y hours elapsed" + deadline timestamp
  - **Resolution SLA:** same indicator pattern
  - If first response already met: show "✓ First response in X hours" (green)
  - If resolution met: show "✓ Resolved in X hours" (green)
  - If no SLA policy applies: show "No SLA" in muted text
- For regular users: SLA indicators are NOT shown

### 7. SLA Indicators on Agent Dashboard

Update `src/app/(main)/agent/page.tsx`:

- Add SLA status column to the ticket list:
  - Show the most critical SLA indicator (breached > approaching > on_track) as a colored dot
  - Hover/tooltip shows details of both timers
- Add **"Sort by SLA risk"** option to the sort controls:
  - Breached tickets first, then approaching, then on-track, then no-SLA
  - Within each group, sort by remaining time (least time remaining first)

### 8. Agent Personal Stats — SLA Compliance

Update the "My Stats" panel on the agent dashboard (created in Phase 4):
- Add **SLA compliance rate**: percentage of the agent's assigned tickets that met SLA targets in the last 30 days
- Calculate from `sla_timers` where the ticket's `assigned_agent_id` matches the current agent

### 9. Admin SLA Configuration Section

Add a new section to the Admin Setup sidebar: **"SLA Policies"** (route: `/admin/sla`).

**`src/app/(main)/admin/sla/page.tsx`**:

- **SLA Policies list:**
  - List all policies with name, first response time, resolution time
  - Create new policy form: name, first response (hours/minutes input), resolution (hours/minutes input)
  - Edit policy: inline or modal form
  - Delete policy: confirmation prompt; if mapped to a severity, warn that tickets with that severity will lose SLA tracking

- **Severity Mapping:**
  - Table with one row per severity level (Low, Medium, High, Critical)
  - Each row has a dropdown to select an SLA policy (or "None")
  - Save button

- **Business Hours:**
  - Timezone selector (standard timezone list)
  - Weekly schedule: for each day (Monday–Sunday), enable/disable toggle + start time + end time
  - Default: Monday–Friday 09:00–17:00, Saturday/Sunday disabled

- **SLA Approaching Threshold:**
  - Numeric input: 50–95%, default 75%
  - Help text: "Notifications are sent when this percentage of the SLA target time has elapsed"

- Save all settings button + success/error feedback
- Log all changes to `admin_audit_log`

**Server Actions** (add to `src/lib/actions/admin.ts`):
- `createSlaPolicy(name, firstResponseMinutes, resolutionMinutes)` — require admin, validate, insert, log audit
- `updateSlaPolicy(policyId, name, firstResponseMinutes, resolutionMinutes)` — require admin, validate, update, log audit
- `deleteSlaPolicy(policyId)` — require admin, attempt delete, log audit
- `updateSlaSeverityMapping(mappings: Record<string, string | null>)` — require admin, update all mappings, log audit
- `updateBusinessHours(config: BusinessHoursConfig)` — require admin, validate, update `app_settings`, log audit
- `updateSlaThreshold(threshold: number)` — require admin, validate 50–95, update `app_settings`, log audit

### 10. Seed Data

Extend `supabase/seed.sql` per `docs/seed-data.md`:

- **1 SLA policy**: e.g., "Standard SLA" with first_response = 240 minutes (4h), resolution = 1440 minutes (24h)
- **Severity mapping**: Critical → Standard SLA, High → Standard SLA (Low and Medium unmapped for contrast)
- **Override severity** on 3 existing tickets to exercise SLA visibility:
  - Ticket 1: severity = 'critical'
  - Ticket 3: severity = 'high'
  - Ticket 5: severity = 'critical'

### 11. Tests

**`tests/db/012-sla.test.ts`** (new file):
- SLA policy CRUD (admin only, RLS)
- Severity mapping links severity to policy
- SLA timer created when ticket is created (if severity is mapped)
- No timer created for unmapped severity
- Timer pauses when ticket goes pending
- Timer resumes when ticket returns to open
- First response timer stops on first agent reply
- Resolution timer stops when ticket is closed
- Timer resumes on re-open (does not reset, §17.3)
- Severity change recalculates SLA targets with existing elapsed time
- SLA notifications sent dedup prevents duplicate notifications
- Timer CASCADE deletes with ticket
- Business hours calculation: simple case (within same day)
- Business hours calculation: spanning weekends
- Business hours calculation: outside working hours start

**`tests/e2e/sla.spec.ts`** (new file):
- SLA indicators appear on ticket detail for agents
- SLA indicators NOT shown for regular users
- SLA status column on agent dashboard
- Sort by SLA risk on dashboard
- Admin SLA settings: create/edit/delete policy
- Admin SLA settings: map severity to policy
- Admin SLA settings: configure business hours
- Admin SLA settings: change approaching threshold
- Agent stats panel shows SLA compliance rate
- Ticket severity change updates SLA indicator

## Implementation Notes

- **Business hours are critical:** The business hours calculator is the core of SLA accuracy. Implement it carefully with proper timezone handling (`Intl.DateTimeFormat` or a lightweight library). All SLA times are in **business minutes** — calendar time outside business hours does not count.
- **Retroactive severity change:** When severity changes, new SLA targets apply against already-elapsed time (§17.3). If a ticket has been open for 3 business hours and the severity changes to Critical (1h response target), the ticket is immediately breached.
- **Timer lifecycle:** Create → Pause (pending) → Resume (open) → Stop (closed) → Resume (re-open) → Stop (closed again). The resolution timer accumulates; it never resets.
- **Cron frequency:** The 5-minute cron interval means approaching/breached notifications may have up to 5 minutes latency. This is acceptable per the architecture.
- **No SLA on duplicates/merged:** SLA timers are frozen when a ticket is marked as duplicate or merged. Phase 17 handles this.

## Deferred Features (Added by Later Phases)

- SLA timer freezing on duplicate/merge — Phase 17
- Merge severity inheritance and SLA recalculation — Phase 17
- SLA compliance in full reporting dashboard — Phase 14
- Tier-based SLA overrides — not in scope (but the architecture supports future extension)

## Verification Checklist

- [ ] SLA policy CRUD works in admin section
- [ ] Severity mapping correctly links severity to policy
- [ ] Business hours schedule configurable with timezone
- [ ] Approaching threshold configurable (50–95%)
- [ ] SLA timer auto-created on ticket creation (when severity is mapped)
- [ ] Timer pauses on pending, resumes on open
- [ ] First response timer stops on first agent reply
- [ ] Resolution timer stops on close, resumes on re-open
- [ ] Severity change recalculates targets retroactively
- [ ] SLA indicators show on ticket detail (agents only)
- [ ] SLA column on agent dashboard with colored dots
- [ ] Sort by SLA risk works on dashboard
- [ ] Approaching notification sent at threshold %
- [ ] Breach notification sent when target exceeded
- [ ] Notifications sent to assigned agent + all admins
- [ ] No duplicate notifications (dedup table)
- [ ] Agent stats panel includes SLA compliance rate
- [ ] Seed data: 1 policy, severity mappings, 3 tickets with overridden severity
- [ ] `npm run test:db` passes SLA tests
- [ ] `npm run test:e2e` passes SLA e2e tests
