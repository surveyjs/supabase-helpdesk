-- ============================================================
-- Migration 012: Knowledge Base
-- ============================================================

-- KB Categories Table
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

-- KB Articles Table
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
  edited_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_kb_articles_status ON kb_articles (status);
CREATE INDEX idx_kb_articles_category_id ON kb_articles (category_id);
CREATE INDEX idx_kb_articles_author_id ON kb_articles (author_id);

-- Full-text search on KB articles
ALTER TABLE kb_articles ADD COLUMN search_vector tsvector;
CREATE INDEX idx_kb_articles_search ON kb_articles USING GIN (search_vector);

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

-- Published articles: everyone can read
-- Draft articles: agents only
-- Archived articles: everyone can read (accessible via direct URL)
CREATE POLICY kb_articles_select ON kb_articles
  FOR SELECT USING (
    status IN ('published', 'archived')
    OR is_agent()
  );

-- Agents can create/edit articles
CREATE POLICY kb_articles_insert ON kb_articles
  FOR INSERT WITH CHECK (is_agent());
CREATE POLICY kb_articles_update ON kb_articles
  FOR UPDATE USING (is_agent());
CREATE POLICY kb_articles_delete ON kb_articles
  FOR DELETE USING (is_agent());

-- KB Article Feedback Table
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
  FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY kb_article_feedback_delete ON kb_article_feedback
  FOR DELETE USING (auth.uid() = user_id);

-- Trigger to Maintain Feedback Counts
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

-- KB Visibility Setting
INSERT INTO app_settings (key, value) VALUES
  ('kb_visible', 'false')
ON CONFLICT (key) DO NOTHING;

-- Add FK from tickets.source_article_id to kb_articles
ALTER TABLE tickets
  ADD CONSTRAINT tickets_source_article_id_fkey
  FOREIGN KEY (source_article_id) REFERENCES kb_articles(id) ON DELETE SET NULL;
