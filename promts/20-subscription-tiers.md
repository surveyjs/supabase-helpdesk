# Phase 20 — Subscription Tiers

## Context

You are building subscription tiers — tier definitions, capability overrides, per-tier limits, tier display, tier assignment, and an external assignment API — for a **HelpDesk** application. Read `docs/requirements.md` sections 25.1–25.11, 16.28, and `docs/architecture.md` constraints 1, 3, 5, 9.

Phases 0–19 are complete: project init, database schema, authentication, tickets, agent dashboard, taxonomy, posts/comments/notes, admin setup, file attachments, email notifications, real-time/in-app notifications, CSAT ratings, SLA policies, knowledge base, reporting, user profile/account management, canned responses/follow/custom fields, advanced ticket operations, inbound email, and AI features.

This phase adds subscription tier definitions, capability overrides that grant ticket owners agent-like permissions on their own tickets, per-tier limits, tier display pills throughout the UI, admin and API-based tier assignment, tier filtering on the agent dashboard, and tier as a reporting dimension.

### Existing Infrastructure

- **Profiles table** (`profiles`): `id`, `display_name`, `email`, `role`, `team_id`, `is_blocked`. This phase adds a `tier_id` and `tier_expires_at` to profiles (or uses a separate join table).
- **Agent dashboard VIEW** (`agent_tickets`): joins tickets with profile emails and post counts. This phase extends it to include tier data (architecture constraint 5).
- **RLS helper functions**: `is_agent()`, `is_admin()`, `is_teammate()`. This phase adds `user_has_tier_capability(capability text)`.
- **App settings table** (`app_settings`): stores `ticket_creation_rate_limit` (global default), file upload limits.
- **Admin setup page** at `/admin` with sidebar sections. This phase adds "Subscription Tiers" section.
- **Ticket creation rate limit**: enforced in `src/lib/actions/tickets.ts` `createTicket()`. This phase extends it to check tier override.
- **File upload limits**: enforced in `src/lib/actions/attachments.ts`. This phase extends to check tier overrides.
- **Agent dashboard queries**: `src/lib/queries/agent-dashboard.ts`. This phase adds tier filter and tier display.
- **Reporting queries**: `src/lib/queries/reports.ts`. This phase adds tier as a filter dimension.
- **User profile page**: `src/app/(main)/profile/page.tsx` and agent-viewable profile at `/admin/users/[userId]`.
- **Supabase Vault** — for encrypting the external API shared secret (same approach as AI API keys).
- **Admin audit log** (`admin_audit_log`) — for logging tier changes.
- **Seed data** (`docs/seed-data.md`): 3 tiers (free, licensed, enterprise) with specific capability overrides and assignments.

## Tasks

### 1. Migration: `supabase/migrations/018_subscription_tiers.sql`

```sql
-- ============================================================
-- Phase 20 — Subscription Tiers
-- ============================================================

-- Tier definitions
CREATE TABLE subscription_tiers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  key TEXT NOT NULL UNIQUE CHECK (
    char_length(key) BETWEEN 1 AND 50
    AND key ~ '^[a-z0-9](-?[a-z0-9])*$'
  ),
  display_name TEXT NOT NULL CHECK (char_length(display_name) <= 100),
  color TEXT NOT NULL DEFAULT 'gray',
  icon TEXT DEFAULT NULL,  -- emoji
  sort_order INTEGER NOT NULL DEFAULT 0,
  -- Capability overrides (each boolean, default false)
  cap_change_visibility BOOLEAN NOT NULL DEFAULT false,
  cap_set_severity BOOLEAN NOT NULL DEFAULT false,
  cap_change_status BOOLEAN NOT NULL DEFAULT false,
  cap_change_type BOOLEAN NOT NULL DEFAULT false,
  cap_add_remove_tags BOOLEAN NOT NULL DEFAULT false,
  -- Per-tier limit overrides (null = use global default)
  limit_ticket_rate INTEGER DEFAULT NULL,         -- tickets per 24h
  limit_max_file_size INTEGER DEFAULT NULL,       -- bytes (max 50MB = 52428800)
  limit_max_files_per_post INTEGER DEFAULT NULL,  -- max 20
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE subscription_tiers ENABLE ROW LEVEL SECURITY;

-- Everyone can read tier definitions (needed for display pills)
CREATE POLICY subscription_tiers_select ON subscription_tiers
  FOR SELECT USING (true);

-- Only admins can manage tiers
CREATE POLICY subscription_tiers_insert ON subscription_tiers
  FOR INSERT WITH CHECK (is_admin());
CREATE POLICY subscription_tiers_update ON subscription_tiers
  FOR UPDATE USING (is_admin());
CREATE POLICY subscription_tiers_delete ON subscription_tiers
  FOR DELETE USING (is_admin());

-- User tier assignments (on profiles table)
ALTER TABLE profiles
  ADD COLUMN tier_id UUID REFERENCES subscription_tiers(id) ON DELETE SET NULL,
  ADD COLUMN tier_expires_at TIMESTAMPTZ DEFAULT NULL;

CREATE INDEX idx_profiles_tier_id ON profiles (tier_id);

-- Helper function: check if current user has a specific tier capability
-- Capability is checked as: user has active (non-expired) tier + tier has the capability enabled
CREATE OR REPLACE FUNCTION user_has_tier_capability(capability text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
AS $$
DECLARE
  v_tier_id UUID;
  v_expires_at TIMESTAMPTZ;
  v_has_cap BOOLEAN;
BEGIN
  -- Get the current user's tier
  SELECT tier_id, tier_expires_at INTO v_tier_id, v_expires_at
  FROM profiles
  WHERE id = auth.uid();

  -- No tier assigned
  IF v_tier_id IS NULL THEN
    RETURN false;
  END IF;

  -- Tier expired
  IF v_expires_at IS NOT NULL AND v_expires_at < now() THEN
    RETURN false;
  END IF;

  -- Check the specific capability
  EXECUTE format(
    'SELECT cap_%s FROM subscription_tiers WHERE id = $1',
    capability
  ) INTO v_has_cap USING v_tier_id;

  RETURN COALESCE(v_has_cap, false);
END;
$$;

-- Update agent_tickets VIEW to include tier data
-- (Drop and recreate — the VIEW already exists from Phase 1)
CREATE OR REPLACE VIEW agent_tickets AS
SELECT
  t.id,
  t.title,
  t.slug,
  t.status,
  t.urgency,
  t.severity,
  t.is_private,
  t.type_id,
  t.category_id,
  t.creator_id,
  t.assigned_agent_id,
  t.duplicate_of_id,
  t.merged_into_id,
  t.custom_fields,
  t.search_vector,
  t.created_at,
  t.updated_at,
  p.display_name AS creator_display_name,
  p.email AS creator_email,
  p.is_blocked AS creator_is_blocked,
  p.tier_id AS creator_tier_id,
  st.key AS creator_tier_key,
  st.display_name AS creator_tier_display_name,
  st.color AS creator_tier_color,
  st.icon AS creator_tier_icon,
  CASE
    WHEN p.tier_id IS NULL THEN false
    WHEN p.tier_expires_at IS NOT NULL AND p.tier_expires_at < now() THEN false
    ELSE true
  END AS creator_tier_active,
  ap.display_name AS assigned_agent_display_name,
  (SELECT count(*) FROM posts WHERE posts.ticket_id = t.id AND posts.post_type = 'post') AS post_count
FROM tickets t
JOIN profiles p ON p.id = t.creator_id
LEFT JOIN subscription_tiers st ON st.id = p.tier_id
LEFT JOIN profiles ap ON ap.id = t.assigned_agent_id;

-- Extend RLS policies on tickets table for tier capability overrides
-- Users with cap_change_visibility can toggle privacy on their own tickets
-- Users with cap_set_severity can change severity on their own tickets
-- Users with cap_change_status can change status on their own tickets
-- Users with cap_change_type can change type on their own tickets
-- Users with cap_add_remove_tags can manage tags on their own tickets
-- (These are applied by extending existing UPDATE policies or adding new ones)

-- Note: The specific RLS policy extensions depend on the current policy structure.
-- The implementation should update existing policies to include:
--   OR (auth.uid() = creator_id AND user_has_tier_capability('relevant_cap'))
-- alongside the existing is_agent() checks.

-- External API shared secret stored in Supabase Vault (no table needed)
```

> **Important:** The `agent_tickets` VIEW definition above is a template — adjust column lists to match the actual VIEW from earlier migrations. The key additions are the tier-related columns from the `subscription_tiers` join.

### 2. Seed Data Updates

Update `supabase/seed.sql` to add:

```sql
-- 3 subscription tiers
INSERT INTO subscription_tiers (key, display_name, color, icon, sort_order,
  cap_change_visibility, cap_set_severity, cap_change_status, cap_change_type, cap_add_remove_tags,
  limit_ticket_rate, limit_max_file_size, limit_max_files_per_post)
VALUES
  ('free', 'Free', 'gray', NULL, 1,
    false, false, false, false, false,
    NULL, NULL, NULL),
  ('licensed', 'Licensed', 'blue', NULL, 2,
    true, false, false, false, false,
    20, NULL, NULL),
  ('enterprise', 'Enterprise', 'purple', NULL, 3,
    true, true, true, true, true,
    50, 26214400, NULL);  -- 25MB max file size

-- Tier assignments
-- Alice → Enterprise (no expiration)
UPDATE profiles SET tier_id = (SELECT id FROM subscription_tiers WHERE key = 'enterprise'), tier_expires_at = NULL
WHERE email = 'alice@example.com';

-- Bob → Licensed (expires 2026-12-31)
UPDATE profiles SET tier_id = (SELECT id FROM subscription_tiers WHERE key = 'licensed'), tier_expires_at = '2026-12-31T23:59:59Z'
WHERE email = 'bob@example.com';

-- Dave → Licensed (expired 2026-01-01)
UPDATE profiles SET tier_id = (SELECT id FROM subscription_tiers WHERE key = 'licensed'), tier_expires_at = '2026-01-01T00:00:00Z'
WHERE email = 'dave@example.com';

-- Carol, Eve → no tier (default)
```

### 3. Server Actions: Tier Management (Admin)

**`src/lib/actions/tiers.ts`** (new file):

- `createTier(formData: FormData)`:
  - Require admin role
  - Extract: key (validated: unique, 1–50 chars, `^[a-z0-9](-?[a-z0-9])*$`), display_name, color, icon, capability overrides (booleans), limit overrides (integers or null)
  - Insert into `subscription_tiers` with next `sort_order`
  - Log in `admin_audit_log`: action `'tier_created'`, details with tier key
  - Revalidate

- `updateTier(formData: FormData)`:
  - Require admin role
  - Extract: `tier_id`, display_name, color, icon, capability overrides, limit overrides
  - **Key is read-only** — not accepted in the update
  - Validate limit values: `limit_max_file_size` ≤ 52428800 (50MB), `limit_max_files_per_post` ≤ 20
  - Update the tier, set `updated_at = now()`
  - Log in `admin_audit_log`
  - Revalidate

- `deleteTier(formData: FormData)`:
  - Require admin role
  - Extract: `tier_id`
  - Count users currently assigned to this tier
  - Delete the tier (cascading: `ON DELETE SET NULL` on `profiles.tier_id` removes assignments)
  - Log in `admin_audit_log`: action `'tier_deleted'`, details with tier key and affected user count
  - Revalidate

- `reorderTiers(formData: FormData)`:
  - Require admin role
  - Extract: `tier_ids` (JSON array of UUIDs in desired order)
  - Update `sort_order` for each tier
  - Revalidate

- `assignTier(formData: FormData)`:
  - Require admin role
  - Extract: `user_id`, `tier_id` (UUID or `'none'`), `expires_at` (ISO string or null)
  - If `tier_id = 'none'`: set profile's `tier_id = NULL`, `tier_expires_at = NULL`
  - Otherwise: validate tier exists, update profile's `tier_id` and `tier_expires_at`
  - Log in `admin_audit_log`: action `'tier_assigned'` or `'tier_removed'`, details with tier key (using key for unambiguous identification)
  - Revalidate

### 4. Server Actions: External Tier Assignment API (§25.7)

**`src/lib/actions/tier-api.ts`** (new file):

- `externalAssignTier(formData: FormData)`:
  - This is a Server Action callable from an API route
  - Extract: `email` (user email), `tier_key` (string, or `'none'` to remove), `expires_at` (optional ISO string)
  - **Authenticate**: extract shared secret from request header (`X-API-Key`) or form data
    - Retrieve the stored secret from Supabase Vault
    - Compare using constant-time comparison to prevent timing attacks
    - If secret mismatch or not configured → return 401 error
  - Validate: user with given email exists
  - Validate: tier with given key exists (unless `'none'`)
  - Update the user's tier (same logic as `assignTier`)
  - Log in `admin_audit_log`: actor shown as `'API'`
  - Return success with user ID and tier key

**`src/app/api/tiers/assign/route.ts`** (new file):
  - `POST` handler
  - Parse JSON body: `{ email, tierKey, expiresAt? }`
  - Extract `X-API-Key` header
  - Call `externalAssignTier()`
  - Return JSON response with result

### 5. Extend Ticket Creation Rate Limit

Update `src/lib/actions/tickets.ts` `createTicket()`:

- After checking the global `ticket_creation_rate_limit` from `app_settings`:
  - Also check if the user has an active tier with `limit_ticket_rate` override
  - If tier override exists and is non-null, use it instead of the global default
  - Tier check: query user's profile for `tier_id` + `tier_expires_at`, cross-reference with `subscription_tiers.limit_ticket_rate`

### 6. Extend File Upload Limits

Update `src/lib/actions/attachments.ts` `uploadAttachments()`:

- After reading global file upload limits from `app_settings`:
  - Check if the uploading user has an active tier with limit overrides
  - If `limit_max_file_size` is set, use it (but cap at 50MB absolute max)
  - If `limit_max_files_per_post` is set, use it (but cap at 20 absolute max)

### 7. Extend RLS Policies for Tier Capabilities

Update relevant RLS policies on the `tickets` table to include tier capability checks. The pattern for each capability override:

For each capability (change_visibility, set_severity, change_status, change_type, add_remove_tags):
- Find the existing RLS policy that allows agents to perform the action
- Extend the `USING` / `WITH CHECK` clause to also allow:
  ```sql
  OR (
    auth.uid() = creator_id
    AND NOT (SELECT is_blocked FROM profiles WHERE id = auth.uid())
    AND user_has_tier_capability('relevant_cap_name')
  )
  ```

Similarly update RLS policies on `ticket_tags` for the `add_remove_tags` capability.

> **Important:** Blocked users cannot exercise tier capabilities regardless of their tier (§25.8).

### 8. UI: Tier Display Pills

**`src/components/ui/TierBadge.tsx`** (new component):

## Change Update — Tier Rules in Ticket Detail JSON Config

Ticket detail UI now supports additional config-based tier gating via
`app_settings.survey_ticket_detail_user_template` (the
`tierControlRules` object inside the stored template wrapper).

Rules:
- Existing capability checks remain mandatory (`user_has_tier_capability(...)`).
- JSON tier allow-lists are an extra restriction layer for specific controls (status, severity, type, tags, visibility).
- If an allow-list is empty, any tier with the required capability may use the control.
- If an allow-list is non-empty, only listed tier keys may use the control, even if capability is true.

- Props: `tierKey: string`, `displayName: string`, `color: string`, `icon?: string`
- Renders a colored pill (similar to status badges): `[icon] displayName`
- Color maps to Tailwind classes (e.g., gray → `bg-gray-100 text-gray-700`, blue → `bg-blue-100 text-blue-700`, purple → `bg-purple-100 text-purple-700`)

Display the `TierBadge` in:
- **Ticket detail page** — next to the submitter's display name and next to post/comment author names (only if creator has an active tier)
- **Agent dashboard** — in the ticket row, next to the submitter's display name (uses `creator_tier_*` fields from `agent_tickets` VIEW)
- **User profile page** (`/profile`) — the user's own tier display name and expiration date in the profile info section. If expired, show "Expired on {date}" in muted style.
- **Agent-viewable user profile** (`/admin/users/[userId]`) — tier display name, key, and expiration date

### 9. UI: Tier Filter on Agent Dashboard

Update `src/app/(main)/agent/page.tsx` and `src/lib/queries/agent-dashboard.ts`:

- Add a **"Filter by tier"** dropdown to the dashboard filters (URL-driven state, same pattern as existing filters)
- Options: "All", "No tier", and each defined tier's display name
- When a tier is selected, filter `agent_tickets` by `creator_tier_key` (or NULL for "No tier")
- Only show the tier filter dropdown when at least one tier is defined

### 10. UI: Tier on Reporting Dashboard

Update `src/lib/queries/reports.ts` and the reporting page:

- Add **tier** as an available filter dimension on:
  - Ticket volume chart (§18.2)
  - Resolution metrics (§18.3)
  - CSAT summary chart (§18.5)
- The tier filter dropdown appears alongside existing filters (status, severity, type, category)
- Options: "All tiers", "No tier", and each defined tier

### 11. Admin UI: Subscription Tiers Section

Add a new sidebar section to the admin setup page:

**Route**: `/admin/tiers` (add to admin sidebar navigation)

**Tier definitions card:**
- List of all tiers showing: key (read-only), display name, color swatch, icon, capability overrides summary, limit overrides summary, sort order
- **Create** button → form: key (text input, validated), display name, color picker/dropdown, icon (emoji input), capability overrides (checkboxes), limit overrides (numeric inputs or empty for "use global default")
- **Edit** button → same form but key is read-only
- **Reorder** — drag-and-drop or up/down arrows to change `sort_order`
- **Delete** button → confirmation prompt: "This tier is assigned to N user(s). Removing it will revoke their tier capabilities immediately."
- All changes recorded in admin audit log

**External API settings card:**
- **Shared secret** — password input, stored via Supabase Vault
  - If no secret configured: show "No secret configured — external tier assignment is unavailable"
  - If configured: show masked value with "Copy" button
  - **"Regenerate"** button — requires confirmation ("Regenerating will invalidate the previous secret"), creates new secret
  - Secret changes recorded in admin audit log (action type only, not the value)
- **API endpoint** — read-only display of the API URL: `{appUrl}/api/tiers/assign`
- **Usage instructions** — brief inline docs: POST with JSON body `{ email, tierKey, expiresAt? }` and `X-API-Key` header

### 12. Admin UI: Tier Assignment on User Management

Update the admin user management section and agent-viewable user profile:

- **User management table** (`/admin/users`):
  - Add a "Tier" column showing the user's current tier display name (or "—" if none)
  - Clicking the tier opens an inline form: tier dropdown + expiration date picker + save

- **Agent-viewable user profile** (`/admin/users/[userId]`):
  - Show tier info: display name, key, expiration date (if set)
  - For admins: show tier assignment form (tier dropdown + expiration date picker)

### 13. Extend Ticket Detail for Tier Capabilities

Update `src/app/(main)/tickets/[id]/[slug]/page.tsx`:

- For the ticket owner (not just agents), show action controls if the user has the corresponding tier capability:
  - **cap_change_visibility**: show privacy toggle
  - **cap_set_severity**: show severity selector
  - **cap_change_status**: show status selector (open/pending/closed)
  - **cap_change_type**: show type selector
  - **cap_add_remove_tags**: show tag management controls
- Use the `user_has_tier_capability()` function (called from server side) to determine which controls to render
- The existing Server Actions for these operations need their authorization checks updated:
  - Currently check `is_agent()` — extend to also allow if `user.id === ticket.creator_id` AND the user has the relevant tier capability
  - Blocked users are rejected regardless of tier

### 14. Tests

**`tests/db/019-subscription-tiers.test.ts`** (new file):

- **Tier definitions:**
  - Admin can create a tier with valid key
  - Key validation: rejects invalid formats (uppercase, spaces, too long)
  - Admin can update display name, color, capabilities, limits
  - Key is immutable (cannot be updated)
  - Admin can delete a tier — assigned users lose tier (ON DELETE SET NULL)
  - Non-admin cannot create/update/delete tiers (RLS)
  - Everyone can read tier definitions (for display pills)

- **Tier assignment:**
  - Admin can assign tier to a user
  - Admin can set expiration date
  - Admin can remove tier (set to none)
  - `user_has_tier_capability()` returns true for active non-expired tier with enabled capability
  - `user_has_tier_capability()` returns false for expired tier
  - `user_has_tier_capability()` returns false for no tier
  - `user_has_tier_capability()` returns false for blocked user

- **Capability overrides:**
  - User with `cap_change_visibility` can toggle privacy on own ticket (RLS passes)
  - User without the capability cannot toggle privacy (RLS blocks)
  - User cannot toggle privacy on another user's ticket (even with tier capability)
  - All 5 capabilities tested independently
  - Expired tier: capability check rejected

- **Per-tier limits:**
  - User with tier rate limit override uses tier value
  - User without tier uses global default
  - File size and files-per-post overrides work correctly
  - Expired tier: global defaults apply

- **agent_tickets VIEW:**
  - Returns tier data (key, display name, color, icon, active status)
  - Expired tier shows `creator_tier_active = false`
  - User with no tier shows NULL tier fields

- **External API:**
  - Valid secret + valid request → tier assigned
  - Invalid secret → rejected
  - Unknown email → error
  - Unknown tier key → error
  - `'none'` tier key → tier removed

**`tests/e2e/subscription-tiers.spec.ts`** (new file):

- **Admin tier management:**
  - Admin can navigate to `/admin/tiers`
  - Create a new tier with key, display name, color, capabilities
  - Edit tier (cannot change key)
  - Delete tier with confirmation
  - Reorder tiers

- **Tier assignment:**
  - Admin can assign tier from user management page
  - Admin can assign tier from agent-viewable user profile
  - Admin can set and clear expiration date
  - Admin can remove tier

- **Tier display:**
  - Tier pill shown next to user names on ticket detail
  - Tier pill shown on agent dashboard
  - Tier info shown on user profile
  - Expired tier not displayed (no pill)
  - User with no tier has no pill

- **Capability overrides:**
  - User with cap_change_visibility sees privacy toggle on own ticket
  - User without capability does not see the toggle
  - User cannot use capability on other users' tickets
  - All 5 capabilities tested via UI
  - Expired tier: controls not shown

- **Per-tier limits:**
  - User with tier rate limit override can create more tickets than global limit
  - User with tier file size override can upload larger files

- **Tier filter on agent dashboard:**
  - Filter dropdown appears when tiers exist
  - Filtering by tier shows only matching tickets
  - "No tier" filter works
  - Filter dropdown hidden when no tiers defined

- **Tier on reports:**
  - Tier filter available on ticket volume chart
  - Tier filter available on resolution metrics
  - Tier filter available on CSAT summary

- **External API:**
  - POST to `/api/tiers/assign` with valid secret assigns tier
  - Invalid secret returns 401
  - Invalid email returns error
  - Invalid tier key returns error

## Implementation Notes

- **Tier expiration is evaluated at query time** — no cron job needed. Queries use `WHERE tier_expires_at IS NULL OR tier_expires_at > now()` to filter active tiers.
- **`user_has_tier_capability()` is SECURITY DEFINER** so it can access profile data regardless of the calling user's RLS context. This is safe because it only returns a boolean.
- **The `agent_tickets` VIEW** must be recreated (`CREATE OR REPLACE VIEW`) to add tier columns. Ensure the column list matches what `src/lib/queries/agent-dashboard.ts` queries.
- **Constant-time comparison** for the external API secret: use `crypto.timingSafeEqual()` in Node.js to prevent timing-based attacks.
- **Tier key immutability** is enforced at the application level (the update action does not accept a `key` field). Optionally add a Postgres trigger to prevent key changes at the DB level.
- **When no tiers exist**, all tier-related UI is hidden (§25.1): no tier filter on dashboard, no tier pills, no tier column in user management. Check at render time by querying the `subscription_tiers` count.

## Verification Checklist

- [ ] `subscription_tiers` table with key validation, capabilities, and limit overrides
- [ ] Profiles table extended with `tier_id` and `tier_expires_at`
- [ ] `user_has_tier_capability()` Postgres function works correctly
- [ ] `agent_tickets` VIEW includes tier data
- [ ] Seed data: 3 tiers (free, licensed, enterprise) with correct assignments
- [ ] Admin can create/edit/delete/reorder tiers
- [ ] Tier key is immutable after creation
- [ ] Admin can assign/remove tiers on users with optional expiration
- [ ] Tier display pills shown on ticket detail, agent dashboard, profile pages
- [ ] Expired tiers not displayed (no pill)
- [ ] Users with no tier show no pill
- [ ] Capability overrides work on own tickets only
- [ ] All 5 capability overrides independently tested
- [ ] Blocked users cannot exercise tier capabilities
- [ ] Per-tier rate limit overrides work (ticket creation)
- [ ] Per-tier file limit overrides work (upload size, files per post)
- [ ] Tier filter on agent dashboard (URL-driven state)
- [ ] Tier filter hidden when no tiers defined
- [ ] Tier dimension on reporting charts (volume, resolution, CSAT)
- [ ] External API: assign by email + tier key + secret
- [ ] External API: constant-time secret comparison
- [ ] External API: logged in admin audit log with actor "API"
- [ ] Shared secret stored in Supabase Vault, shown masked with Copy/Regenerate
- [ ] Deleting a tier revokes assignments immediately
- [ ] `npm run typecheck` passes with no errors
- [ ] `npm run lint` passes with no errors
- [ ] `npm run test:db` passes subscription-tiers tests
- [ ] `npm run test:e2e` passes subscription-tiers tests
