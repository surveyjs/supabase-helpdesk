-- ============================================================
-- 011 — Convert an answer to a comment and back (#106)
-- ============================================================
-- Agents can turn a comment into a top-level answer (reply) and an answer into
-- a comment, to keep a ticket's structure readable: answers hold the support
-- team's recommendations, comments the clarifications. The thread orders both
-- by created_at, so a converted post lands by its own date.
--
-- convert_post_kind(post_id, 'post' | 'comment') does it atomically:
--   * comment -> answer: the post becomes top-level; comments that replied to
--     it become its comments. is_private becomes its own flag OR its old
--     root's, so nothing becomes more visible than before.
--   * answer -> comment: the post becomes a comment on the newest earlier
--     top-level post (the original post at the latest); its comments move
--     along to that post and keep its privacy (is_private OR the answer's).
-- Original posts, notes, drafts and merged tickets are refused. Agents only.
-- Returns the post's new parent id (comment) or its own id (answer), or NULL
-- when it already has that kind.
--
-- Schema-only (a function): no data changes. Re-runnable.

CREATE OR REPLACE FUNCTION public.convert_post_kind(p_post_id UUID, p_to TEXT)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v posts%ROWTYPE;
  v_root_private BOOLEAN;
  v_parent UUID;
BEGIN
  IF auth.uid() IS NULL OR NOT is_agent() THEN
    RAISE EXCEPTION 'only agents can convert posts' USING ERRCODE = '42501';
  END IF;
  IF p_to NOT IN ('post', 'comment') THEN
    RAISE EXCEPTION 'unknown post kind %', p_to USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v FROM posts WHERE id = p_post_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'post not found' USING ERRCODE = 'P0002';
  END IF;
  IF v.is_original OR v.is_draft OR v.post_type = 'note' THEN
    RAISE EXCEPTION 'this post cannot be converted' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (SELECT 1 FROM tickets WHERE id = v.ticket_id AND merged_into_id IS NOT NULL) THEN
    RAISE EXCEPTION 'the ticket was merged' USING ERRCODE = '22023';
  END IF;

  IF p_to = 'post' THEN
    IF v.post_type <> 'comment' THEN
      RETURN NULL;
    END IF;
    v_root_private := COALESCE(get_root_post_is_private(v.id), false);

    UPDATE posts
    SET parent_post_id = v.id, parent_comment_id = NULL
    WHERE parent_comment_id = v.id;

    UPDATE posts
    SET post_type = 'post', parent_post_id = NULL, parent_comment_id = NULL,
        is_private = v.is_private OR v_root_private
    WHERE id = v.id;

    RETURN v.id;
  END IF;

  -- p_to = 'comment'
  IF v.post_type <> 'post' OR v.parent_post_id IS NOT NULL OR v.parent_comment_id IS NOT NULL THEN
    RETURN NULL;
  END IF;

  SELECT id INTO v_parent
  FROM posts
  WHERE ticket_id = v.ticket_id
    AND id <> v.id
    AND post_type = 'post'
    AND NOT is_draft
    AND parent_post_id IS NULL
    AND parent_comment_id IS NULL
    AND (created_at < v.created_at OR is_original)
  ORDER BY is_original, created_at DESC
  LIMIT 1;

  IF v_parent IS NULL THEN
    RAISE EXCEPTION 'no earlier post to attach the comment to' USING ERRCODE = '22023';
  END IF;

  UPDATE posts
  SET parent_post_id = v_parent, is_private = is_private OR v.is_private
  WHERE parent_post_id = v.id;

  UPDATE posts
  SET post_type = 'comment', parent_post_id = v_parent, parent_comment_id = NULL
  WHERE id = v.id;

  RETURN v_parent;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.convert_post_kind(UUID, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.convert_post_kind(UUID, TEXT) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
