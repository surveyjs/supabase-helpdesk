-- Migration 013: User Notes table for Phase 15 (User Profile & Account Management)

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
