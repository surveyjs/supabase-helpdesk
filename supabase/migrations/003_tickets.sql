-- ============================================================
-- Phase 3 — Extend search vector + fix slug index
-- ============================================================

-- 0. Slugs are NOT unique across tickets (§3.9) — drop the unique constraint
DROP INDEX IF EXISTS idx_tickets_slug;
CREATE INDEX idx_tickets_slug ON tickets (slug);

-- 1. Rate-limit: bypass for service-role / internal calls
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

-- 2. Update the ticket search_vector trigger to include the original post body
CREATE OR REPLACE FUNCTION update_ticket_search_vector()
RETURNS TRIGGER AS $$
BEGIN
  NEW.search_vector := to_tsvector('english',
    COALESCE(NEW.title, '') || ' ' ||
    COALESCE((SELECT body FROM posts WHERE ticket_id = NEW.id AND is_original = true LIMIT 1), '')
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 2. Add trigger on posts to update ticket search_vector when original post changes
CREATE OR REPLACE FUNCTION update_ticket_search_on_post()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.is_original THEN
    UPDATE tickets SET search_vector = to_tsvector('english',
      COALESCE(title, '') || ' ' || COALESCE(NEW.body, '')
    ) WHERE id = NEW.ticket_id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER posts_update_ticket_search
  AFTER INSERT OR UPDATE OF body ON posts
  FOR EACH ROW EXECUTE FUNCTION update_ticket_search_on_post();
