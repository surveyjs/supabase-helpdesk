-- ==========================================================
-- Inline Image Attachments — RLS hardening
-- ----------------------------------------------------------
-- Defense-in-depth: prevent blocked accounts from creating
-- or deleting orphan attachment rows at the RLS layer, even
-- if a Server Action's `is_blocked` short-circuit is bypassed.
-- The existing `uploadInlineImage` action already checks
-- `profile.is_blocked`, but other callers / future endpoints
-- shouldn't have to repeat the check.
-- ==========================================================

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
    OR (
      post_id IS NULL
      AND uploader_id = auth.uid()
      AND NOT is_blocked()
    )
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
    OR (
      post_id IS NULL
      AND uploader_id = auth.uid()
      AND NOT is_blocked()
    )
  );
