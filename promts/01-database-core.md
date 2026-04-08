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

**`profiles`** — Extends `auth.users` with app-specific data:
- `id` UUID PRIMARY KEY REFERENCES auth.users(id)
- `email` TEXT NOT NULL
- `display_name` TEXT (max 100 chars)
- `role` user_role NOT NULL DEFAULT 'user'
- `team_id` UUID REFERENCES teams(id) (nullable)
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

Seed 3 default types: "Question" (default), "Issue", "Suggestion".

**`categories`** — Optional ticket categories:
- `id` UUID PRIMARY KEY DEFAULT gen_random_uuid()
- `name` TEXT NOT NULL (max 100 chars) UNIQUE
- `created_at` TIMESTAMPTZ NOT NULL DEFAULT now()

**`tags`** — Ticket tags:
- `id` UUID PRIMARY KEY DEFAULT gen_random_uuid()
- `name` TEXT NOT NULL (max 50 chars) UNIQUE
- `color` TEXT NOT NULL DEFAULT '#6B7280'
- `created_at` TIMESTAMPTZ NOT NULL DEFAULT now()

**`tickets`** — Core ticket table:
- `id` BIGSERIAL PRIMARY KEY
- `title` TEXT NOT NULL (max 300 chars, CHECK constraint)
- `slug` TEXT NOT NULL
- `status` ticket_status NOT NULL DEFAULT 'open'
- `urgency` priority_level NOT NULL DEFAULT 'medium'
- `severity` priority_level NOT NULL DEFAULT 'medium'
- `is_private` BOOLEAN NOT NULL DEFAULT true
- `type_id` UUID NOT NULL REFERENCES ticket_types(id)
- `category_id` UUID REFERENCES categories(id) (nullable)
- `creator_id` UUID NOT NULL REFERENCES profiles(id)
- `assigned_agent_id` UUID REFERENCES profiles(id) (nullable)
- `duplicate_of_id` BIGINT REFERENCES tickets(id) (nullable)
- `merged_into_id` BIGINT REFERENCES tickets(id) (nullable)
- `custom_fields` JSONB DEFAULT '{}'
- `source_article_id` BIGINT (nullable)
- `created_at` TIMESTAMPTZ NOT NULL DEFAULT now()
- `updated_at` TIMESTAMPTZ NOT NULL DEFAULT now()

Indexes: `creator_id`, `assigned_agent_id`, `status`, `created_at`, `updated_at`.

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

Indexes: `ticket_id`, `author_id`, `parent_post_id`, `created_at`.

**`ticket_tags`** — Many-to-many:
- `ticket_id` BIGINT NOT NULL REFERENCES tickets(id) ON DELETE CASCADE
- `tag_id` UUID NOT NULL REFERENCES tags(id) ON DELETE CASCADE
- PRIMARY KEY (ticket_id, tag_id)

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
    COALESCE(NEW.raw_user_meta_data->>'display_name', split_part(NEW.email, '@', 1))
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
  SELECT lower(regexp_replace(regexp_replace(title, '[^a-zA-Z0-9\s-]', '', 'g'), '\s+', '-', 'g'))
$$ LANGUAGE sql IMMUTABLE;
```

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

Also create the `app_settings` key-value table for configurable settings:

```sql
CREATE TABLE app_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

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

**profiles:**
- SELECT: authenticated users can read all profiles (needed for display names)
- UPDATE: users can update their own profile only
- INSERT: via trigger only (service_role)

**tickets:**
- SELECT: user sees own tickets + public tickets + teammate tickets (if on a team) + agents see all
- INSERT: authenticated users can create tickets (creator_id = auth.uid()) AND NOT is_blocked()
- UPDATE: owner can update limited fields; agents can update all fields
- DELETE: admin only

**posts:**
- SELECT: follows ticket visibility + notes visible only to agents + drafts visible only to agents
- INSERT: user can post on visible tickets AND NOT is_blocked() (not duplicate for non-agents)
- UPDATE: author can edit own posts; agents can edit any post/comment (but only own notes)
- DELETE: agents can delete posts/comments (not original post); agents delete own notes; admins delete any note

**ticket_tags / ticket_followers / activity_log / categories / tags / ticket_types / teams:**
- Appropriate read/write policies per role as described in doc requirements.

### 7. Agent Tickets VIEW

```sql
CREATE VIEW agent_tickets AS
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

### 8. Database Tests

Create `tests/db/001-schema.test.ts`:

```typescript
// Test structure:
// 1. Verify all tables exist
// 2. Verify helper functions work (get_user_role, is_agent, is_admin, is_teammate)
// 3. Verify RLS policies:
//    a. User can see own tickets, not others' private tickets
//    b. User can see public tickets
//    c. Agent can see all tickets
//    d. User cannot update another user's ticket
//    e. Agent can update any ticket's status
//    f. Admin can delete tickets (non-closed)
//    g. Notes are invisible to regular users
//    h. Teammate can see teammate's private tickets
// 4. Verify triggers (updated_at, profile creation)
// 5. Verify content-length CHECK constraints
// 6. Verify agent_tickets VIEW returns expected columns
```

Use the test helper from `tests/helpers/supabase.ts` to create authenticated clients for different test users. Seed test users with known UUIDs using the service_role client.

## Verification Checklist

- [ ] `supabase db reset` runs the migration successfully
- [ ] All tables created with correct columns and constraints
- [ ] All helper functions return correct results
- [ ] RLS policies enforce access rules correctly
- [ ] `npm run test:db` passes all database tests
- [ ] `agent_tickets` VIEW returns correct joined data
- [ ] Content-length CHECK constraints reject oversized inputs
