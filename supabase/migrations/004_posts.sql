-- ============================================================
-- Phase 6 — Posts: comment nesting constraint + draft publish trigger
-- ============================================================

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
