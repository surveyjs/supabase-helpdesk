-- ============================================================
-- Phase 33 — Clone (Copy) a Ticket / Clone a Comment to a Ticket
-- ============================================================

-- Lineage: which ticket (and, for comment clones, which post) this ticket was cloned from.
ALTER TABLE tickets
  ADD COLUMN cloned_from_id BIGINT REFERENCES tickets(id) ON DELETE SET NULL,
  ADD COLUMN cloned_from_post_id UUID REFERENCES posts(id) ON DELETE SET NULL;

CREATE INDEX idx_tickets_cloned_from_id ON tickets (cloned_from_id);

-- Template prepended to the NEW ticket's original post, linking back to the SOURCE ticket.
-- {{ticketId}} = source ticket id.
INSERT INTO notification_templates (event_type, subject, body) VALUES
  ('clone_origin_note',
   'Cloned ticket origin note',
   'This ticket is a copy of a post from [#{{ticketId}}](/tickets/{{ticketId}}/redirect).')
ON CONFLICT (event_type) DO NOTHING;

-- Template that REPLACES the cloned comment's body in the SOURCE thread.
-- {{userName}} = comment author, {{ticketTitle}}/{{ticketId}} = the NEW ticket.
INSERT INTO notification_templates (event_type, subject, body) VALUES
  ('clone_comment_reply',
   'Comment cloned to a new ticket',
   'Hello {{userName}}, I created a separate ticket on your behalf: [{{ticketTitle}}](/tickets/{{ticketId}}/redirect).')
ON CONFLICT (event_type) DO NOTHING;
