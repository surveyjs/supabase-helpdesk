-- ============================================================
-- HelpDesk — Initial Database Schema
-- ============================================================
-- Creates the complete schema in its final shape: tables, indexes,
-- functions, triggers, RLS policies, views, storage, realtime,
-- seed data and scheduled jobs.
--
-- Sections:
--   1. Extensions & enum types
--   2. Core tables
--   3. Helper functions
--   4. Core triggers
--   5. Core RLS policies
--   6. Agent tickets view
--   7. Admin (audit log, custom fields, notification templates)
--   8. File attachments & storage
--   9. Email notifications
--  10. In-app notifications & realtime
--  11. CSAT
--  12. SLA
--  13. Knowledge base
--  14. User notes
--  15. Canned responses
--  16. Inbound email
--  17. AI features
--  18. Vault RPC functions
--  19. Seed data
--  20. Scheduled jobs (pg_cron)
-- ============================================================


-- ============================================================
-- 1. Extensions & Enum Types
-- ============================================================

-- Vault (encrypted storage for AI / OAuth / tier API secrets)
CREATE EXTENSION IF NOT EXISTS supabase_vault;

CREATE TYPE user_role AS ENUM ('user', 'agent', 'admin');
CREATE TYPE ticket_status AS ENUM ('open', 'pending', 'closed');
CREATE TYPE priority_level AS ENUM ('low', 'medium', 'high', 'critical');
CREATE TYPE post_type AS ENUM ('post', 'comment', 'note');


-- ============================================================
-- 2. Core Tables (in dependency order)
-- ============================================================

-- teams
CREATE TABLE teams (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL UNIQUE CHECK (char_length(name) <= 100),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- subscription_tiers (referenced by profiles.tier_id)
CREATE TABLE subscription_tiers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  key TEXT NOT NULL UNIQUE CHECK (
    char_length(key) BETWEEN 1 AND 50
    AND key ~ '^[a-z0-9](-?[a-z0-9])*$'
  ),
  display_name TEXT NOT NULL CHECK (char_length(display_name) <= 100),
  color TEXT NOT NULL DEFAULT 'gray',
  icon TEXT DEFAULT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  -- Capability overrides (each boolean, default false)
  cap_change_visibility BOOLEAN NOT NULL DEFAULT false,
  cap_set_severity BOOLEAN NOT NULL DEFAULT false,
  cap_change_status BOOLEAN NOT NULL DEFAULT false,
  cap_change_type BOOLEAN NOT NULL DEFAULT false,
  cap_add_remove_tags BOOLEAN NOT NULL DEFAULT false,
  -- Per-tier limit overrides (null = use global default)
  limit_ticket_rate INTEGER DEFAULT NULL,
  limit_max_file_size INTEGER DEFAULT NULL CHECK (limit_max_file_size IS NULL OR limit_max_file_size <= 52428800),
  limit_max_files_per_post INTEGER DEFAULT NULL CHECK (limit_max_files_per_post IS NULL OR limit_max_files_per_post <= 20),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- profiles
CREATE TABLE profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id),
  email TEXT NOT NULL,
  display_name TEXT CHECK (char_length(display_name) <= 100),
  role user_role NOT NULL DEFAULT 'user',
  team_id UUID REFERENCES teams(id) ON DELETE RESTRICT,
  is_blocked BOOLEAN NOT NULL DEFAULT false,
  -- Subscription tier assignment
  tier_id UUID REFERENCES subscription_tiers(id) ON DELETE SET NULL,
  tier_expires_at TIMESTAMPTZ DEFAULT NULL,
  -- Markdown editor preferences
  editor_view_mode TEXT NOT NULL DEFAULT 'both'
    CHECK (editor_view_mode IN ('both', 'preview', 'editor')),
  editor_min_height_px INTEGER NOT NULL DEFAULT 300
    CHECK (editor_min_height_px BETWEEN 120 AND 1000),
  editor_max_height_px INTEGER NOT NULL DEFAULT 540
    CHECK (editor_max_height_px BETWEEN 200 AND 2000),
  -- Last-selected agent dashboard saved view (FK added after saved_views)
  active_view_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT chk_display_name_not_reserved
    CHECK (display_name NOT LIKE 'Deleted User #%'),
  CONSTRAINT editor_height_min_le_max
    CHECK (editor_min_height_px <= editor_max_height_px)
);

CREATE INDEX idx_profiles_tier_id ON profiles (tier_id);

-- ticket_types
CREATE TABLE ticket_types (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL UNIQUE CHECK (char_length(name) <= 100),
  is_default BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX idx_ticket_types_one_default ON ticket_types (is_default) WHERE is_default = true;

-- categories
CREATE TABLE categories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL UNIQUE CHECK (char_length(name) <= 100),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- tags
CREATE TABLE tags (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL UNIQUE CHECK (char_length(name) <= 50),
  color TEXT NOT NULL DEFAULT '#6B7280' CHECK (char_length(color) <= 20),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- tickets
CREATE TABLE tickets (
  id BIGSERIAL PRIMARY KEY,
  title TEXT NOT NULL CHECK (char_length(title) <= 300),
  slug TEXT NOT NULL,
  status ticket_status NOT NULL DEFAULT 'open',
  urgency priority_level NOT NULL DEFAULT 'medium',
  severity priority_level NOT NULL DEFAULT 'medium',
  is_private BOOLEAN NOT NULL DEFAULT true,
  type_id UUID NOT NULL REFERENCES ticket_types(id) ON DELETE RESTRICT,
  category_id UUID REFERENCES categories(id) ON DELETE RESTRICT,
  creator_id UUID NOT NULL REFERENCES profiles(id),
  assigned_agent_id UUID REFERENCES profiles(id),
  duplicate_of_id BIGINT REFERENCES tickets(id),
  merged_into_id BIGINT REFERENCES tickets(id),
  custom_fields JSONB DEFAULT '{}',
  -- FK to kb_articles added in the Knowledge Base section
  source_article_id BIGINT,
  -- Clone lineage: source ticket and, for comment clones, source post
  -- (FK to posts added after the posts table)
  cloned_from_id BIGINT REFERENCES tickets(id) ON DELETE SET NULL,
  cloned_from_post_id UUID,
  search_vector tsvector,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_tickets_creator_id ON tickets (creator_id);
CREATE INDEX idx_tickets_assigned_agent_id ON tickets (assigned_agent_id);
CREATE INDEX idx_tickets_status ON tickets (status);
CREATE INDEX idx_tickets_created_at ON tickets (created_at);
CREATE INDEX idx_tickets_updated_at ON tickets (updated_at);
CREATE INDEX idx_tickets_type_id ON tickets (type_id);
CREATE INDEX idx_tickets_category_id ON tickets (category_id);
CREATE INDEX idx_tickets_is_private ON tickets (is_private);
-- Slugs are NOT unique across tickets (§3.9)
CREATE INDEX idx_tickets_slug ON tickets (slug);
CREATE INDEX idx_tickets_duplicate_of_id ON tickets (duplicate_of_id);
CREATE INDEX idx_tickets_merged_into_id ON tickets (merged_into_id);
CREATE INDEX idx_tickets_cloned_from_id ON tickets (cloned_from_id);
CREATE INDEX idx_tickets_search ON tickets USING GIN (search_vector);

-- posts
CREATE TABLE posts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id BIGINT NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  author_id UUID NOT NULL REFERENCES profiles(id),
  parent_post_id UUID REFERENCES posts(id) ON DELETE CASCADE,
  parent_comment_id UUID REFERENCES posts(id) ON DELETE CASCADE,
  post_type post_type NOT NULL DEFAULT 'post',
  body TEXT NOT NULL CHECK (char_length(body) <= 50000),
  is_private BOOLEAN NOT NULL DEFAULT false,
  is_draft BOOLEAN NOT NULL DEFAULT false,
  is_original BOOLEAN NOT NULL DEFAULT false,
  edited_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_posts_ticket_id ON posts (ticket_id);
CREATE INDEX idx_posts_author_id ON posts (author_id);
CREATE INDEX idx_posts_parent_post_id ON posts (parent_post_id);
CREATE INDEX idx_posts_created_at ON posts (created_at);
CREATE INDEX idx_posts_post_type ON posts (post_type);
CREATE INDEX idx_posts_is_private ON posts (is_private);
CREATE INDEX idx_posts_is_draft ON posts (is_draft);

-- tickets <-> posts reference each other
ALTER TABLE tickets
  ADD CONSTRAINT tickets_cloned_from_post_id_fkey
  FOREIGN KEY (cloned_from_post_id) REFERENCES posts(id) ON DELETE SET NULL;

-- ticket_tags
CREATE TABLE ticket_tags (
  ticket_id BIGINT NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  tag_id UUID NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
  PRIMARY KEY (ticket_id, tag_id)
);

CREATE INDEX idx_ticket_tags_tag_id ON ticket_tags (tag_id);

-- ticket_followers
CREATE TABLE ticket_followers (
  ticket_id BIGINT NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (ticket_id, user_id)
);

-- activity_log
CREATE TABLE activity_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id BIGINT NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  actor_id UUID NOT NULL REFERENCES profiles(id),
  action TEXT NOT NULL,
  details JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_activity_log_ticket_id ON activity_log (ticket_id);
CREATE INDEX idx_activity_log_created_at ON activity_log (created_at);

-- login_attempts
CREATE TABLE login_attempts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT NOT NULL,
  attempt_count INTEGER NOT NULL DEFAULT 0,
  locked_until TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX idx_login_attempts_email ON login_attempts (email);

-- saved_views
CREATE TABLE saved_views (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  name TEXT NOT NULL CHECK (char_length(name) <= 100),
  filters JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX idx_saved_views_agent_name ON saved_views (agent_id, name);

-- profiles <-> saved_views reference each other
ALTER TABLE profiles
  ADD CONSTRAINT profiles_active_view_id_fkey
  FOREIGN KEY (active_view_id) REFERENCES saved_views(id) ON DELETE SET NULL;

-- app_settings
CREATE TABLE app_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);


-- ============================================================
-- 3. Helper Functions
-- ============================================================

CREATE OR REPLACE FUNCTION get_user_role()
RETURNS user_role AS $$
  SELECT role FROM profiles WHERE id = auth.uid()
$$ LANGUAGE sql SECURITY DEFINER STABLE;

CREATE OR REPLACE FUNCTION is_agent()
RETURNS boolean AS $$
  SELECT get_user_role() IN ('agent', 'admin')
$$ LANGUAGE sql SECURITY DEFINER STABLE;

CREATE OR REPLACE FUNCTION is_admin()
RETURNS boolean AS $$
  SELECT get_user_role() = 'admin'
$$ LANGUAGE sql SECURITY DEFINER STABLE;

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

CREATE OR REPLACE FUNCTION is_blocked()
RETURNS boolean AS $$
  SELECT COALESCE(
    (SELECT is_blocked FROM profiles WHERE id = auth.uid()),
    false
  )
$$ LANGUAGE sql SECURITY DEFINER STABLE;

-- Check if current user has a specific tier capability
CREATE OR REPLACE FUNCTION user_has_tier_capability(capability text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
DECLARE
  v_tier_id UUID;
  v_expires_at TIMESTAMPTZ;
  v_is_blocked BOOLEAN;
  v_has_cap BOOLEAN;
BEGIN
  -- Get the current user's tier and blocked status
  SELECT tier_id, tier_expires_at, is_blocked INTO v_tier_id, v_expires_at, v_is_blocked
  FROM profiles
  WHERE id = auth.uid();

  -- Blocked users cannot exercise tier capabilities
  IF v_is_blocked THEN
    RETURN false;
  END IF;

  -- No tier assigned
  IF v_tier_id IS NULL THEN
    RETURN false;
  END IF;

  -- Tier expired
  IF v_expires_at IS NOT NULL AND v_expires_at < now() THEN
    RETURN false;
  END IF;

  -- Check the specific capability (validate capability name to prevent SQL injection)
  IF capability NOT IN ('change_visibility', 'set_severity', 'change_status', 'change_type', 'add_remove_tags') THEN
    RETURN false;
  END IF;

  EXECUTE format(
    'SELECT cap_%s FROM subscription_tiers WHERE id = $1',
    capability
  ) INTO v_has_cap USING v_tier_id;

  RETURN COALESCE(v_has_cap, false);
END;
$$;

-- Slug generation
CREATE OR REPLACE FUNCTION generate_slug(title TEXT)
RETURNS TEXT AS $$
  SELECT COALESCE(
    NULLIF(
      trim(both '-' from
        regexp_replace(
          regexp_replace(
            regexp_replace(
              lower(COALESCE(title, '')),
              '[^a-z0-9\s-]', '', 'g'
            ),
            '\s+', '-', 'g'
          ),
          '-+', '-', 'g'
        )
      ),
      ''
    ),
    'untitled'
  )
$$ LANGUAGE sql IMMUTABLE;

-- Post privacy helper (recursive)
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


-- ============================================================
-- 4. Core Triggers
-- ============================================================

-- Auto-update updated_at
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER tickets_updated_at BEFORE UPDATE ON tickets
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER profiles_updated_at BEFORE UPDATE ON profiles
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- Auto-create profile on auth.users INSERT (rejects reserved display names)
CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER AS $$
DECLARE
  _display_name TEXT;
BEGIN
  _display_name := COALESCE(
    NEW.raw_user_meta_data->>'display_name',
    NEW.raw_user_meta_data->>'name',
    split_part(NEW.email, '@', 1)
  );

  IF _display_name LIKE 'Deleted User #%' THEN
    RAISE EXCEPTION 'Display names starting with "Deleted User #" are reserved';
  END IF;

  INSERT INTO public.profiles (id, email, display_name)
  VALUES (NEW.id, NEW.email, _display_name);

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION handle_new_user();

-- Ticket creation rate limit
CREATE OR REPLACE FUNCTION check_ticket_rate_limit()
RETURNS TRIGGER AS $$
DECLARE
  ticket_count INTEGER;
  rate_limit INTEGER;
  user_role_val user_role;
BEGIN
  -- Service-role / internal calls bypass rate limiting
  IF auth.uid() IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT role INTO user_role_val FROM profiles WHERE id = NEW.creator_id;
  IF user_role_val IN ('agent', 'admin') THEN
    RETURN NEW;
  END IF;

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

-- Ticket search_vector: title + original post body
CREATE OR REPLACE FUNCTION update_ticket_search_vector()
RETURNS TRIGGER AS $$
BEGIN
  NEW.search_vector := to_tsvector('english',
    COALESCE(NEW.title, '') || ' ' ||
    COALESCE((SELECT body FROM posts WHERE ticket_id = NEW.id AND is_original = true LIMIT 1), '')
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER tickets_search_vector
  BEFORE INSERT OR UPDATE OF title ON tickets
  FOR EACH ROW EXECUTE FUNCTION update_ticket_search_vector();

-- Refresh ticket search_vector when the original post changes
CREATE OR REPLACE FUNCTION update_ticket_search_on_post()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.is_original THEN
    UPDATE tickets SET search_vector = to_tsvector('english',
      COALESCE(title, '') || ' ' || COALESCE(NEW.body, '')
    ) WHERE id = NEW.ticket_id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER posts_update_ticket_search
  AFTER INSERT OR UPDATE OF body ON posts
  FOR EACH ROW EXECUTE FUNCTION update_ticket_search_on_post();

-- Update ticket.updated_at on new post
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

-- Prevent 3rd-level nesting: a comment cannot be a reply to a comment that already has a parent_comment_id
CREATE OR REPLACE FUNCTION check_comment_nesting()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.parent_comment_id IS NOT NULL THEN
    -- Check if the parent comment is itself a reply to another comment
    IF EXISTS (
      SELECT 1 FROM posts
      WHERE id = NEW.parent_comment_id
      AND parent_comment_id IS NOT NULL
    ) THEN
      RAISE EXCEPTION 'Comments can only be nested up to 2 levels';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER enforce_comment_nesting
  BEFORE INSERT ON posts
  FOR EACH ROW
  WHEN (NEW.post_type = 'comment')
  EXECUTE FUNCTION check_comment_nesting();

-- Update tickets.updated_at when a post is published from draft
CREATE OR REPLACE FUNCTION update_ticket_on_draft_publish()
RETURNS TRIGGER AS $$
BEGIN
  IF OLD.is_draft = true AND NEW.is_draft = false THEN
    UPDATE tickets SET updated_at = now() WHERE id = NEW.ticket_id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER posts_draft_publish_timestamp
  AFTER UPDATE OF is_draft ON posts
  FOR EACH ROW
  EXECUTE FUNCTION update_ticket_on_draft_publish();


-- ============================================================
-- 5. Core RLS Policies
-- ============================================================

ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE teams ENABLE ROW LEVEL SECURITY;
ALTER TABLE subscription_tiers ENABLE ROW LEVEL SECURITY;
ALTER TABLE ticket_types ENABLE ROW LEVEL SECURITY;
ALTER TABLE categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE tags ENABLE ROW LEVEL SECURITY;
ALTER TABLE tickets ENABLE ROW LEVEL SECURITY;
ALTER TABLE posts ENABLE ROW LEVEL SECURITY;
ALTER TABLE ticket_tags ENABLE ROW LEVEL SECURITY;
ALTER TABLE ticket_followers ENABLE ROW LEVEL SECURITY;
ALTER TABLE activity_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE login_attempts ENABLE ROW LEVEL SECURITY;
ALTER TABLE saved_views ENABLE ROW LEVEL SECURITY;
ALTER TABLE app_settings ENABLE ROW LEVEL SECURITY;

-- ========== profiles ==========
CREATE POLICY profiles_select ON profiles
  FOR SELECT TO authenticated
  USING (true);

-- Users may update their own profile but must not change their role,
-- blocked status, email (managed by auth.users) or tier assignment.
CREATE POLICY profiles_update ON profiles
  FOR UPDATE TO authenticated
  USING (id = auth.uid())
  WITH CHECK (
    id = auth.uid()
    AND role = (SELECT role FROM profiles WHERE id = auth.uid())
    AND is_blocked = (SELECT is_blocked FROM profiles WHERE id = auth.uid())
    AND email = (SELECT email FROM profiles WHERE id = auth.uid())
    AND tier_id IS NOT DISTINCT FROM (SELECT tier_id FROM profiles WHERE id = auth.uid())
    AND tier_expires_at IS NOT DISTINCT FROM (SELECT tier_expires_at FROM profiles WHERE id = auth.uid())
  );

-- ========== teams ==========
CREATE POLICY teams_select ON teams
  FOR SELECT TO authenticated
  USING (true);

CREATE POLICY teams_insert ON teams
  FOR INSERT TO authenticated
  WITH CHECK (is_admin());

CREATE POLICY teams_update ON teams
  FOR UPDATE TO authenticated
  USING (is_admin())
  WITH CHECK (is_admin());

CREATE POLICY teams_delete ON teams
  FOR DELETE TO authenticated
  USING (is_admin());

-- ========== subscription_tiers ==========
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

-- ========== ticket_types ==========
CREATE POLICY ticket_types_select ON ticket_types
  FOR SELECT TO authenticated
  USING (true);

CREATE POLICY ticket_types_insert ON ticket_types
  FOR INSERT TO authenticated
  WITH CHECK (is_admin());

CREATE POLICY ticket_types_update ON ticket_types
  FOR UPDATE TO authenticated
  USING (is_admin())
  WITH CHECK (is_admin());

CREATE POLICY ticket_types_delete ON ticket_types
  FOR DELETE TO authenticated
  USING (is_admin());

-- ========== categories ==========
CREATE POLICY categories_select ON categories
  FOR SELECT TO authenticated
  USING (true);

CREATE POLICY categories_insert ON categories
  FOR INSERT TO authenticated
  WITH CHECK (is_admin());

CREATE POLICY categories_update ON categories
  FOR UPDATE TO authenticated
  USING (is_admin())
  WITH CHECK (is_admin());

CREATE POLICY categories_delete ON categories
  FOR DELETE TO authenticated
  USING (is_admin());

-- ========== tags ==========
CREATE POLICY tags_select ON tags
  FOR SELECT TO authenticated
  USING (true);

CREATE POLICY tags_insert ON tags
  FOR INSERT TO authenticated
  WITH CHECK (is_admin());

CREATE POLICY tags_update ON tags
  FOR UPDATE TO authenticated
  USING (is_admin())
  WITH CHECK (is_admin());

CREATE POLICY tags_delete ON tags
  FOR DELETE TO authenticated
  USING (is_admin());

-- ========== tickets ==========
CREATE POLICY tickets_select ON tickets
  FOR SELECT TO authenticated
  USING (
    is_agent()
    OR creator_id = auth.uid()
    OR NOT is_private
    OR is_teammate(creator_id)
  );

-- Allow anon to read public tickets (for public browsing feature)
CREATE POLICY tickets_select_anon ON tickets
  FOR SELECT TO anon
  USING (NOT is_private);

CREATE POLICY tickets_insert ON tickets
  FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = creator_id AND NOT is_blocked());

CREATE POLICY tickets_update ON tickets
  FOR UPDATE TO authenticated
  USING (
    creator_id = auth.uid()
    OR is_agent()
  )
  WITH CHECK (
    creator_id = auth.uid()
    OR is_agent()
  );

CREATE POLICY tickets_delete ON tickets
  FOR DELETE TO authenticated
  USING (is_admin());

-- ========== posts ==========
CREATE POLICY posts_select ON posts
  FOR SELECT TO authenticated
  USING (
    -- Notes: agents only
    (post_type = 'note' AND is_agent())
    OR
    -- Drafts: agents only
    (is_draft AND is_agent())
    OR
    -- Non-draft, non-note posts
    (post_type != 'note' AND NOT is_draft AND (
      -- Public posts on visible tickets (non-private, non-draft, root not private)
      (NOT is_private AND NOT is_draft
       AND (parent_post_id IS NULL OR NOT COALESCE(get_root_post_is_private(id), false))
       AND EXISTS (
        SELECT 1 FROM tickets t WHERE t.id = posts.ticket_id AND (
          is_agent()
          OR t.creator_id = auth.uid()
          OR NOT t.is_private
          OR is_teammate(t.creator_id)
        )
      ))
      OR
      -- Private posts / comments that inherit privacy from root post
      (
        (is_private OR (parent_post_id IS NOT NULL AND get_root_post_is_private(id)))
        AND (
          author_id = auth.uid()
          OR auth.uid() = (SELECT creator_id FROM tickets WHERE id = ticket_id)
          OR is_teammate((SELECT creator_id FROM tickets WHERE id = ticket_id))
          OR is_agent()
        )
      )
    ))
  );

-- Allow anon to read public posts on public tickets
CREATE POLICY posts_select_anon ON posts
  FOR SELECT TO anon
  USING (
    post_type != 'note'
    AND NOT is_draft
    AND NOT is_private
    AND (parent_post_id IS NULL OR NOT get_root_post_is_private(id))
    AND EXISTS (
      SELECT 1 FROM tickets t WHERE t.id = posts.ticket_id AND NOT t.is_private
    )
  );

CREATE POLICY posts_insert ON posts
  FOR INSERT TO authenticated
  WITH CHECK (
    auth.uid() = author_id
    AND NOT is_blocked()
    AND EXISTS (
      SELECT 1 FROM tickets t WHERE t.id = ticket_id AND (
        is_agent()
        OR t.creator_id = auth.uid()
        OR NOT t.is_private
        OR is_teammate(t.creator_id)
      )
    )
    -- Non-agents cannot post on duplicate tickets
    AND (
      is_agent()
      OR NOT EXISTS (
        SELECT 1 FROM tickets t WHERE t.id = ticket_id AND t.duplicate_of_id IS NOT NULL
      )
    )
  );

CREATE POLICY posts_update ON posts
  FOR UPDATE TO authenticated
  USING (
    -- Author can edit own posts
    author_id = auth.uid()
    -- Agents can edit any post/comment but only own notes
    OR (is_agent() AND (post_type != 'note' OR author_id = auth.uid()))
  )
  WITH CHECK (
    author_id = auth.uid()
    OR (is_agent() AND (post_type != 'note' OR author_id = auth.uid()))
  );

CREATE POLICY posts_delete ON posts
  FOR DELETE TO authenticated
  USING (
    -- Cannot delete original post
    NOT is_original
    AND (
      -- Agents can delete posts/comments (not their notes by other agents)
      (is_agent() AND post_type != 'note')
      -- Agents can delete own notes
      OR (is_agent() AND post_type = 'note' AND author_id = auth.uid())
      -- Admins can delete any note
      OR (is_admin() AND post_type = 'note')
    )
  );

-- ========== ticket_tags ==========
-- Tag associations respect ticket privacy
CREATE POLICY ticket_tags_select ON ticket_tags
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM tickets t WHERE t.id = ticket_tags.ticket_id AND (
        is_agent()
        OR t.creator_id = auth.uid()
        OR NOT t.is_private
        OR is_teammate(t.creator_id)
      )
    )
  );

-- Agents, or ticket creators with the add_remove_tags tier capability
CREATE POLICY ticket_tags_insert ON ticket_tags
  FOR INSERT TO authenticated
  WITH CHECK (
    is_agent()
    OR (
      EXISTS (SELECT 1 FROM tickets WHERE id = ticket_tags.ticket_id AND creator_id = auth.uid())
      AND user_has_tier_capability('add_remove_tags')
    )
  );

CREATE POLICY ticket_tags_update ON ticket_tags
  FOR UPDATE TO authenticated
  USING (is_agent())
  WITH CHECK (is_agent());

CREATE POLICY ticket_tags_delete ON ticket_tags
  FOR DELETE TO authenticated
  USING (
    is_agent()
    OR (
      EXISTS (SELECT 1 FROM tickets WHERE id = ticket_tags.ticket_id AND creator_id = auth.uid())
      AND user_has_tier_capability('add_remove_tags')
    )
  );

-- ========== ticket_followers ==========
CREATE POLICY ticket_followers_select ON ticket_followers
  FOR SELECT TO authenticated
  USING (
    user_id = auth.uid()
    OR is_agent()
  );

CREATE POLICY ticket_followers_insert ON ticket_followers
  FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());

CREATE POLICY ticket_followers_delete ON ticket_followers
  FOR DELETE TO authenticated
  USING (user_id = auth.uid());

-- ========== activity_log ==========
CREATE POLICY activity_log_select ON activity_log
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM tickets t WHERE t.id = activity_log.ticket_id AND (
        is_agent()
        OR t.creator_id = auth.uid()
        OR NOT t.is_private
        OR is_teammate(t.creator_id)
      )
    )
  );

CREATE POLICY activity_log_insert ON activity_log
  FOR INSERT TO authenticated
  WITH CHECK (is_agent() OR actor_id = auth.uid());

-- ========== login_attempts ==========
-- No policies for authenticated or anon — accessed only via service_role

-- ========== saved_views ==========
CREATE POLICY saved_views_select ON saved_views
  FOR SELECT TO authenticated
  USING (agent_id = auth.uid() AND is_agent());

CREATE POLICY saved_views_insert ON saved_views
  FOR INSERT TO authenticated
  WITH CHECK (agent_id = auth.uid() AND is_agent());

CREATE POLICY saved_views_update ON saved_views
  FOR UPDATE TO authenticated
  USING (agent_id = auth.uid() AND is_agent())
  WITH CHECK (agent_id = auth.uid() AND is_agent());

CREATE POLICY saved_views_delete ON saved_views
  FOR DELETE TO authenticated
  USING (agent_id = auth.uid() AND is_agent());

-- ========== app_settings ==========
CREATE POLICY app_settings_select ON app_settings
  FOR SELECT TO authenticated
  USING (true);

-- Allow anonymous users to read the kb_visible setting (public help center)
CREATE POLICY app_settings_kb_visible_anon ON app_settings
  FOR SELECT TO anon
  USING (key = 'kb_visible');

CREATE POLICY app_settings_insert ON app_settings
  FOR INSERT TO authenticated
  WITH CHECK (is_admin());

CREATE POLICY app_settings_update ON app_settings
  FOR UPDATE TO authenticated
  USING (is_admin())
  WITH CHECK (is_admin());

CREATE POLICY app_settings_delete ON app_settings
  FOR DELETE TO authenticated
  USING (is_admin());


-- ============================================================
-- 6. Agent Tickets VIEW
-- ============================================================

CREATE VIEW agent_tickets WITH (security_invoker = true) AS
SELECT
  t.*,
  p.display_name AS creator_display_name,
  p.email AS creator_email,
  p.team_id AS creator_team_id,
  tm.name AS creator_team_name,
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
  ap.display_name AS agent_display_name,
  tt.name AS type_name,
  c.name AS category_name,
  (SELECT count(*) FROM posts WHERE ticket_id = t.id AND post_type = 'post') AS post_count
FROM tickets t
JOIN profiles p ON t.creator_id = p.id
LEFT JOIN subscription_tiers st ON st.id = p.tier_id
LEFT JOIN teams tm ON p.team_id = tm.id
LEFT JOIN profiles ap ON t.assigned_agent_id = ap.id
LEFT JOIN ticket_types tt ON t.type_id = tt.id
LEFT JOIN categories c ON t.category_id = c.id;


-- ============================================================
-- 7. Admin
-- ============================================================

-- Admin audit log
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

CREATE POLICY admin_audit_log_select ON admin_audit_log
  FOR SELECT USING (is_admin());

CREATE POLICY admin_audit_log_insert ON admin_audit_log
  FOR INSERT WITH CHECK (is_admin());

-- Custom fields
CREATE TABLE custom_fields (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL UNIQUE,
  field_type TEXT NOT NULL CHECK (field_type IN ('text', 'number', 'dropdown', 'checkbox', 'date')),
  is_required BOOLEAN NOT NULL DEFAULT false,
  default_value TEXT,
  options JSONB,
  display_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE custom_fields ENABLE ROW LEVEL SECURITY;

CREATE POLICY custom_fields_select ON custom_fields
  FOR SELECT USING (auth.uid() IS NOT NULL);

CREATE POLICY custom_fields_insert ON custom_fields
  FOR INSERT WITH CHECK (is_admin());

CREATE POLICY custom_fields_update ON custom_fields
  FOR UPDATE USING (is_admin());

CREATE POLICY custom_fields_delete ON custom_fields
  FOR DELETE USING (is_admin());

-- Notification templates (seeded in section 19)
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


-- ============================================================
-- 8. File Attachments & Storage
-- ============================================================
-- Three kinds of attachment rows:
--   * Post-bound: post_id set, storage_path set.
--   * Inline "orphan": uploaded from the Markdown editor (paste / drop /
--     toolbar) before the parent post exists. post_id is NULL and
--     uploader_id is set; the row is claimed by
--     `claim_inline_attachments(post_id, body)` once the post is saved.
--   * Migrated from the legacy AnswerDesk system: stored flat in the
--     bucket under `migrated/{legacy_blob_id}` with a NULL storage_path.
--     These are read-only; to replace one the user deletes the row and
--     re-uploads.

CREATE TABLE attachments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  post_id UUID REFERENCES posts(id) ON DELETE CASCADE,
  uploader_id UUID REFERENCES profiles(id) ON DELETE CASCADE,
  storage_path TEXT,
  legacy_blob_id UUID,
  original_filename TEXT NOT NULL CHECK (char_length(original_filename) <= 255),
  file_size BIGINT NOT NULL,
  mime_type TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT attachments_post_or_uploader CHECK (
    post_id IS NOT NULL OR uploader_id IS NOT NULL
  ),
  CONSTRAINT attachments_has_path CHECK (
    storage_path IS NOT NULL OR legacy_blob_id IS NOT NULL
  )
);

CREATE INDEX idx_attachments_post_id ON attachments (post_id);
CREATE INDEX idx_attachments_uploader_orphan
  ON attachments (uploader_id)
  WHERE post_id IS NULL;

ALTER TABLE attachments ENABLE ROW LEVEL SECURITY;

-- Post-bound attachments inherit post visibility; orphans are visible to their uploader only
CREATE POLICY attachments_select ON attachments
  FOR SELECT TO authenticated USING (
    (
      post_id IS NOT NULL
      AND EXISTS (SELECT 1 FROM posts p WHERE p.id = attachments.post_id)
    )
    OR (post_id IS NULL AND uploader_id = auth.uid())
  );

-- Post author or agent can attach to a post; non-blocked users can create orphans
CREATE POLICY attachments_insert ON attachments
  FOR INSERT WITH CHECK (
    (
      post_id IS NOT NULL
      AND EXISTS (
        SELECT 1 FROM posts p
        WHERE p.id = attachments.post_id
          AND (p.author_id = auth.uid() OR is_agent())
      )
    )
    OR (
      post_id IS NULL
      AND uploader_id = auth.uid()
      AND NOT is_blocked()
    )
  );

-- An UPDATE policy is required so that `claim_inline_attachments`
-- can move an orphan row onto a freshly-created post (the function
-- runs as the authenticated user, not SECURITY DEFINER).
CREATE POLICY attachments_update ON attachments
  FOR UPDATE USING (
    post_id IS NULL AND uploader_id = auth.uid()
  ) WITH CHECK (
    uploader_id = auth.uid()
    AND (
      post_id IS NULL
      OR EXISTS (
        SELECT 1 FROM posts p
        WHERE p.id = attachments.post_id
          AND (p.author_id = auth.uid() OR is_agent())
      )
    )
  );

CREATE POLICY attachments_delete ON attachments
  FOR DELETE USING (
    (
      post_id IS NOT NULL
      AND EXISTS (
        SELECT 1 FROM posts p
        WHERE p.id = attachments.post_id
          AND (p.author_id = auth.uid() OR is_agent())
      )
    )
    OR (
      post_id IS NULL
      AND uploader_id = auth.uid()
      AND NOT is_blocked()
    )
  );

-- Storage bucket. Created here (not only via supabase/config.toml, which
-- runs on `supabase start` but not on `supabase db reset`) so every fresh
-- database has it. No bucket-level size cap: migrated files may exceed
-- 10 MB, and the per-upload limit for users is enforced by the
-- uploadAttachments / uploadInlineAttachment Server Actions via
-- app_settings.max_file_size_mb.
INSERT INTO storage.buckets (id, name, public, file_size_limit)
VALUES ('attachments', 'attachments', false, NULL)
ON CONFLICT (id) DO UPDATE SET file_size_limit = NULL;

-- Authenticated users can upload to the attachments bucket
CREATE POLICY storage_attachments_insert ON storage.objects
  FOR INSERT WITH CHECK (
    bucket_id = 'attachments' AND auth.uid() IS NOT NULL
  );

-- Authenticated users can read (for signed URLs)
CREATE POLICY storage_attachments_select ON storage.objects
  FOR SELECT USING (
    bucket_id = 'attachments' AND auth.uid() IS NOT NULL
  );

-- Only owner or agent can update storage objects
CREATE POLICY storage_attachments_update ON storage.objects
  FOR UPDATE USING (
    bucket_id = 'attachments'
    AND (owner_id = auth.uid()::text OR is_agent())
  );

-- Only owner or agent can delete storage objects
CREATE POLICY storage_attachments_delete ON storage.objects
  FOR DELETE USING (
    bucket_id = 'attachments'
    AND (owner_id = auth.uid()::text OR is_agent())
  );


-- ============================================================
-- 9. Email Notifications
-- ============================================================

-- Email configuration (a single row is used; seeded in section 19)
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

-- User notification preferences
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

-- Notification coalescing queue
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

-- Deny all via RLS; only service_role (which bypasses RLS) accesses this table
CREATE POLICY coalescing_queue_deny_all ON notification_coalescing_queue
  FOR ALL USING (false);


-- ============================================================
-- 10. In-App Notifications & Realtime
-- ============================================================

CREATE TABLE notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  recipient_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL,
  ticket_id BIGINT REFERENCES tickets(id) ON DELETE CASCADE,
  message TEXT NOT NULL,
  is_read BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_notifications_recipient_unread
  ON notifications (recipient_id, is_read, created_at DESC)
  WHERE is_read = false;

CREATE INDEX idx_notifications_recipient_created
  ON notifications (recipient_id, created_at DESC);

ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;

-- Users can only see their own notifications
CREATE POLICY notifications_select ON notifications
  FOR SELECT USING (auth.uid() = recipient_id);

-- Insert via service role only (notifications are system-generated)
CREATE POLICY notifications_insert ON notifications
  FOR INSERT TO service_role WITH CHECK (true);

-- Users can update their own notifications (mark read/unread)
CREATE POLICY notifications_update ON notifications
  FOR UPDATE USING (auth.uid() = recipient_id);

-- Users can delete their own notifications (for cleanup)
CREATE POLICY notifications_delete ON notifications
  FOR DELETE USING (auth.uid() = recipient_id);

-- Realtime publication for live updates
ALTER PUBLICATION supabase_realtime ADD TABLE posts;
ALTER PUBLICATION supabase_realtime ADD TABLE tickets;
ALTER PUBLICATION supabase_realtime ADD TABLE notifications;


-- ============================================================
-- 11. CSAT (Customer Satisfaction)
-- ============================================================

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

-- Service role only — no direct public/user access to CSAT tokens or feedback
CREATE POLICY csat_ratings_select_by_token ON csat_ratings
  FOR SELECT TO service_role USING (true);

-- Insert via service role (system-generated tokens)
CREATE POLICY csat_ratings_insert ON csat_ratings
  FOR INSERT TO service_role WITH CHECK (true);

-- Update via service role (rating submission)
CREATE POLICY csat_ratings_update ON csat_ratings
  FOR UPDATE TO service_role USING (true);

-- CSAT survey schedule.
-- Intentionally no DB-side pg_cron job marks rows as sent: setting
-- `is_sent = true` without going through the real email delivery path
-- would cause pending surveys to be permanently skipped by
-- application-side processors that select only `is_sent = false` rows.
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
  FOR SELECT TO service_role USING (true);
CREATE POLICY csat_survey_schedule_insert ON csat_survey_schedule
  FOR INSERT TO service_role WITH CHECK (true);
CREATE POLICY csat_survey_schedule_update ON csat_survey_schedule
  FOR UPDATE TO service_role USING (true);


-- ============================================================
-- 12. SLA Policies
-- ============================================================

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

-- Severity -> SLA policy mapping (one row per severity; seeded in section 19)
CREATE TABLE sla_severity_mapping (
  severity priority_level PRIMARY KEY,
  sla_policy_id UUID REFERENCES sla_policies(id) ON DELETE SET NULL
);

ALTER TABLE sla_severity_mapping ENABLE ROW LEVEL SECURITY;

CREATE POLICY sla_severity_mapping_select ON sla_severity_mapping
  FOR SELECT USING (auth.uid() IS NOT NULL);
CREATE POLICY sla_severity_mapping_update ON sla_severity_mapping
  FOR UPDATE USING (is_admin());

-- SLA timers
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
  first_response_last_resumed_at TIMESTAMPTZ,
  resolution_last_resumed_at TIMESTAMPTZ,
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

CREATE POLICY sla_timers_select ON sla_timers
  FOR SELECT USING (is_agent());
CREATE POLICY sla_timers_insert ON sla_timers
  FOR INSERT WITH CHECK (auth.role() = 'service_role');
CREATE POLICY sla_timers_update ON sla_timers
  FOR UPDATE USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');
CREATE POLICY sla_timers_delete ON sla_timers
  FOR DELETE USING (auth.role() = 'service_role');

-- SLA notifications sent (dedup tracking)
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
  FOR INSERT WITH CHECK (auth.role() = 'service_role');


-- ============================================================
-- 13. Knowledge Base
-- ============================================================

-- KB categories
CREATE TABLE kb_categories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL UNIQUE CHECK (char_length(name) <= 100),
  display_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE kb_categories ENABLE ROW LEVEL SECURITY;

CREATE POLICY kb_categories_select ON kb_categories
  FOR SELECT USING (true);
CREATE POLICY kb_categories_insert ON kb_categories
  FOR INSERT WITH CHECK (is_admin());
CREATE POLICY kb_categories_update ON kb_categories
  FOR UPDATE USING (is_admin());
CREATE POLICY kb_categories_delete ON kb_categories
  FOR DELETE USING (is_admin());

-- KB articles
CREATE TABLE kb_articles (
  id BIGSERIAL PRIMARY KEY,
  title TEXT NOT NULL CHECK (char_length(title) <= 300),
  slug TEXT NOT NULL,
  body TEXT NOT NULL CHECK (char_length(body) <= 100000),
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published', 'archived')),
  category_id UUID REFERENCES kb_categories(id) ON DELETE SET NULL,
  author_id UUID NOT NULL REFERENCES profiles(id),
  last_editor_id UUID REFERENCES profiles(id),
  source_ticket_id BIGINT REFERENCES tickets(id) ON DELETE SET NULL,
  helpful_count INTEGER NOT NULL DEFAULT 0,
  not_helpful_count INTEGER NOT NULL DEFAULT 0,
  search_vector tsvector,
  edited_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_kb_articles_status ON kb_articles (status);
CREATE INDEX idx_kb_articles_category_id ON kb_articles (category_id);
CREATE INDEX idx_kb_articles_author_id ON kb_articles (author_id);
CREATE INDEX idx_kb_articles_search ON kb_articles USING GIN (search_vector);

-- tickets <-> kb_articles reference each other
ALTER TABLE tickets
  ADD CONSTRAINT tickets_source_article_id_fkey
  FOREIGN KEY (source_article_id) REFERENCES kb_articles(id) ON DELETE SET NULL;

-- Full-text search on KB articles
CREATE OR REPLACE FUNCTION update_kb_article_search_vector()
RETURNS TRIGGER AS $$
BEGIN
  NEW.search_vector := to_tsvector('english',
    COALESCE(NEW.title, '') || ' ' || COALESCE(NEW.body, '')
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_kb_article_search_vector
  BEFORE INSERT OR UPDATE OF title, body ON kb_articles
  FOR EACH ROW EXECUTE FUNCTION update_kb_article_search_vector();

ALTER TABLE kb_articles ENABLE ROW LEVEL SECURITY;

-- Published/archived articles: public only when kb_visible is enabled
-- Draft articles: agents only
CREATE POLICY kb_articles_select ON kb_articles
  FOR SELECT USING (
    is_agent()
    OR (
      status IN ('published', 'archived')
      AND EXISTS (
        SELECT 1 FROM app_settings WHERE key = 'kb_visible' AND value = 'true'
      )
    )
  );

-- Agents can create/edit articles
CREATE POLICY kb_articles_insert ON kb_articles
  FOR INSERT WITH CHECK (is_agent() AND author_id = auth.uid());
CREATE POLICY kb_articles_update ON kb_articles
  FOR UPDATE USING (is_agent());
CREATE POLICY kb_articles_delete ON kb_articles
  FOR DELETE USING (is_agent());

-- KB article feedback
CREATE TABLE kb_article_feedback (
  article_id BIGINT NOT NULL REFERENCES kb_articles(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  is_helpful BOOLEAN NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (article_id, user_id)
);

ALTER TABLE kb_article_feedback ENABLE ROW LEVEL SECURITY;

CREATE POLICY kb_article_feedback_select ON kb_article_feedback
  FOR SELECT USING (auth.uid() = user_id OR is_agent());
CREATE POLICY kb_article_feedback_insert ON kb_article_feedback
  FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY kb_article_feedback_update ON kb_article_feedback
  FOR UPDATE USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);
CREATE POLICY kb_article_feedback_delete ON kb_article_feedback
  FOR DELETE USING (auth.uid() = user_id);

-- Maintain feedback counts
CREATE OR REPLACE FUNCTION update_kb_article_feedback_counts()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.is_helpful THEN
      UPDATE kb_articles SET helpful_count = helpful_count + 1 WHERE id = NEW.article_id;
    ELSE
      UPDATE kb_articles SET not_helpful_count = not_helpful_count + 1 WHERE id = NEW.article_id;
    END IF;
  ELSIF TG_OP = 'UPDATE' THEN
    IF OLD.is_helpful AND NOT NEW.is_helpful THEN
      UPDATE kb_articles SET helpful_count = helpful_count - 1, not_helpful_count = not_helpful_count + 1 WHERE id = NEW.article_id;
    ELSIF NOT OLD.is_helpful AND NEW.is_helpful THEN
      UPDATE kb_articles SET helpful_count = helpful_count + 1, not_helpful_count = not_helpful_count - 1 WHERE id = NEW.article_id;
    END IF;
  ELSIF TG_OP = 'DELETE' THEN
    IF OLD.is_helpful THEN
      UPDATE kb_articles SET helpful_count = helpful_count - 1 WHERE id = OLD.article_id;
    ELSE
      UPDATE kb_articles SET not_helpful_count = not_helpful_count - 1 WHERE id = OLD.article_id;
    END IF;
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER trg_kb_article_feedback_counts
  AFTER INSERT OR UPDATE OR DELETE ON kb_article_feedback
  FOR EACH ROW EXECUTE FUNCTION update_kb_article_feedback_counts();


-- ============================================================
-- 14. User Notes
-- ============================================================

CREATE TABLE user_notes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  target_user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  author_id UUID NOT NULL REFERENCES profiles(id),
  body TEXT NOT NULL CHECK (char_length(body) <= 10000),
  edited_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_user_notes_target_user_id ON user_notes (target_user_id);
CREATE INDEX idx_user_notes_author_id ON user_notes (author_id);

ALTER TABLE user_notes ENABLE ROW LEVEL SECURITY;

-- Only agents can see user notes
CREATE POLICY user_notes_select ON user_notes
  FOR SELECT USING (is_agent());

-- Only agents can create user notes, and only as themselves
CREATE POLICY user_notes_insert ON user_notes
  FOR INSERT WITH CHECK (is_agent() AND auth.uid() = author_id);

-- Agent can edit own notes only
CREATE POLICY user_notes_update ON user_notes
  FOR UPDATE
  USING (auth.uid() = author_id AND is_agent())
  WITH CHECK (auth.uid() = author_id AND is_agent());

-- Agent can delete own notes; admin can delete any
CREATE POLICY user_notes_delete ON user_notes
  FOR DELETE USING (
    (auth.uid() = author_id AND is_agent())
    OR is_admin()
  );

-- Prevent reassignment of author_id or target_user_id on update
CREATE FUNCTION prevent_user_notes_reassignment()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.author_id IS DISTINCT FROM OLD.author_id THEN
    RAISE EXCEPTION 'author_id cannot be changed';
  END IF;

  IF NEW.target_user_id IS DISTINCT FROM OLD.target_user_id THEN
    RAISE EXCEPTION 'target_user_id cannot be changed';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER user_notes_prevent_reassignment
  BEFORE UPDATE ON user_notes
  FOR EACH ROW
  EXECUTE FUNCTION prevent_user_notes_reassignment();


-- ============================================================
-- 15. Canned Responses
-- ============================================================

CREATE TABLE canned_responses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL CHECK (char_length(title) <= 200),
  body TEXT NOT NULL CHECK (char_length(body) <= 50000),
  visibility TEXT NOT NULL DEFAULT 'private' CHECK (visibility IN ('public', 'private')),
  author_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_canned_responses_author_id ON canned_responses (author_id);
CREATE INDEX idx_canned_responses_visibility ON canned_responses (visibility);

ALTER TABLE canned_responses ENABLE ROW LEVEL SECURITY;

-- Agents can see: their own private + all public
CREATE POLICY canned_responses_select ON canned_responses
  FOR SELECT TO authenticated USING (
    is_agent() AND (
      visibility = 'public'
      OR author_id = auth.uid()
    )
  );

-- Agents can create
CREATE POLICY canned_responses_insert ON canned_responses
  FOR INSERT TO authenticated WITH CHECK (is_agent() AND author_id = auth.uid());

-- Agent can edit own; admin can edit any public
CREATE POLICY canned_responses_update ON canned_responses
  FOR UPDATE TO authenticated USING (
    (auth.uid() = author_id AND is_agent())
    OR (visibility = 'public' AND is_admin())
  );

-- Agent can delete own; admin can delete any public
CREATE POLICY canned_responses_delete ON canned_responses
  FOR DELETE TO authenticated USING (
    (auth.uid() = author_id AND is_agent())
    OR (visibility = 'public' AND is_admin())
  );


-- ============================================================
-- 16. Inbound Email
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


-- ============================================================
-- 17. AI Features
-- ============================================================

-- AI usage tracking (for monthly usage counter)
CREATE TABLE ai_usage_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id UUID REFERENCES profiles(id) ON DELETE SET NULL,
  feature TEXT NOT NULL CHECK (feature IN (
    'auto_categorize', 'duplicate_detection',
    'suggested_reply', 'ticket_summary',
    'generate_kb_article', 'ai_filter'
  )),
  tokens_used INTEGER DEFAULT 0 CHECK (tokens_used >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_ai_usage_log_created_at ON ai_usage_log (created_at);
CREATE INDEX idx_ai_usage_log_agent_feature ON ai_usage_log (agent_id, feature, created_at);

ALTER TABLE ai_usage_log ENABLE ROW LEVEL SECURITY;

-- Only admins can view usage stats
CREATE POLICY ai_usage_log_select ON ai_usage_log
  FOR SELECT USING (is_admin());

-- AI rate limit tracking
CREATE TABLE ai_rate_limit_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  feature TEXT NOT NULL DEFAULT 'suggested_reply' CHECK (feature IN (
    'suggested_reply', 'auto_categorize', 'duplicate_detection',
    'ticket_summary', 'generate_kb_article'
  )),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_ai_rate_limit_log_agent_feature
  ON ai_rate_limit_log (agent_id, feature, created_at DESC);

ALTER TABLE ai_rate_limit_log ENABLE ROW LEVEL SECURITY;

-- Agents can read their own rate limit entries
CREATE POLICY ai_rate_limit_log_select ON ai_rate_limit_log
  FOR SELECT USING (auth.uid() = agent_id);

-- Ticket summary cache
CREATE TABLE ticket_summaries (
  ticket_id BIGINT PRIMARY KEY REFERENCES tickets(id) ON DELETE CASCADE,
  summary TEXT NOT NULL,
  post_count_at_generation INTEGER NOT NULL,
  generated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE ticket_summaries ENABLE ROW LEVEL SECURITY;

-- Only agents can view summaries
CREATE POLICY ticket_summaries_select ON ticket_summaries
  FOR SELECT USING (is_agent());


-- ============================================================
-- 18. Vault RPC Functions
-- ============================================================
-- All Vault helpers are SECURITY DEFINER and only ever called
-- server-side via the service-role client. PUBLIC (which in Supabase
-- includes `anon` and `authenticated`) must not be able to execute
-- them, otherwise any holder of the anon key could read secrets via
-- PostgREST RPC.

-- ---------- AI provider API key ----------

CREATE OR REPLACE FUNCTION store_ai_api_key(key_value TEXT)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Delete any existing AI API key
  DELETE FROM vault.secrets WHERE name = 'ai_api_key';
  -- Insert new secret
  PERFORM vault.create_secret(key_value, 'ai_api_key', 'AI provider API key');
END;
$$;

CREATE OR REPLACE FUNCTION get_ai_api_key()
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  result TEXT;
BEGIN
  SELECT decrypted_secret INTO result
  FROM vault.decrypted_secrets
  WHERE name = 'ai_api_key'
  LIMIT 1;
  RETURN result;
END;
$$;

CREATE OR REPLACE FUNCTION delete_ai_api_key()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  DELETE FROM vault.secrets WHERE name = 'ai_api_key';
END;
$$;

REVOKE EXECUTE ON FUNCTION store_ai_api_key(TEXT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION get_ai_api_key() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION delete_ai_api_key() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION store_ai_api_key(TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION get_ai_api_key() TO service_role;
GRANT EXECUTE ON FUNCTION delete_ai_api_key() TO service_role;

-- ---------- External tier assignment API secret ----------

CREATE OR REPLACE FUNCTION store_tier_api_secret(key_value TEXT)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  DELETE FROM vault.secrets WHERE name = 'tier_api_secret';
  PERFORM vault.create_secret(key_value, 'tier_api_secret', 'External tier assignment API shared secret');
END;
$$;

CREATE OR REPLACE FUNCTION get_tier_api_secret()
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  result TEXT;
BEGIN
  SELECT decrypted_secret INTO result
  FROM vault.decrypted_secrets
  WHERE name = 'tier_api_secret'
  LIMIT 1;
  RETURN result;
END;
$$;

CREATE OR REPLACE FUNCTION delete_tier_api_secret()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  DELETE FROM vault.secrets WHERE name = 'tier_api_secret';
END;
$$;

REVOKE EXECUTE ON FUNCTION store_tier_api_secret(TEXT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION get_tier_api_secret() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION delete_tier_api_secret() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION store_tier_api_secret(TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION get_tier_api_secret() TO service_role;
GRANT EXECUTE ON FUNCTION delete_tier_api_secret() TO service_role;

-- ---------- OAuth credentials (generic helpers) ----------

CREATE OR REPLACE FUNCTION store_oauth_secret(secret_name TEXT, secret_value TEXT, secret_description TEXT DEFAULT '')
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  DELETE FROM vault.secrets WHERE name = secret_name;
  PERFORM vault.create_secret(secret_value, secret_name, secret_description);
END;
$$;

CREATE OR REPLACE FUNCTION get_oauth_secret(secret_name TEXT)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  result TEXT;
BEGIN
  SELECT decrypted_secret INTO result
  FROM vault.decrypted_secrets
  WHERE name = secret_name
  LIMIT 1;
  RETURN result;
END;
$$;

CREATE OR REPLACE FUNCTION delete_oauth_secret(secret_name TEXT)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  DELETE FROM vault.secrets WHERE name = secret_name;
END;
$$;

CREATE OR REPLACE FUNCTION has_oauth_secret(secret_name TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  found BOOLEAN;
BEGIN
  SELECT EXISTS(SELECT 1 FROM vault.secrets WHERE name = secret_name) INTO found;
  RETURN found;
END;
$$;

REVOKE EXECUTE ON FUNCTION store_oauth_secret(TEXT, TEXT, TEXT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION get_oauth_secret(TEXT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION delete_oauth_secret(TEXT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION has_oauth_secret(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION store_oauth_secret(TEXT, TEXT, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION get_oauth_secret(TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION delete_oauth_secret(TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION has_oauth_secret(TEXT) TO service_role;


-- ============================================================
-- 19. Seed Data
-- ============================================================

-- Default ticket types
INSERT INTO ticket_types (name, is_default) VALUES
  ('Question', true),
  ('Issue', false),
  ('Suggestion', false);

-- One row per severity; admins attach SLA policies later
INSERT INTO sla_severity_mapping (severity) VALUES
  ('low'), ('medium'), ('high'), ('critical');

-- Single email configuration row
INSERT INTO email_config (id) VALUES (gen_random_uuid());

-- ---------- App settings ----------

INSERT INTO app_settings (key, value) VALUES
  -- General / tickets
  ('ticket_creation_rate_limit', '10'),
  ('allow_public_ticket_browsing', 'false'),
  ('ticket_default_privacy', 'true'),
  ('allow_user_privacy_control', 'true'),
  ('enforce_display_name_uniqueness', 'false'),

  -- Paging & thread display
  ('agent_dashboard_page_size', '20'),
  ('user_page_size', '20'),
  ('other_lists_page_size', '20'),
  ('visible_posts_threshold', '10'),
  ('visible_comments_threshold', '3'),

  -- File uploads
  ('allowed_file_types', '["png","jpg","jpeg","gif","webp","svg","pdf","doc","docx","xls","xlsx","txt","csv","md","zip","rar","7z","tar.gz"]'),
  ('max_file_size_mb', '10'),
  ('max_files_per_post', '5'),

  -- Notifications
  ('default_notification_preferences', '{"new_post":{"email":true,"in_app":true},"status_changed":{"email":true,"in_app":true},"agent_assigned":{"email":true,"in_app":true},"agent_assigned_to_agent":{"email":true,"in_app":true},"user_reply_to_agent":{"email":true,"in_app":true},"auto_reopen":{"email":true,"in_app":true}}'),
  ('notification_coalescing_delay_minutes', '2'),

  -- CSAT
  ('csat_enabled', 'false'),
  ('csat_survey_delay', '1_hour'),

  -- SLA
  ('sla_business_hours', '{"timezone":"UTC","schedule":{"monday":{"start":"09:00","end":"17:00"},"tuesday":{"start":"09:00","end":"17:00"},"wednesday":{"start":"09:00","end":"17:00"},"thursday":{"start":"09:00","end":"17:00"},"friday":{"start":"09:00","end":"17:00"},"saturday":null,"sunday":null}}'),
  ('sla_approaching_threshold', '75'),

  -- Knowledge base
  ('kb_visible', 'false'),

  -- Inbound email
  ('inbound_email_enabled', 'false'),
  ('inbound_email_reply_to_address', ''),

  -- AI
  ('ai_provider', ''),
  ('ai_custom_endpoint_url', ''),
  ('ai_model', ''),
  ('ai_request_timeout', '60'),
  ('ai_auto_categorize_enabled', 'false'),
  ('ai_auto_categorize_min_body_length', '20'),
  ('ai_duplicate_detection_enabled', 'false'),
  ('ai_duplicate_detection_threshold', 'medium'),
  ('ai_suggested_reply_enabled', 'false'),
  ('ai_suggested_reply_context_window', '20'),
  ('ai_suggested_reply_rate_limit', '20'),
  ('ai_ticket_summary_enabled', 'false'),
  ('ai_ticket_summary_min_posts', '10'),
  ('ai_generate_kb_article_enabled', 'false'),
  ('ai_filter_enabled', 'false'),

  -- Authentication
  ('auth_mode', 'built-in'),                  -- 'built-in' or 'external'
  -- Social OAuth providers (built-in mode)
  ('auth_google_enabled', 'false'),
  ('auth_github_enabled', 'false'),
  ('auth_microsoft_enabled', 'false'),
  ('auth_microsoft_tenant_id', ''),
  ('auth_gitlab_enabled', 'false'),
  ('auth_gitlab_instance_url', ''),            -- optional self-hosted URL
  -- External OAuth/OIDC provider
  -- Registered with Supabase Auth as the custom provider `custom:external`;
  -- the Supabase provider type is derived from the preset (surveyjs → oauth2).
  ('auth_external_preset', 'surveyjs'),        -- 'surveyjs' | 'oidc' | 'oauth2'
  ('auth_external_provider_name', ''),         -- display name for login button
  ('auth_external_issuer_url', ''),            -- oidc preset only
  ('auth_external_authorization_url', ''),     -- oauth2 preset only
  ('auth_external_token_url', ''),             -- oauth2 preset only
  ('auth_external_userinfo_url', ''),          -- oauth2 preset only
  ('auth_external_scopes', 'openid email profile'),
  ('auth_external_auto_redirect', 'false'),    -- auto-redirect to external provider
  ('auth_external_registered', 'false'),       -- 'true' while an enabled custom provider exists in Supabase Auth
  ('auth_external_last_error', ''),            -- last registration error, '' when the last attempt succeeded

  -- Error page templates
  ('error_template_404', '# {{statusCode}} — Page Not Found

The page you were looking for doesn''t exist.

[Go to home page]({{homeUrl}})'),
  ('error_template_403', '# {{statusCode}} — Access Denied

{{message}}

You don''t have permission to access this page.

[Go to home page]({{homeUrl}})'),
  ('error_template_500', '# {{statusCode}} — Something Went Wrong

{{message}}

An unexpected error occurred. Please try again later.

[Go to home page]({{homeUrl}})'),
  ('error_template_csat_token_error', '# Survey Unavailable

{{message}}

This survey link has expired or has already been used.

[Go to login](/login)');

-- ---------- SurveyJS UI templates ----------
--
-- Ticket Detail templates store a wrapper:
--   { "template": <SurveyJS JSON>, "tierControlRules": { ... }, "autoGenerateCustomFields": true }
-- The wrapper's `template.pages[].elements[].name` values must match
-- columns on `public.tickets` (or canonical relationship names like
-- `tag_ids` / `is_following`). Server validation enforces this.
--
-- The Agent Dashboard template's `pages[].elements[].name` values must
-- match the filter / column keys used by `getAgentTickets` (q, email,
-- status, sort, urgency, severity, type, category, agent, team, tier,
-- tags). Dynamic `choices` for type/category/agent/team/tier/tags are
-- left as the static sentinel set ("All", "Unassigned", etc.); the agent
-- dashboard server page injects the database-derived options at render
-- time. Server validation in `saveSurveyTemplate` enforces this.

INSERT INTO app_settings (key, value) VALUES
  (
    'survey_ticket_detail_agent_template',
    '{"template":{"showQuestionNumbers":"off","pages":[{"name":"sidebar","elements":[{"type":"dropdown","name":"status","title":"Status","defaultValue":"open","allowClear":false,"choices":[{"value":"pending","text":"Pending"},{"value":"open","text":"Open"},{"value":"closed","text":"Closed"}]},{"type":"dropdown","name":"urgency","title":"Urgency","startWithNewLine":false,"defaultValue":"medium","allowClear":false,"choices":[{"value":"low","text":"Low"},{"value":"medium","text":"Medium"},{"value":"high","text":"High"},{"value":"critical","text":"Critical"}]},{"type":"dropdown","name":"severity","title":"Severity","defaultValue":"medium","allowClear":false,"choices":[{"value":"low","text":"Low"},{"value":"medium","text":"Medium"},{"value":"high","text":"High"},{"value":"critical","text":"Critical"}]},{"type":"dropdown","name":"type_id","title":"Type","startWithNewLine":false,"choices":[]},{"type":"dropdown","name":"category_id","title":"Category","choices":[]},{"type":"dropdown","name":"assigned_agent_id","title":"Assigned Agent","choices":[]},{"type":"tagbox","name":"tag_ids","title":"Tags","choices":[],"showSelectAllItem":false},{"type":"boolean","name":"is_private","title":"Private ticket","renderAs":"checkbox","defaultValue":true},{"type":"boolean","name":"is_following","title":"Follow this ticket","renderAs":"checkbox","startWithNewLine":false}]}]},"tierControlRules":{"statusAllowedTiers":[],"severityAllowedTiers":[],"typeAllowedTiers":[],"tagsAllowedTiers":[],"visibilityAllowedTiers":[]},"autoGenerateCustomFields":true}'
  ),
  (
    'survey_ticket_detail_user_template',
    '{"template":{"showQuestionNumbers":"off","pages":[{"name":"sidebar","elements":[{"type":"dropdown","name":"status","title":"Status","defaultValue":"open","allowClear":false,"choices":[{"value":"pending","text":"Pending"},{"value":"open","text":"Open"},{"value":"closed","text":"Closed"}]},{"type":"dropdown","name":"urgency","title":"Urgency","startWithNewLine":false,"defaultValue":"medium","allowClear":false,"choices":[{"value":"low","text":"Low"},{"value":"medium","text":"Medium"},{"value":"high","text":"High"},{"value":"critical","text":"Critical"}]},{"type":"dropdown","name":"severity","title":"Severity","defaultValue":"medium","allowClear":false,"choices":[{"value":"low","text":"Low"},{"value":"medium","text":"Medium"},{"value":"high","text":"High"},{"value":"critical","text":"Critical"}]},{"type":"dropdown","name":"type_id","title":"Type","startWithNewLine":false,"choices":[]},{"type":"tagbox","name":"tag_ids","title":"Tags","choices":[],"showSelectAllItem":false},{"type":"boolean","name":"is_private","title":"Private ticket","renderAs":"checkbox","defaultValue":true},{"type":"boolean","name":"is_following","title":"Follow this ticket","renderAs":"checkbox","startWithNewLine":false}]}]},"tierControlRules":{"statusAllowedTiers":[],"severityAllowedTiers":[],"typeAllowedTiers":[],"tagsAllowedTiers":[],"visibilityAllowedTiers":[]},"autoGenerateCustomFields":true}'
  ),
  (
    'survey_agent_dashboard_template',
    '{"showQuestionNumbers":"off","pages":[{"name":"filters","elements":[{"type":"text","name":"q","title":"Search","inputType":"search","placeholder":"Search title & all posts..."},{"type":"text","name":"email","title":"Submitter Email","placeholder":"email@..."},{"type":"checkbox","name":"status","title":"Status","colCount":0,"minSelectedChoices":1,"choices":[{"value":"open","text":"Active"},{"value":"pending","text":"Pending"},{"value":"closed","text":"Closed"}],"defaultValue":["open","pending","closed"]},{"type":"dropdown","name":"sort","title":"Sort By","defaultValue":"","allowClear":false,"choices":[{"value":"","text":"Last Modified"},{"value":"created","text":"Created Date"},{"value":"sla","text":"SLA Risk"}]},{"type":"dropdown","name":"urgency","title":"Urgency","choices":[{"value":"","text":"All"},{"value":"low","text":"Low"},{"value":"medium","text":"Medium"},{"value":"high","text":"High"},{"value":"critical","text":"Critical"}]},{"type":"dropdown","name":"severity","title":"Severity","startWithNewLine":false,"choices":[{"value":"","text":"All"},{"value":"low","text":"Low"},{"value":"medium","text":"Medium"},{"value":"high","text":"High"},{"value":"critical","text":"Critical"}]},{"type":"dropdown","name":"type","title":"Type","choices":[{"value":"","text":"All"}]},{"type":"dropdown","name":"category","title":"Category","startWithNewLine":false,"choices":[{"value":"","text":"All"}]},{"type":"dropdown","name":"agent","title":"Assigned Agent","choices":[{"value":"","text":"All"},{"value":"unassigned","text":"Unassigned"}]},{"type":"dropdown","name":"team","title":"Team","startWithNewLine":false,"choices":[{"value":"","text":"All"},{"value":"none","text":"No team"}]},{"type":"dropdown","name":"tier","title":"Tier","startWithNewLine":false,"choices":[{"value":"","text":"All"},{"value":"none","text":"No tier"}]},{"type":"tagbox","name":"tags","title":"Tags","choices":[],"showSelectAllItem":false}]}]}'
  );

-- ---------- Notification templates ----------
-- Ticket links use `/tickets/{{ticketId}}/redirect` so the `[id]/[slug]`
-- page redirects to the canonical URL.

INSERT INTO notification_templates (event_type, subject, body) VALUES
  -- Ticket updates
  ('new_post', 'New reply on your ticket', 'There is a new reply on your ticket "{{ticketTitle}}".'),
  ('status_changed', 'Ticket status updated', 'The status of your ticket "{{ticketTitle}}" has been changed to {{newStatus}}.'),
  ('urgency_changed', 'Ticket urgency updated', 'The urgency of your ticket "{{ticketTitle}}" has been changed to {{newUrgency}}.'),
  ('severity_changed', 'Ticket severity updated', 'The severity of your ticket "{{ticketTitle}}" has been changed to {{newSeverity}}.'),
  ('privacy_changed', 'Ticket privacy updated', 'The privacy setting of your ticket "{{ticketTitle}}" has been updated.'),
  ('consolidated_update', 'Updates on your ticket', 'There have been updates to your ticket "{{ticketTitle}}":\n\n{{changeList}}'),
  ('agent_assigned', 'Agent assigned to your ticket', 'An agent has been assigned to your ticket "{{ticketTitle}}".'),
  ('agent_assigned_to_agent', 'You''ve been assigned a ticket', 'You have been assigned to ticket "{{ticketTitle}}".'),
  ('user_reply_to_agent', 'New reply on your assigned ticket', 'There is a new reply on your assigned ticket "{{ticketTitle}}" from {{authorName}}.'),
  ('auto_reopen', 'Ticket re-opened by user reply', 'Ticket "{{ticketTitle}}" has been re-opened by a new reply from {{authorName}}.'),

  -- Duplicate / merge / bulk
  ('duplicate_post', 'Ticket marked as duplicate', 'This ticket has been closed as a duplicate of [#{{ticketId}}](/tickets/{{ticketId}}/redirect).'),
  ('merge_post', 'Ticket merged', 'This ticket has been merged into [#{{ticketId}}](/tickets/{{ticketId}}/redirect).'),
  ('merge_banner', 'Merge stub banner', 'This ticket has been merged into [#{{ticketId}}](/tickets/{{ticketId}}/redirect). All posts have been moved.'),
  ('bulk_action_summary',
   '{{actionType}} applied to {{ticketCount}} tickets',
   'Agent {{actorName}} performed a bulk action: {{actionType}} on {{ticketCount}} ticket(s).\n\nAffected tickets:\n{{ticketList}}'),

  -- Clone
  -- {{ticketId}} = source ticket id; prepended to the NEW ticket's original post.
  ('clone_origin_note',
   'Cloned ticket origin note',
   'This ticket is a copy of a post from [#{{ticketId}}](/tickets/{{ticketId}}/redirect).'),
  -- Replaces the cloned comment's body in the SOURCE thread.
  -- {{userName}} = comment author, {{ticketTitle}}/{{ticketId}} = the NEW ticket.
  ('clone_comment_reply',
   'Comment cloned to a new ticket',
   'Hello {{userName}}, I created a separate ticket on your behalf: [{{ticketTitle}}](/tickets/{{ticketId}}/redirect).'),

  -- CSAT
  ('csat_survey',
   'How was your experience? Rate ticket #{{ticketId}}',
   'Hi {{userName}},

Your ticket "{{ticketTitle}}" has been resolved. We''d love to hear how we did!

Please rate your experience:
{{csatLink}}

This link expires in 30 days.

Thank you!'),
  ('csat_submitted',
   'New CSAT rating on ticket #{{ticketId}}',
   'A {{rating}}-star rating was submitted on ticket "{{ticketTitle}}" by {{userName}}.

{{comment}}'),

  -- SLA
  ('sla_approaching_first_response', 'SLA Warning: First response approaching on ticket #{{ticketId}}', 'The first response SLA target for ticket "{{ticketTitle}}" is approaching. {{elapsedTime}} of {{targetTime}} business hours elapsed ({{percentage}}%).'),
  ('sla_approaching_resolution', 'SLA Warning: Resolution approaching on ticket #{{ticketId}}', 'The resolution SLA target for ticket "{{ticketTitle}}" is approaching. {{elapsedTime}} of {{targetTime}} business hours elapsed ({{percentage}}%).'),
  ('sla_breached_first_response', 'SLA Breached: First response overdue on ticket #{{ticketId}}', 'The first response SLA target for ticket "{{ticketTitle}}" has been breached. Target was {{targetTime}} business hours; {{elapsedTime}} has elapsed.'),
  ('sla_breached_resolution', 'SLA Breached: Resolution overdue on ticket #{{ticketId}}', 'The resolution SLA target for ticket "{{ticketTitle}}" has been breached. Target was {{targetTime}} business hours; {{elapsedTime}} has elapsed.'),

  -- Inbound email auto-replies
  ('auto_reply_unknown_sender',
   'Unable to process your email',
   'Your email could not be processed because your address is not registered in our system. Please register at {{registrationUrl}} to create support tickets.'),
  ('auto_reply_blocked_user',
   'Unable to process your email',
   'Your email could not be processed because your account is currently restricted. Please contact support for assistance.'),
  ('auto_reply_duplicate_ticket',
   'Unable to process your reply',
   'Your reply could not be processed because this ticket has been closed as a duplicate. Please continue the conversation at the original ticket: [#{{originalTicketId}}](/tickets/{{originalTicketId}}/redirect).'),
  ('auto_reply_rate_limit',
   'Ticket creation limit reached',
   'Your email could not be processed because you have reached the maximum number of tickets that can be created in a 24-hour period. Please try again later or use the web interface.');


-- ============================================================
-- 20. Scheduled Jobs (only if pg_cron is available)
-- ============================================================

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    -- Daily cleanup of auto_reply_log rows older than 24 hours
    PERFORM cron.schedule(
      'cleanup-auto-reply-log',
      '0 3 * * *',
      'DELETE FROM auto_reply_log WHERE sent_at < now() - interval ''24 hours'''
    );

    -- Daily cleanup of old notifications
    PERFORM cron.schedule(
      'cleanup-notifications',
      '0 3 * * *',
      $cron$
      DELETE FROM notifications
      WHERE (is_read = true AND created_at < now() - interval '30 days')
         OR (created_at < now() - interval '90 days');
      $cron$
    );

    -- SLA monitoring every 5 minutes
    PERFORM cron.schedule(
      'check-sla-timers',
      '*/5 * * * *',
      $cron$
      SELECT net.http_post(
        url := current_setting('app.settings.base_url', true) || '/api/cron/sla',
        headers := jsonb_build_object('Authorization', 'Bearer ' || current_setting('app.settings.cron_secret', true)),
        body := '{}'
      );
      $cron$
    );
  END IF;
END
$$;
