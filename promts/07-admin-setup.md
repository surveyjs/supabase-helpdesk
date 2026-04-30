# Phase 7 — Admin Setup (Core)

## Context

You are building the Admin Setup page for a **HelpDesk** application. Read `docs/requirements.md` sections 16.1–16.14, 16.24, 16.26, and `docs/design.md`.

Phases 0–6 are complete: project init, database schema, authentication, ticket CRUD, agent dashboard, teams/types/categories/tags (with standalone admin pages), and full post interaction layer. Phase 5 created standalone admin pages at `/admin/types`, `/admin/categories`, `/admin/tags`, `/admin/teams`. This phase consolidates them into a sidebar-based Admin Setup layout and adds several new configuration sections.

## Tasks

### 1. Migration: `supabase/migrations/005_admin.sql`

#### Admin Audit Log Table

```sql
CREATE TABLE admin_audit_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_id UUID NOT NULL REFERENCES profiles(id),
  action TEXT NOT NULL,
  target_type TEXT NOT NULL,
  target_id TEXT,
  details JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_admin_audit_log_created_at ON admin_audit_log (created_at DESC);
CREATE INDEX idx_admin_audit_log_action ON admin_audit_log (action);
CREATE INDEX idx_admin_audit_log_admin_id ON admin_audit_log (admin_id);

ALTER TABLE admin_audit_log ENABLE ROW LEVEL SECURITY;

-- Only admins can read audit log
CREATE POLICY admin_audit_log_select ON admin_audit_log
  FOR SELECT USING (is_admin());

-- Only admins can insert (via Server Actions)
CREATE POLICY admin_audit_log_insert ON admin_audit_log
  FOR INSERT WITH CHECK (is_admin());
```

#### Custom Fields Table

```sql
CREATE TABLE custom_fields (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL UNIQUE,
  field_type TEXT NOT NULL CHECK (field_type IN ('text', 'number', 'dropdown', 'checkbox', 'date')),
  is_required BOOLEAN NOT NULL DEFAULT false,
  default_value TEXT,
  options JSONB, -- for dropdown: array of allowed values
  display_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE custom_fields ENABLE ROW LEVEL SECURITY;

-- All authenticated users can read custom fields (needed for forms)
CREATE POLICY custom_fields_select ON custom_fields
  FOR SELECT USING (auth.uid() IS NOT NULL);

-- Only admins can manage
CREATE POLICY custom_fields_insert ON custom_fields
  FOR INSERT WITH CHECK (is_admin());
CREATE POLICY custom_fields_update ON custom_fields
  FOR UPDATE USING (is_admin());
CREATE POLICY custom_fields_delete ON custom_fields
  FOR DELETE USING (is_admin());
```

#### Notification Templates Table

```sql
CREATE TABLE notification_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_type TEXT NOT NULL UNIQUE,
  subject TEXT NOT NULL DEFAULT '',
  body TEXT NOT NULL DEFAULT '',
  is_customized BOOLEAN NOT NULL DEFAULT false,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE notification_templates ENABLE ROW LEVEL SECURITY;

CREATE POLICY notification_templates_select ON notification_templates
  FOR SELECT USING (is_admin());
CREATE POLICY notification_templates_update ON notification_templates
  FOR UPDATE USING (is_admin());
```

Seed default notification templates for events that exist at this point:
- `new_post` — "New reply on your ticket"
- `status_changed` — "Ticket status updated"
- `agent_assigned` — "Agent assigned to your ticket"
- `agent_assigned_to_agent` — "You've been assigned a ticket"
- `user_reply_to_agent` — "New reply on your assigned ticket"
- `auto_reopen` — "Ticket re-opened by user reply"
- `duplicate_post` — "Ticket marked as duplicate" (the configurable template from §16.5)
- `merge_post` — "Ticket merged" (the configurable template from §16.17)
- `merge_banner` — "Merge stub banner" (the configurable template from §16.22)

Each template has default subject and body text with `{{placeholder}}` syntax.

#### Additional App Settings

Insert any missing `app_settings` rows:

```sql
INSERT INTO app_settings (key, value) VALUES
  ('visible_posts_threshold', '10'),
  ('visible_comments_threshold', '3'),
  ('user_page_size', '20'),
  ('other_lists_page_size', '20'),
  ('enforce_display_name_uniqueness', 'false')
ON CONFLICT (key) DO NOTHING;
```

### 2. Admin Layout

**`src/app/(main)/admin/layout.tsx`**:
- Require admin role (redirect non-admins)
- Two-column layout:
  - **Left sidebar** (fixed width ~250px): list of section links, styled as a vertical nav
  - **Right content area**: renders the child route
- Sidebar sections (in order):
  1. Ticket Types (`/admin/types`)
  2. Categories (`/admin/categories`)
  3. Tags (`/admin/tags`)
  4. Teams (`/admin/teams`)
  5. Agents & Admins (`/admin/agents`)
  6. Custom Fields (`/admin/custom-fields`)
  7. Ticket Privacy (`/admin/privacy`)
  8. Pagination (`/admin/pagination`)
  9. Rate Limit (`/admin/rate-limit`)
  10. Templates (`/admin/templates`)
  11. User Settings (`/admin/user-settings`)
  12. Audit Log (`/admin/audit-log`)
- Active section highlighted in sidebar
- The sidebar is a Server Component using the current route path to determine the active item

**Important Change:** The flat sidebar list above has been reorganized into 8 task-oriented groups with section headings and a client-side filter input. The sidebar is now a Client Component (`'use client'`) to support the filter state. See `promts/changes/admin-sidebar-grouping.md` for the full grouping, UI spec, and acceptance criteria. All routes listed above remain valid; only their visual organization changed.

**`src/app/(main)/admin/page.tsx`**:
- Redirect to `/admin/types` (first section)

### 3. Consolidate Existing Admin Pages

Move the Phase 5 standalone admin pages into the sidebar layout:

- `src/app/(main)/admin/types/page.tsx` — keep existing, already at correct path
- `src/app/(main)/admin/categories/page.tsx` — keep existing
- `src/app/(main)/admin/tags/page.tsx` — keep existing
- `src/app/(main)/admin/teams/page.tsx` — keep existing

Remove the admin role check from each individual page (the layout handles it now).

### 4. Agent & Admin Management (§16.6)

**`src/app/(main)/admin/agents/page.tsx`**:
- List all agents and admins with display name, email, and role badge
- For each agent: "Demote to User" button
- For each admin: "Demote to Agent" button
- **Last admin guard**: if only one admin exists, the "Demote" button is disabled with tooltip "Cannot remove the last admin"
- Search user by email form: find any user, show their current role, offer "Promote to Agent" or "Promote to Admin" button
- All changes are immediate and logged to admin audit log

**Server Actions** (add to `src/lib/actions/admin.ts`):
- `promoteToAgent(userId)` — require admin, update role to 'agent', log to audit log, revalidate
- `promoteToAdmin(userId)` — require admin, update role to 'admin', log to audit log, revalidate
- `demoteToAgent(userId)` — require admin, check not last admin (count admins in profiles), update role to 'agent', log, revalidate
- `demoteToUser(userId)` — require admin, check not last admin if user is admin, update role to 'user', log, revalidate

### 5. Custom Fields Management (§16.14)

**`src/app/(main)/admin/custom-fields/page.tsx`**:
- List all custom fields ordered by `display_order`
- Each field shows: name, type, required flag, default value, options (for dropdowns)
- CRUD forms:
  - Create: name, type selector, required checkbox, default value (required if field is required), options list (for dropdown type)
  - Edit: same fields (name + type + required + default + options)
  - Reorder: up/down buttons to adjust `display_order`
  - Delete: confirmation prompt, removes field values from all tickets

**Server Actions** (add to `src/lib/actions/admin.ts`):
- `createCustomField(data)` — require admin, validate (name unique, if required then default_value must be set, dropdown must have options), insert, log audit, revalidate
- `updateCustomField(fieldId, data)` — require admin, validate, update, log audit, revalidate
- `deleteCustomField(fieldId)` — require admin, remove field key from all tickets' `custom_fields` JSONB, delete field, log audit, revalidate
- `reorderCustomField(fieldId, direction)` — require admin, swap display_order with adjacent field, revalidate

### 6. Custom Fields on Ticket Forms

Update ticket creation form (`src/app/(main)/tickets/new/page.tsx`):
- Fetch custom field definitions
- Render custom fields after standard fields:
  - `text` → `<input type="text">` (max 1,000 chars)
  - `number` → `<input type="number">`
  - `dropdown` → `<select>` with options
  - `checkbox` → `<input type="checkbox">`
  - `date` → `<input type="date">`
- Required fields show asterisk and validate on submit
- Default values are pre-filled

Update ticket detail page (`src/app/(main)/tickets/[id]/[slug]/page.tsx`):
- Display custom field values in the metadata section
- Editable by ticket owner and agents (inline edit forms)

Update `src/lib/actions/tickets.ts`:
- `createTicket` — extract custom field values from formData, validate against definitions (type, required, dropdown options), store in `tickets.custom_fields` JSONB
- New action `updateCustomFieldValue(ticketId, fieldName, value)` — validate the user is owner or agent, validate value against field definition, update the JSONB, log change in `activity_log`, revalidate

### 7. Ticket Privacy Settings (§16.10)

**`src/app/(main)/admin/privacy/page.tsx`**:
- Three settings, each as a toggle or dropdown:
  1. **Default ticket privacy** — radio: "Private by default" / "Public by default" (reads/writes `app_settings.ticket_default_privacy`)
  2. **Allow users to change privacy** — toggle (reads/writes `app_settings.allow_user_privacy_control`)
  3. **Allow public access for unauthenticated visitors** — toggle (reads/writes `app_settings.allow_public_ticket_browsing`)
- "Save" button for all three settings
- Log changes to admin audit log

**Server Actions** (add to `src/lib/actions/admin.ts`):
- `updatePrivacySettings(settings)` — require admin, validate, update `app_settings`, log audit, revalidate

### 8. Pagination Settings (§16.11)

**`src/app/(main)/admin/pagination/page.tsx`**:
- Five numeric inputs:
  1. User ticket list page size (min 5, max 100, default 20)
  2. Agent dashboard page size (min 5, max 100, default 20)
  3. Other lists page size (min 5, max 100, default 20)
  4. Visible posts threshold (min 3, max 50, default 10)
  5. Visible comments threshold (min 1, max 20, default 3)
- "Save" button
- Log changes to admin audit log

**Server Actions** (add to `src/lib/actions/admin.ts`):
- `updatePaginationSettings(settings)` — require admin, validate ranges, update `app_settings`, log audit, revalidate

### 9. Ticket Creation Rate Limit (§16.12)

**`src/app/(main)/admin/rate-limit/page.tsx`**:
- Single numeric input: tickets per 24 hours (0 = unlimited, default 10)
- "Save" button
- Log change to admin audit log

### 10. Notification Templates (§16.8 — subset)

**`src/app/(main)/admin/templates/page.tsx`**:
- List all notification templates (seeded in migration)
- Click to expand/edit: subject field, body textarea (Markdown with placeholder syntax)
- "Save" and "Reset to Default" buttons per template
- Show available placeholders for each template type
- Preview rendered template (optional, nice-to-have)

**Server Actions** (add to `src/lib/actions/admin.ts`):
- `updateNotificationTemplate(eventType, subject, body)` — require admin, update, set `is_customized = true`, log audit, revalidate
- `resetNotificationTemplate(eventType)` — require admin, restore default subject/body, set `is_customized = false`, log audit, revalidate

Note: the `duplicate_post` template (used when a ticket is marked as a duplicate, supporting the `{{ticketId}}` placeholder) is edited inline alongside the other templates on this page — it does not have a dedicated route.

### 11. User Settings Defaults (§16.26)

**`src/app/(main)/admin/user-settings/page.tsx`**:
- **Display name uniqueness** toggle (reads/writes `app_settings.enforce_display_name_uniqueness`)
- **Default notification preferences** table (for now, show a placeholder table: "Notification preferences will be configurable after email notifications are implemented in Phase 9". The actual data model for user preferences is built in Phase 9.)
- Log changes to admin audit log

### 12. Admin Audit Log (§16.24)

**`src/app/(main)/admin/audit-log/page.tsx`**:
- Paginated list of admin audit log entries, newest first
- Each entry: admin display name, timestamp, action type, description (rendered from `details` JSONB)
- Filter by:
  - Action type (dropdown)
  - Admin (dropdown of all admins)
  - Date range (start/end date inputs)
- Filters are URL-based

### 13. Audit Log Integration

Update all existing admin Server Actions (from Phase 5 and this phase) to log to `admin_audit_log`:
- Ticket type CRUD + default change
- Category CRUD
- Tag CRUD + color change
- Team CRUD + member changes
- Agent/admin promotions and demotions
- Custom field CRUD + reorder
- Privacy settings changes
- Pagination settings changes
- Rate limit changes
- Template edits and resets
- User settings changes

Each audit log entry includes:
- `admin_id`: current user's profile ID
- `action`: e.g., `'create_tag'`, `'promote_to_agent'`, `'update_privacy_settings'`
- `target_type`: e.g., `'tag'`, `'user'`, `'app_settings'`
- `target_id`: the ID of the affected entity (optional)
- `details`: JSONB with old/new values where applicable

### 14. NavBar Update

Update `src/components/layout/NavBar.tsx`:
- Change the "Setup" link (added in Phase 5) to point to `/admin` (which redirects to `/admin/types`). The "Setup" link is inside the user menu dropdown as the first item for admins.

### 15. Tests

**`tests/db/007-admin.test.ts`** (new file):
- Admin audit log: admin can insert and read entries
- Non-admin cannot read audit log (RLS)
- Custom fields: admin can CRUD
- Custom fields: non-admin can read but not write (RLS)
- Custom field on ticket: custom_fields JSONB stores and retrieves correctly
- Notification templates: admin can read and update
- Non-admin cannot read notification templates (RLS)

## Change Update — Survey UI Config Tab

Add an additional admin section:
- Sidebar item: `Survey UI Config`
- Route: `/admin/survey-ui`

This section stores and edits three JSON settings in `app_settings` using SurveyJS forms:
- `survey_agent_dashboard_config`
- `survey_ticket_detail_agent_config`
- `survey_ticket_detail_user_config`

Guidelines:
- Save/reset actions must be admin-only and audit-logged.
- Stored JSON must be validated and normalized before persistence.
- Changes should revalidate affected pages (`/admin/survey-ui`, `/agent`, ticket detail pages as needed).
- Agent/admin management: promote user to agent, demote back
- Last admin guard: cannot demote the only admin
- App settings: admin can update privacy, pagination, rate limit settings

**`tests/e2e/admin-setup.spec.ts`** (new file):
- Admin can access Setup page, sees sidebar
- Non-admin gets redirected from `/admin`
- Agent management: promote a user to agent, verify they see Agent Dashboard link
- Agent management: demote agent to user
- Custom fields: create text, dropdown, and checkbox fields
- Custom fields: verify fields appear on ticket creation form
- Custom field values: create ticket with custom fields, verify values on detail page
- Privacy settings: toggle and verify behavior
- Pagination settings: change page size, verify ticket list respects it
- Rate limit: change limit value
- Templates: edit a template, reset to default
- Audit log: entries appear for all admin actions
- Audit log: filter by action type and admin

## Implementation Notes

- All admin pages are Server Components with `<form>` + Server Actions
- The admin layout sidebar is a `'use client'` `<nav>` with `<Link>` elements, organized into grouped `<section>`s with a filter input (see `promts/changes/admin-sidebar-grouping.md`)
- Audit log formatting: create a helper function that converts `action` + `details` JSONB into a human-readable description (e.g., "Created tag 'urgent' with color #EF4444")
- Custom fields JSONB storage: the `tickets.custom_fields` column stores `{ "fieldName": value }`. When a custom field is renamed, update all existing tickets' JSONB keys to match. When deleted, remove the key from all tickets.
- For the notification templates, store defaults in code (a constants file) so they can be reset. The DB stores only customized versions.
- Phase 7 creates the template infrastructure. Later phases (9, 11, 12, 17) add their own templates.

## Deferred Features (Added by Later Phases)

- Email configuration (SMTP) — Phase 9
- Inbound email configuration — Phase 18
- CSAT settings — Phase 11
- SLA configuration — Phase 12
- KB categories — Phase 13
- Auth configuration — Phase 21
- File upload settings — Phase 8
- Subscription tiers — Phase 20
- AI configuration — Phase 19
- Notification coalescing delay — Phase 9
- Merge stub banner template — Phase 17
- Error page templates — Phase 22
- Logo & URL configuration — Phase 22
- User management (block/unblock/delete) — Phase 15

## Verification Checklist

- [ ] Admin Setup page accessible with sidebar navigation
- [ ] Non-admins redirected from all `/admin/*` routes
- [ ] Ticket types, categories, tags, teams pages work within sidebar layout
- [ ] Agent/admin promotion and demotion works
- [ ] Last admin cannot be demoted
- [ ] Custom fields: full CRUD with all field types
- [ ] Custom fields display on ticket creation and detail pages
- [ ] Privacy settings toggles work correctly
- [ ] Pagination settings respected by ticket lists
- [ ] Rate limit setting works
- [ ] Notification templates editable with reset-to-default
- [ ] Duplicate ticket template configurable
- [ ] User settings (display name uniqueness) toggle works
- [ ] Audit log captures all admin actions
- [ ] Audit log filters work (action type, admin, date range)
- [ ] `npm run typecheck` passes with no errors
- [ ] `npm run lint` passes with no errors
- [ ] `npm run test:db` passes admin tests
- [ ] `npm run test:e2e` passes admin setup e2e tests
