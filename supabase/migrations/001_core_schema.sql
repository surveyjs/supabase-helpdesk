-- ============================================================
-- Phase 1 — Core Database Schema
-- ============================================================

-- --------------------------------------------------------
-- Enum Types
-- --------------------------------------------------------
CREATE TYPE user_role AS ENUM ('user', 'agent', 'admin');
CREATE TYPE ticket_status AS ENUM ('open', 'pending', 'closed');
CREATE TYPE priority_level AS ENUM ('low', 'medium', 'high', 'critical');
CREATE TYPE post_type AS ENUM ('post', 'comment', 'note');

-- --------------------------------------------------------
-- Tables (in dependency order)
-- --------------------------------------------------------

-- teams
CREATE TABLE teams (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL UNIQUE CHECK (char_length(name) <= 100),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- profiles
CREATE TABLE profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id),
  email TEXT NOT NULL,
  display_name TEXT CHECK (char_length(display_name) <= 100),
  role user_role NOT NULL DEFAULT 'user',
  team_id UUID REFERENCES teams(id) ON DELETE RESTRICT,
  is_blocked BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ticket_types
CREATE TABLE ticket_types (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL UNIQUE CHECK (char_length(name) <= 100),
  is_default BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX idx_ticket_types_one_default ON ticket_types (is_default) WHERE is_default = true;

-- Seed default ticket types
INSERT INTO ticket_types (name, is_default) VALUES
  ('Question', true),
  ('Issue', false),
  ('Suggestion', false);

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
  source_article_id BIGINT,
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
CREATE UNIQUE INDEX idx_tickets_slug ON tickets (slug);
CREATE INDEX idx_tickets_duplicate_of_id ON tickets (duplicate_of_id);
CREATE INDEX idx_tickets_merged_into_id ON tickets (merged_into_id);
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

-- app_settings
CREATE TABLE app_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Seed default settings
INSERT INTO app_settings (key, value) VALUES
  ('ticket_creation_rate_limit', '10'),
  ('allow_public_ticket_browsing', 'false'),
  ('ticket_default_privacy', 'true'),
  ('allow_user_privacy_control', 'true'),
  ('agent_dashboard_page_size', '20');

-- --------------------------------------------------------
-- Helper Functions
-- --------------------------------------------------------

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

-- --------------------------------------------------------
-- Slug Generation
-- --------------------------------------------------------

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

-- --------------------------------------------------------
-- Triggers
-- --------------------------------------------------------

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

-- Auto-create profile on auth.users INSERT
CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.profiles (id, email, display_name)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(
      NEW.raw_user_meta_data->>'display_name',
      NEW.raw_user_meta_data->>'name',
      split_part(NEW.email, '@', 1)
    )
  );
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

-- Auto-populate search_vector from title
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

-- --------------------------------------------------------
-- Post privacy helper (recursive)
-- --------------------------------------------------------

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

-- --------------------------------------------------------
-- Row-Level Security
-- --------------------------------------------------------

-- Enable RLS on all tables
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE teams ENABLE ROW LEVEL SECURITY;
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

CREATE POLICY profiles_update ON profiles
  FOR UPDATE TO authenticated
  USING (id = auth.uid())
  WITH CHECK (id = auth.uid());

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
CREATE POLICY ticket_tags_select ON ticket_tags
  FOR SELECT TO authenticated
  USING (true);

CREATE POLICY ticket_tags_insert ON ticket_tags
  FOR INSERT TO authenticated
  WITH CHECK (is_agent());

CREATE POLICY ticket_tags_update ON ticket_tags
  FOR UPDATE TO authenticated
  USING (is_agent())
  WITH CHECK (is_agent());

CREATE POLICY ticket_tags_delete ON ticket_tags
  FOR DELETE TO authenticated
  USING (is_agent());

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

-- --------------------------------------------------------
-- Agent Tickets VIEW
-- --------------------------------------------------------

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
