-- ============================================================
-- 007 — Soft-delete attachments so agents can restore them (#119)
-- ============================================================
-- Deleting an attachment used to remove the Storage object and the row, so a
-- file removed by mistake was gone for good and its "deleted file" entry in the
-- ticket Logs led nowhere. Now a delete only stamps deleted_at / deleted_by:
--   * the file disappears from the post for everyone;
--   * agents still see the row (RLS below), so the Logs entry can offer a
--     download and a Restore;
--   * restoring clears the stamp and the file is back in the post.
--
-- Both writes go through SECURITY DEFINER functions with their own permission
-- checks instead of a broad UPDATE policy, so a post author can't rewrite
-- storage_path or other columns of their attachment rows.
--
-- Schema-only (new nullable columns, policy, functions): no existing row
-- changes. Re-runnable.

ALTER TABLE public.attachments
  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS deleted_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL;

-- Same rule as 001 plus: a deleted row is visible to agents only.
DROP POLICY IF EXISTS attachments_select ON public.attachments;
CREATE POLICY attachments_select ON public.attachments
  FOR SELECT TO authenticated USING (
    (deleted_at IS NULL OR is_agent())
    AND (
      (
        post_id IS NOT NULL
        AND EXISTS (SELECT 1 FROM posts p WHERE p.id = attachments.post_id)
      )
      OR (post_id IS NULL AND uploader_id = auth.uid())
    )
  );

-- Mark a post-bound attachment deleted. Allowed for the post's author and for
-- agents (the same rule as the attachments_delete policy). Returns the
-- attachment's post_id, or NULL when there is nothing to delete (unknown id,
-- orphan row, already deleted). Raises 42501 when not allowed.
CREATE OR REPLACE FUNCTION public.soft_delete_attachment(p_attachment_id UUID)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_post_id UUID;
  v_author UUID;
BEGIN
  SELECT a.post_id, p.author_id INTO v_post_id, v_author
  FROM attachments a
  JOIN posts p ON p.id = a.post_id
  WHERE a.id = p_attachment_id AND a.deleted_at IS NULL;

  IF v_post_id IS NULL THEN
    RETURN NULL;
  END IF;

  IF auth.uid() IS NULL OR NOT (v_author = auth.uid() OR is_agent()) THEN
    RAISE EXCEPTION 'not allowed to delete this attachment' USING ERRCODE = '42501';
  END IF;

  UPDATE attachments
  SET deleted_at = now(), deleted_by = auth.uid()
  WHERE id = p_attachment_id;

  RETURN v_post_id;
END;
$$;

-- Undo soft_delete_attachment. Agents only. Returns the attachment's post_id,
-- or NULL when the row is unknown or not deleted. Raises 42501 for non-agents.
CREATE OR REPLACE FUNCTION public.restore_attachment(p_attachment_id UUID)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_post_id UUID;
BEGIN
  IF auth.uid() IS NULL OR NOT is_agent() THEN
    RAISE EXCEPTION 'only agents can restore attachments' USING ERRCODE = '42501';
  END IF;

  UPDATE attachments
  SET deleted_at = NULL, deleted_by = NULL
  WHERE id = p_attachment_id AND deleted_at IS NOT NULL
  RETURNING post_id INTO v_post_id;

  RETURN v_post_id;
END;
$$;

-- Signed-in users only (see 002/003 for why anon is revoked by name).
REVOKE EXECUTE ON FUNCTION public.soft_delete_attachment(UUID) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.restore_attachment(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.soft_delete_attachment(UUID) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.restore_attachment(UUID) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
