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

-- Only agents can create user notes
CREATE POLICY user_notes_insert ON user_notes
  FOR INSERT WITH CHECK (is_agent());

-- Agent can edit own notes only
CREATE POLICY user_notes_update ON user_notes
  FOR UPDATE USING (auth.uid() = author_id AND is_agent());

-- Agent can delete own notes; admin can delete any
CREATE POLICY user_notes_delete ON user_notes
  FOR DELETE USING (
    (auth.uid() = author_id AND is_agent())
    OR is_admin()
  );
