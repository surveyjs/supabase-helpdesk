-- ============================================================
-- Phase 32 — Fix Ticket URLs in Notification Template Bodies
-- ============================================================
-- Notification templates embedded `/tickets/{{ticketId}}` links, which 404
-- because the ticket route is `/tickets/[id]/[slug]`. Switch to
-- `/tickets/{{ticketId}}/redirect` so the slug page redirects to the
-- canonical URL. Use replace() to swap only the URL substring, preserving
-- any custom wording admins have applied to these templates.

UPDATE notification_templates
SET body = replace(body, '](/tickets/{{ticketId}})', '](/tickets/{{ticketId}}/redirect)')
WHERE event_type IN ('duplicate_post', 'merge_post', 'merge_banner')
  AND body LIKE '%](/tickets/{{ticketId}})%';

UPDATE notification_templates
SET body = replace(body, '](/tickets/{{originalTicketId}})', '](/tickets/{{originalTicketId}}/redirect)')
WHERE event_type = 'auto_reply_duplicate_ticket'
  AND body LIKE '%](/tickets/{{originalTicketId}})%';
