# Phase 1 — Database Schema (Core Tables)

## Context

You are building the database layer for a **HelpDesk** application. Read the full specs in `docs/requirements.md`, `docs/architecture.md`, and `docs/seed-data.md`.

This is Phase 1: create the core database tables, helper functions, RLS policies, and database tests. **No UI in this phase.**

The project is already initialized (Phase 0). Supabase local dev is working.

## Architecture Constraints (from docs)

- All security enforced at database level via Row-Level Security (RLS)
- Helper functions `get_user_role()`, `is_agent()`, `is_admin()`, `is_teammate()` must be Postgres functions used in RLS policies
- The `agent_tickets` VIEW must exist for dashboard performance
- Content-length limits enforced at DB level (see `docs/architecture.md` constraint 9)

> **IMPORTANT:** Every "(max N chars)" annotation in this prompt MUST be implemented as a `CHECK (char_length(col) <= N)` constraint, not just documentation. This applies to: `profiles.display_name (100)`, `teams.name (100)`, `ticket_types.name (100)`, `categories.name (100)`, `tags.name (50)`, `tags.color (20)`, `tickets.title (300)`, `posts.body (50000)`, `saved_views.name (100)`.

## Tasks

### 1. Create Migration: `supabase/migrations/001_core_schema.sql`

#### Enum Types

```sql
-- User roles
CREATE TYPE user_role AS ENUM ('user', 'agent', 'admin');

-- Ticket statuses
CREATE TYPE ticket_status AS ENUM ('open', 'pending', 'closed');

-- Priority levels (used for both urgency and severity)
CREATE TYPE priority_level AS ENUM ('low', 'medium', 'high', 'critical');

-- Post types
CREATE TYPE post_type AS ENUM ('post', 'comment', 'note');
```

#### Tables

> **IMPORTANT — Creation order:** Tables must be created in dependency order to satisfy foreign key references. Create in this order: `teams` → `profiles` → `ticket_types` → `categories` → `tickets` → `posts` → `ticket_tags` → `ticket_followers` → `activity_log` → `login_attempts` → `saved_views` → `app_settings`. The descriptions below are grouped logically, not necessarily in creation order.

**`profiles`** — Extends `auth.users` with app-specific data:
- `id` UUID PRIMARY KEY REFERENCES auth.users(id)
- `email` TEXT NOT NULL
- `display_name` TEXT (max 100 chars)
- `role` user_role NOT NULL DEFAULT 'user'
- `team_id` UUID REFERENCES teams(id) ON DELETE RESTRICT (nullable)
- `is_blocked` BOOLEAN NOT NULL DEFAULT false
- `created_at` TIMESTAMPTZ NOT NULL DEFAULT now()
- `updated_at` TIMESTAMPTZ NOT NULL DEFAULT now()

**`teams`** — User teams:
- `id` UUID PRIMARY KEY DEFAULT gen_random_uuid()
- `name` TEXT NOT NULL (max 100 chars) UNIQUE
- `created_at` TIMESTAMPTZ NOT NULL DEFAULT now()

**`ticket_types`** — Configurable ticket types:
- `id` UUID PRIMARY KEY DEFAULT gen_random_uuid()
- `name` TEXT NOT NULL (max 100 chars) UNIQUE
- `is_default` BOOLEAN NOT NULL DEFAULT false
- `created_at` TIMESTAMPTZ NOT NULL DEFAULT now()

Partial unique index to guarantee at most one default type:
```sql
CREATE UNIQUE INDEX idx_ticket_types_one_default ON ticket_types (is_default) WHERE is_default = true;
```

Seed 3 default types: "Question" (default), "Issue", "Suggestion".

**`categories`** — Optional ticket categories:
- `id` UUID PRIMARY KEY DEFAULT gen_random_uuid()
- `name` TEXT NOT NULL (max 100 chars) UNIQUE
- `created_at` TIMESTAMPTZ NOT NULL DEFAULT now()

**`tags`** — Ticket tags:
- `id` UUID PRIMARY KEY DEFAULT gen_random_uuid()
- `name` TEXT NOT NULL (max 50 chars) UNIQUE
- `color` TEXT NOT NULL DEFAULT '#6B7280' (max 20 chars, CHECK constraint)
- `created_at` TIMESTAMPTZ NOT NULL DEFAULT now()

**`tickets`** — Core ticket table:
- `id` BIGSERIAL PRIMARY KEY
- `title` TEXT NOT NULL (max 300 chars, CHECK constraint)
- `slug` TEXT NOT NULL
- `status` ticket_status NOT NULL DEFAULT 'open'
- `urgency` priority_level NOT NULL DEFAULT 'medium'
- `severity` priority_level NOT NULL DEFAULT 'medium'
- `is_private` BOOLEAN NOT NULL DEFAULT true
- `type_id` UUID NOT NULL REFERENCES ticket_types(id) ON DELETE RESTRICT
- `category_id` UUID REFERENCES categories(id) ON DELETE RESTRICT (nullable)
- `creator_id` UUID NOT NULL REFERENCES profiles(id)
- `assigned_agent_id` UUID REFERENCES profiles(id) (nullable)
- `duplicate_of_id` BIGINT REFERENCES tickets(id) (nullable)
- `merged_into_id` BIGINT REFERENCES tickets(id) (nullable)
- `custom_fields` JSONB DEFAULT '{}'
- `source_article_id` BIGINT (nullable) — *placeholder for Phase 13 (Knowledge Base); no FK constraint until that table exists*
- `created_at` TIMESTAMPTZ NOT NULL DEFAULT now()
- `updated_at` TIMESTAMPTZ NOT NULL DEFAULT now()

Indexes: `creator_id`, `assigned_agent_id`, `status`, `created_at`, `updated_at`, `type_id`, `category_id`, `is_private`, `slug` (UNIQUE per ticket), `duplicate_of_id`, `merged_into_id`.

**`posts`** — Posts, comments, and notes:
- `id` UUID PRIMARY KEY DEFAULT gen_random_uuid()
- `ticket_id` BIGINT NOT NULL REFERENCES tickets(id) ON DELETE CASCADE
- `author_id` UUID NOT NULL REFERENCES profiles(id)
- `parent_post_id` UUID REFERENCES posts(id) ON DELETE CASCADE (nullable, for comments)
- `parent_comment_id` UUID REFERENCES posts(id) ON DELETE CASCADE (nullable, for nested replies)
- `post_type` post_type NOT NULL DEFAULT 'post'
- `body` TEXT NOT NULL (max 50,000 chars, CHECK constraint)
- `is_private` BOOLEAN NOT NULL DEFAULT false
- `is_draft` BOOLEAN NOT NULL DEFAULT false
- `is_original` BOOLEAN NOT NULL DEFAULT false
- `edited_at` TIMESTAMPTZ (nullable)
- `created_at` TIMESTAMPTZ NOT NULL DEFAULT now()

Indexes: `ticket_id`, `author_id`, `parent_post_id`, `created_at`, `post_type`, `is_private`, `is_draft`.

**`ticket_tags`** — Many-to-many:
- `ticket_id` BIGINT NOT NULL REFERENCES tickets(id) ON DELETE CASCADE
- `tag_id` UUID NOT NULL REFERENCES tags(id) ON DELETE CASCADE
- PRIMARY KEY (ticket_id, tag_id)

Index: `tag_id` (reverse lookup for finding tickets by tag).

**`ticket_followers`** — Following tickets:
- `ticket_id` BIGINT NOT NULL REFERENCES tickets(id) ON DELETE CASCADE
- `user_id` UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE
- `created_at` TIMESTAMPTZ NOT NULL DEFAULT now()
- PRIMARY KEY (ticket_id, user_id)

**`activity_log`** — Audit trail:
- `id` UUID PRIMARY KEY DEFAULT gen_random_uuid()
- `ticket_id` BIGINT NOT NULL REFERENCES tickets(id) ON DELETE CASCADE
- `actor_id` UUID NOT NULL REFERENCES profiles(id)
- `action` TEXT NOT NULL
- `details` JSONB DEFAULT '{}'
- `created_at` TIMESTAMPTZ NOT NULL DEFAULT now()

Index: `ticket_id`, `created_at`.

**`login_attempts`** — Brute-force protection:
- `id` UUID PRIMARY KEY DEFAULT gen_random_uuid()
- `email` TEXT NOT NULL
- `attempt_count` INTEGER NOT NULL DEFAULT 0
- `locked_until` TIMESTAMPTZ (nullable)
- `updated_at` TIMESTAMPTZ NOT NULL DEFAULT now()

UNIQUE index on `email`.

**`saved_views`** — Agent saved filter/sort combinations (requirement 8.13):
- `id` UUID PRIMARY KEY DEFAULT gen_random_uuid()
- `agent_id` UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE
- `name` TEXT NOT NULL (max 100 chars, CHECK constraint)
- `filters` JSONB NOT NULL DEFAULT '{}'
- `created_at` TIMESTAMPTZ NOT NULL DEFAULT now()
- `updated_at` TIMESTAMPTZ NOT NULL DEFAULT now()

UNIQUE constraint on `(agent_id, name)` — an agent cannot have two views with the same name.

**`app_settings`** — Key-value store for configurable settings:
- `key` TEXT PRIMARY KEY
- `value` TEXT NOT NULL
- `updated_at` TIMESTAMPTZ NOT NULL DEFAULT now()

Seed default settings:
```sql
INSERT INTO app_settings (key, value) VALUES
  ('ticket_creation_rate_limit', '10'),
  ('allow_public_ticket_browsing', 'false'),
  ('ticket_default_privacy', 'true'),
  ('allow_user_privacy_control', 'true'),
  ('agent_dashboard_page_size', '20');
```

### 2. Helper Functions

```sql
-- Get the current user's role from profiles
CREATE OR REPLACE FUNCTION get_user_role()
RETURNS user_role AS $$
  SELECT role FROM profiles WHERE id = auth.uid()
$$ LANGUAGE sql SECURITY DEFINER STABLE;

-- Check if current user is an agent (or admin, since admin inherits agent)
CREATE OR REPLACE FUNCTION is_agent()
RETURNS boolean AS $$
  SELECT get_user_role() IN ('agent', 'admin')
$$ LANGUAGE sql SECURITY DEFINER STABLE;

-- Check if current user is an admin
CREATE OR REPLACE FUNCTION is_admin()
RETURNS boolean AS $$
  SELECT get_user_role() = 'admin'
$$ LANGUAGE sql SECURITY DEFINER STABLE;

-- Check if current user is a teammate of a given user
CREATE OR REPLACE FUNCTION is_teammate(target_user_id UUID)
RETURNS boolean AS $$
  SELECT EXISTS (
    SELECT 1 FROM profiles p1
    JOIN profiles p2 ON p1.team_id = p2.team_id
    WHERE p1.id = auth.uid()
      AND p2.id = target_user_id
      AND p1.team_id IS NOT NULL
  )
$$ LANGUAGE sql SECURITY DEFINER STABLE;
```

### 3. Auto-update `updated_at` Trigger

```sql
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Apply to tickets and profiles
CREATE TRIGGER tickets_updated_at BEFORE UPDATE ON tickets
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER profiles_updated_at BEFORE UPDATE ON profiles
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
```

### 4. Auto-create Profile Trigger

```sql
CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.profiles (id, email, display_name)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(
      NEW.raw_user_meta_data->>'display_name',
      NEW.raw_user_meta_data->>'name',          -- OAuth providers (Google/GitHub) use 'name'
      split_part(NEW.email, '@', 1)
    )
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION handle_new_user();
```

### 5. Slug Generation Function

```sql
CREATE OR REPLACE FUNCTION generate_slug(title TEXT)
RETURNS TEXT AS $$
  SELECT COALESCE(
    NULLIF(
      trim(both '-' from
        regexp_replace(
          regexp_replace(
            regexp_replace(
              lower(COALESCE(title, '')),
              '[^a-z0-9\s-]', '', 'g'   -- strip non-alphanumeric
            ),
            '\s+', '-', 'g'             -- spaces → hyphens
          ),
          '-+', '-', 'g'                -- collapse consecutive hyphens
        )
      ),
      ''                                  -- NULLIF: treat empty string as NULL
    ),
    'untitled'                            -- fallback for NULL/empty/special-chars-only
  )
$$ LANGUAGE sql IMMUTABLE;
```

**Edge cases the function must handle:**
- `NULL` → `'untitled'`
- `''` (empty) → `'untitled'`
- `'!!!@@@'` (special chars only) → `'untitled'`
- `'  hello  '` → `'hello'` (no leading/trailing hyphens)
- `'hello - - world'` → `'hello-world'` (collapse consecutive hyphens)

### 5a. Ticket Creation Rate Limit Trigger (Defense-in-Depth)

Per requirement 3.14, add a `BEFORE INSERT` trigger on `tickets` that enforces the creation rate limit at the database level (alongside the Server Action check):

```sql
CREATE OR REPLACE FUNCTION check_ticket_rate_limit()
RETURNS TRIGGER AS $$
DECLARE
  ticket_count INTEGER;
  rate_limit INTEGER;
  user_role_val user_role;
BEGIN
  -- Agents are exempt
  SELECT role INTO user_role_val FROM profiles WHERE id = NEW.creator_id;
  IF user_role_val IN ('agent', 'admin') THEN
    RETURN NEW;
  END IF;

  -- Get configured rate limit (default 10, 0 = unlimited)
  SELECT COALESCE(
    (SELECT value::integer FROM app_settings WHERE key = 'ticket_creation_rate_limit'),
    10
  ) INTO rate_limit;

  IF rate_limit = 0 THEN
    RETURN NEW;
  END IF;

  SELECT count(*) INTO ticket_count
  FROM tickets
  WHERE creator_id = NEW.creator_id
    AND created_at > now() - interval '24 hours';

  IF ticket_count >= rate_limit THEN
    RAISE EXCEPTION 'Ticket creation rate limit exceeded';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER tickets_rate_limit
  BEFORE INSERT ON tickets
  FOR EACH ROW EXECUTE FUNCTION check_ticket_rate_limit();
```

> **Known limitation:** This trigger has a TOCTOU race window — two concurrent inserts may both pass the count check. This is acceptable as defense-in-depth (the primary check is in the Server Action). If stronger guarantees are needed later, add `PERFORM pg_advisory_xact_lock(hashtext('ticket_rl_' || NEW.creator_id::text));` at the start of the function.

> **Note:** The `app_settings` defaults are already seeded in the table definition (Section 1). Do NOT duplicate the INSERT here.

### 5b. Blocked User Check Helper

```sql
CREATE OR REPLACE FUNCTION is_blocked()
RETURNS boolean AS $$
  SELECT COALESCE(
    (SELECT is_blocked FROM profiles WHERE id = auth.uid()),
    false
  )
$$ LANGUAGE sql SECURITY DEFINER STABLE;
```

### 6. RLS Policies

Enable RLS on ALL tables. Key policies:

> **IMPORTANT:** Each policy below must be implemented as actual SQL (`CREATE POLICY ... ON ... FOR ... TO ... USING (...) WITH CHECK (...)`), not pseudo-code. Pay careful attention to `USING` (read filter) vs `WITH CHECK` (write guard). A single UPDATE policy cannot restrict *which columns* are updatable — column-level restrictions must be enforced in Server Actions or triggers.

**profiles:**
- SELECT: authenticated users can read all profiles (needed for display names)
- UPDATE: users can update their own profile only (`id = auth.uid()`)
- INSERT: via trigger only (service_role) — no policy for `authenticated`

**tickets:**
- SELECT: `is_agent()` sees all; otherwise user sees own tickets (`creator_id = auth.uid()`) + public tickets (`NOT is_private`) + teammate tickets (`is_teammate(creator_id)`)
- INSERT: `auth.uid() = creator_id AND NOT is_blocked()`
- UPDATE: owner can update (limited fields enforced in Server Action); agents can update any ticket
- DELETE: `is_admin()` only
- **Blocked users:** can SELECT (own tickets visible) but CANNOT INSERT/UPDATE/DELETE. Do NOT add `NOT is_blocked()` to SELECT policies.

**posts:** (CRITICAL — complex privacy model from requirement 12.1)
- SELECT: Multi-condition policy:
  ```
  -- Public posts on visible tickets (comments must also check root post privacy)
  (NOT is_private AND NOT is_draft AND post_type != 'note'
   AND (parent_post_id IS NULL OR NOT COALESCE(get_root_post_is_private(id), false))
   AND ticket is visible per tickets SELECT rules)
  OR
  -- Private posts: visible to ticket owner, teammates of owner, and agents
  (is_private AND (
    auth.uid() = author_id
    OR auth.uid() = (SELECT creator_id FROM tickets WHERE id = ticket_id)
    OR is_teammate((SELECT creator_id FROM tickets WHERE id = ticket_id))
    OR is_agent()
  ))
  OR
  -- Comments inherit privacy from root post: traverse parent_post_id chain
  -- to find the root post's is_private flag. If root is private, same rules apply.
  (parent_post_id IS NOT NULL AND ... root post privacy check ...)
  OR
  -- Drafts: visible only to agents
  (is_draft AND is_agent())
  OR
  -- Notes: visible only to agents
  (post_type = 'note' AND is_agent())
  ```
  **Comment privacy inheritance (requirement 12.1):** All comments on a private post are automatically private — comment privacy is inherited from the root post the thread belongs to (regardless of nesting depth) and cannot be set independently. Create this helper function and use it in the SELECT policy:

  ```sql
  CREATE OR REPLACE FUNCTION get_root_post_is_private(p_post_id UUID)
  RETURNS boolean AS $$
    WITH RECURSIVE chain AS (
      SELECT id, parent_post_id, parent_comment_id, is_private
      FROM posts WHERE id = p_post_id
      UNION ALL
      SELECT p.id, p.parent_post_id, p.parent_comment_id, p.is_private
      FROM posts p
      JOIN chain c ON p.id = COALESCE(c.parent_post_id, c.parent_comment_id)
      WHERE c.parent_post_id IS NOT NULL OR c.parent_comment_id IS NOT NULL
    )
    SELECT is_private FROM chain
    WHERE parent_post_id IS NULL AND parent_comment_id IS NULL
    LIMIT 1;
  $$ LANGUAGE sql SECURITY DEFINER STABLE;
  ```

  Then replace the `... root post privacy check ...` placeholder in the SELECT policy with:
  ```
  (parent_post_id IS NOT NULL AND get_root_post_is_private(id) AND (
    auth.uid() = author_id
    OR auth.uid() = (SELECT creator_id FROM tickets WHERE id = ticket_id)
    OR is_teammate((SELECT creator_id FROM tickets WHERE id = ticket_id))
    OR is_agent()
  ))
  ```

- INSERT: user can post on visible tickets `AND NOT is_blocked()` (non-agents cannot post on duplicate tickets)
- UPDATE: author can edit own posts; agents can edit any post/comment (but only own notes)
- DELETE: agents can delete posts/comments (not original post `is_original = true`); agents delete own notes; admins delete any note

**app_settings:**
- SELECT: authenticated users can read all settings
- INSERT/UPDATE/DELETE: `is_admin()` only

**login_attempts:**
- Enable RLS with **no policies** for `authenticated` or `anon` roles. All access is via `service_role` client in Server Actions.

**saved_views:**
- SELECT: agent sees own views (`agent_id = auth.uid() AND is_agent()`)
- INSERT: `agent_id = auth.uid() AND is_agent()`
- UPDATE: `agent_id = auth.uid() AND is_agent()`
- DELETE: `agent_id = auth.uid() AND is_agent()`

**ticket_tags / ticket_followers / activity_log / categories / tags / ticket_types / teams:**
- Appropriate read/write policies per role as described in doc requirements.

### 7. Agent Tickets VIEW

```sql
CREATE VIEW agent_tickets WITH (security_invoker = true) AS
SELECT
  t.*,
  p.display_name AS creator_display_name,
  p.email AS creator_email,
  p.team_id AS creator_team_id,
  tm.name AS creator_team_name,
  ap.display_name AS agent_display_name,
  tt.name AS type_name,
  c.name AS category_name,
  (SELECT count(*) FROM posts WHERE ticket_id = t.id AND post_type = 'post') AS post_count
FROM tickets t
JOIN profiles p ON t.creator_id = p.id
LEFT JOIN teams tm ON p.team_id = tm.id
LEFT JOIN profiles ap ON t.assigned_agent_id = ap.id
LEFT JOIN ticket_types tt ON t.type_id = tt.id
LEFT JOIN categories c ON t.category_id = c.id;
```

**Note:** This VIEW will be extended in Phase 20 (Subscription Tiers) to join subscription tier data (tier display name, color, icon) per architecture constraint 5. For now, the VIEW covers the columns needed through Phase 4.

### 7a. Text Search Infrastructure

Requirements 3.7 and 8.14 require searching tickets by title/content. Set up full-text search:

```sql
-- Add search_vector column to tickets
ALTER TABLE tickets ADD COLUMN search_vector tsvector;

-- GIN index for fast full-text search
CREATE INDEX idx_tickets_search ON tickets USING GIN (search_vector);

-- Trigger to auto-populate search_vector from title
CREATE OR REPLACE FUNCTION update_ticket_search_vector()
RETURNS TRIGGER AS $$
BEGIN
  NEW.search_vector := to_tsvector('english', COALESCE(NEW.title, ''));
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER tickets_search_vector
  BEFORE INSERT OR UPDATE OF title ON tickets
  FOR EACH ROW EXECUTE FUNCTION update_ticket_search_vector();
```

> **Note:** In Phase 3, this trigger will be extended to also include the first post body in the search vector. For now, only ticket title is indexed.

### 7b. Ticket `updated_at` on New Post

When a new post is created, the parent ticket's `updated_at` should be refreshed (requirement 3.2: "sorted by last-updated"):

```sql
CREATE OR REPLACE FUNCTION update_ticket_on_new_post()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE tickets SET updated_at = now() WHERE id = NEW.ticket_id;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER posts_update_ticket_timestamp
  AFTER INSERT ON posts
  FOR EACH ROW EXECUTE FUNCTION update_ticket_on_new_post();
```

### 8. Database Tests

Create `tests/db/001-schema.test.ts`:

```typescript
// Test structure — implement ALL of these as specific test cases:
//
// 1. TABLE EXISTENCE: verify all 13 tables + 1 VIEW exist
//
// 2. HELPER FUNCTIONS:
//    - get_user_role() returns correct role for user/agent/admin
//    - get_user_role() returns NULL when user has no profile
//    - is_agent() returns true for agent AND admin
//    - is_admin() returns true only for admin
//    - is_teammate() returns true when same team, false when different teams
//    - is_teammate() returns false when either user has NULL team_id
//    - is_blocked() returns true for blocked user, false for normal user
//    - is_blocked() returns false when user has no profile
//
// 3. SLUG GENERATION:
//    - generate_slug('Hello World') => 'hello-world'
//    - generate_slug('  hello  ') => 'hello' (no leading/trailing hyphens)
//    - generate_slug('hello - - world') => 'hello-world' (collapse hyphens)
//    - generate_slug('!!!@@@') => 'untitled' (special chars only)
//    - generate_slug('') => 'untitled'
//    - generate_slug(NULL) => 'untitled'
//
// 4. RLS — TICKETS:
//    a. User can see own tickets
//    b. User cannot see others' private tickets
//    c. User can see public tickets
//    d. Agent can see all tickets (including private)
//    e. Teammate can see teammate's private tickets
//    f. User cannot update another user's ticket
//    g. Agent can update any ticket's status
//    h. Admin can delete tickets
//    i. Blocked user CAN read own tickets (SELECT allowed)
//    j. Blocked user CANNOT create tickets (INSERT denied)
//
// 5. RLS — POSTS (privacy model):
//    a. Public post on public ticket: visible to all authenticated users
//    b. Private post on public ticket: invisible to non-owner non-agent
//    c. Private post visible to ticket owner
//    d. Private post visible to teammate of ticket owner
//    e. Private post visible to agents
//    f. Comment on private post: inherits privacy (blocked for outsiders)
//    g. Nested comment on private post: also inherits privacy
//    h. Draft post: invisible to non-agents
//    i. Note: invisible to non-agents
//    j. Agent can edit any post but only own notes
//    k. Original post (is_original=true) cannot be deleted even by admin
//    l. Blocked user CANNOT create posts (INSERT denied)
//
// 6. RLS — OTHER TABLES:
//    a. app_settings: readable by authenticated, writable only by admin
//    b. login_attempts: NOT accessible by authenticated or anon users
//    c. saved_views: agent can CRUD own views, cannot see others' views
//    d. agent_tickets VIEW: respects invoker's RLS (security_invoker=true)
//
// 7. TRIGGERS:
//    a. updated_at auto-updates on ticket UPDATE
//    b. updated_at auto-updates on profile UPDATE
//    c. handle_new_user creates profile on auth.users INSERT
//    d. handle_new_user with raw_user_meta_data containing only 'name' (not 'display_name')
//    e. handle_new_user with NULL raw_user_meta_data
//    f. check_ticket_rate_limit blocks at exact boundary (count = limit)
//    g. check_ticket_rate_limit allows agents (exempt)
//    h. check_ticket_rate_limit allows when rate_limit = 0 (unlimited)
//    i. posts_update_ticket_timestamp: ticket.updated_at refreshes on new post
//
// 8. CHECK CONSTRAINTS:
//    a. tickets.title: exactly 300 chars allowed, 301 rejected
//    b. posts.body: exactly 50000 chars allowed, 50001 rejected
//    c. profiles.display_name: exactly 100 chars allowed, 101 rejected
//    d. tags.color: exactly 20 chars allowed, 21 rejected
//    e. saved_views.name: exactly 100 chars allowed, 101 rejected
//
// 9. UNIQUE CONSTRAINTS:
//    a. ticket_types: only one row with is_default=true (try setting two)
//    b. saved_views: same agent cannot have two views with same name
//
// 10. FK BEHAVIOR:
//    a. Cannot delete a team that has members (ON DELETE RESTRICT)
//    b. Cannot delete a ticket_type in use by tickets (ON DELETE RESTRICT)
//    c. Cannot delete a category in use by tickets (ON DELETE RESTRICT)
//
// 11. TEXT SEARCH:
//    a. search_vector is auto-populated on ticket INSERT
//    b. search_vector updates when title changes
//    c. to_tsquery matches expected tickets
```

Use the test helper from `tests/helpers/supabase.ts` to create authenticated clients for different test users. Seed test users with known UUIDs using the service_role client.

## Verification Checklist

- [ ] `supabase db reset` runs the migration successfully
- [ ] All tables created with correct columns and constraints
- [ ] All helper functions return correct results
- [ ] RLS policies enforce access rules correctly
- [ ] `npm run typecheck` passes with no errors
- [ ] `npm run lint` passes with no errors
- [ ] `npm run test:db` passes all database tests
- [ ] `agent_tickets` VIEW returns correct joined data
- [ ] Content-length CHECK constraints reject oversized inputs
