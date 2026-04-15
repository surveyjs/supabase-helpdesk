-- ============================================================
-- Phase 17 — Advanced Ticket Operations
-- ============================================================

-- Add bulk action summary notification template
INSERT INTO notification_templates (event_type, subject, body) VALUES
  ('bulk_action_summary',
   '{{actionType}} applied to {{ticketCount}} tickets',
   'Agent {{actorName}} performed a bulk action: {{actionType}} on {{ticketCount}} ticket(s).\n\nAffected tickets:\n{{ticketList}}')
ON CONFLICT (event_type) DO NOTHING;

-- Ensure merge/duplicate templates exist (should already be seeded in Phase 7)
INSERT INTO notification_templates (event_type, subject, body) VALUES
  ('duplicate_post',
   'Ticket marked as duplicate',
   'This ticket has been closed as a duplicate of [#{{ticketId}}](/tickets/{{ticketId}}).')
ON CONFLICT (event_type) DO NOTHING;

INSERT INTO notification_templates (event_type, subject, body) VALUES
  ('merge_post',
   'Ticket merged',
   'This ticket has been merged into [#{{ticketId}}](/tickets/{{ticketId}}).')
ON CONFLICT (event_type) DO NOTHING;

INSERT INTO notification_templates (event_type, subject, body) VALUES
  ('merge_banner',
   'Merge stub banner',
   'This ticket has been merged into [#{{ticketId}}](/tickets/{{ticketId}}). All posts have been moved. Please continue the conversation there.')
ON CONFLICT (event_type) DO NOTHING;
