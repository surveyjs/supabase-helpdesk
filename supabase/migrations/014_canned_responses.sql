-- Migration 014: Canned Responses
-- Phase 16 — Canned responses for agents

-- ============================================================
-- Canned Responses table
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
