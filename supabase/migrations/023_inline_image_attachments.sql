-- ==========================================================
-- Inline Image Attachments
-- ----------------------------------------------------------
-- Allow attachments to be uploaded from inside the Markdown
-- editor (paste / drop / toolbar) before the parent post has
-- been created. Such "orphan" attachments carry an
-- `uploader_id` and a NULL `post_id`. They are claimed by
-- `claim_inline_attachments(post_id, body)` once the post
-- (or comment / note / draft) is saved.
-- ==========================================================

-- Ensure the storage bucket exists. Migration 006 wired the storage RLS
-- policies but relied on `supabase/config.toml` to actually create the
-- bucket — that only runs on `supabase start`, not on `supabase db reset`.
-- Inserting it here keeps every fresh database in sync.
INSERT INTO storage.buckets (id, name, public, file_size_limit)
VALUES ('attachments', 'attachments', false, 10 * 1024 * 1024)
ON CONFLICT (id) DO NOTHING;

ALTER TABLE attachments
  ADD COLUMN uploader_id UUID REFERENCES profiles(id) ON DELETE CASCADE;

-- Backfill uploader_id from the parent post's author for legacy rows.
UPDATE attachments a
   SET uploader_id = p.author_id
  FROM posts p
 WHERE a.post_id = p.id
   AND a.uploader_id IS NULL;

ALTER TABLE attachments
  ALTER COLUMN post_id DROP NOT NULL,
  ADD CONSTRAINT attachments_post_or_uploader CHECK (
    post_id IS NOT NULL OR uploader_id IS NOT NULL
  );

CREATE INDEX idx_attachments_uploader_orphan
  ON attachments (uploader_id)
  WHERE post_id IS NULL;

-- ----------------------------------------------------------
-- RLS: replace the original 006 policies so that orphan
-- attachments (post_id IS NULL) are visible/insertable/
-- deletable only to their uploader, while post-bound
-- attachments keep the previous behaviour.
-- ----------------------------------------------------------

DROP POLICY IF EXISTS attachments_select ON attachments;
CREATE POLICY attachments_select ON attachments
  FOR SELECT TO authenticated USING (
    (
      post_id IS NOT NULL
      AND EXISTS (SELECT 1 FROM posts p WHERE p.id = attachments.post_id)
    )
    OR (post_id IS NULL AND uploader_id = auth.uid())
  );

DROP POLICY IF EXISTS attachments_insert ON attachments;
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
    OR (post_id IS NULL AND uploader_id = auth.uid())
  );

DROP POLICY IF EXISTS attachments_delete ON attachments;
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
    OR (post_id IS NULL AND uploader_id = auth.uid())
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
