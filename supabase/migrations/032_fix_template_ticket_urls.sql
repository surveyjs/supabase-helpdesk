-- ============================================================
-- Phase 32 — Fix Ticket URLs in Notification Template Bodies
-- ============================================================
-- Notification templates embedded `/tickets/{{ticketId}}` links, which 404
-- because the ticket route is `/tickets/[id]/[slug]`. Switch to
-- `/tickets/{{ticketId}}/redirect` so the slug page redirects to the
-- canonical URL.

UPDATE notification_templates
SET body = 'This ticket has been closed as a duplicate of [#{{ticketId}}](/tickets/{{ticketId}}/redirect).'
WHERE event_type = 'duplicate_post'
  AND body LIKE '%](/tickets/{{ticketId}})%';

UPDATE notification_templates
SET body = 'This ticket has been merged into [#{{ticketId}}](/tickets/{{ticketId}}/redirect).'
WHERE event_type = 'merge_post'
  AND body LIKE '%](/tickets/{{ticketId}})%';

UPDATE notification_templates
SET body = 'This ticket has been merged into [#{{ticketId}}](/tickets/{{ticketId}}/redirect). All posts have been moved.'
WHERE event_type = 'merge_banner'
  AND body LIKE '%](/tickets/{{ticketId}}).%';

UPDATE notification_templates
SET body = 'Your reply could not be processed because this ticket has been closed as a duplicate. Please continue the conversation at the original ticket: [#{{originalTicketId}}](/tickets/{{originalTicketId}}/redirect).'
WHERE event_type = 'auto_reply_duplicate_ticket'
  AND body LIKE '%](/tickets/{{originalTicketId}})%';
