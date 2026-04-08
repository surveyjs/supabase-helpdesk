# HelpDesk — Architecture Constraints

---

### Architecture Constraints

1. **No custom API layer** — Use Supabase client libraries to read/write data directly. Mutations happen through Next.js Server Actions called from `<form>` elements or programmatic invocations (e.g., `startTransition`, button `onClick` handlers) for interactions that don't map naturally to forms. Exceptions to the `<form>` pattern include: Follow/Unfollow toggle (3.11), Mark all as read (14a.2, 14a.3), collapsible timeline expand/collapse (3.4.1), draft publish (12.3), and notification mark-as-read actions.
2. **Server-rendered everything** — No `"use client"` components except for: (a) Supabase Realtime subscriptions (see constraint 7), (b) Markdown preview toggling (see 3.12), (c) reporting charts (see section 18), (d) knowledge base article suggestions and duplicate ticket detection with debounced search (see 19.6, 23.2), (e) AI-powered form interactions such as auto-categorization suggestions and suggested reply loading (see 23.1, 23.3), (f) collapsible "Show older posts" / "Show older comments" expand/collapse toggles on the ticket detail timeline (see 3.4.1), and (g) notification bell icon with dropdown panel and real-time badge updates (see 14a.1, 14a.2, 14a.5). These client-side components must be minimal wrappers with no application state management.
3. **Database-enforced security** — Every table must have Row-Level Security enabled. Helper functions like `is_agent()`, `is_admin()`, `is_teammate()`, and `user_has_tier_capability(capability text)` should live in Postgres and be used in RLS policies.
4. **Cookie-based auth** — Use `@supabase/ssr` for server-side Supabase clients. A Next.js middleware refreshes the session on every request.
5. **Agent dashboard performance** — Create a Postgres VIEW (`agent_tickets`) that joins tickets with profile emails, subscription tier data, and pre-aggregates post counts. The agent page queries this view instead of doing complex joins on the client.
6. **URL-driven state** — Filtering and view switching (my tickets vs team tickets, agent dashboard filters) should use URL search params, not React state.
7. **Real-time subscriptions** — Use Supabase Realtime to push live updates to ticket detail and agent dashboard pages. The real-time listener is a thin wrapper that triggers a server data refresh when changes are detected. See constraint 2 for the full list of permitted `"use client"` components.
8. **Markdown sanitization** — All user-supplied Markdown is rendered to HTML on the server and sanitized before output to prevent XSS attacks. Only a safe subset of HTML is allowed (headings, lists, links, code blocks, emphasis, images). Script tags, event handlers, and dangerous attributes are stripped. Use a battle-tested sanitization library (e.g., `sanitize-html` or `rehype-sanitize`). **Exception:** The Markdown preview tab in text editors (see 3.12) renders Markdown **client-side** using the same sanitization library and configuration as the server pipeline. This is acceptable because the preview displays only the current user's own unsaved input — it is never persisted or shown to other users in this form. The server-side sanitization remains the authoritative security boundary for all stored and displayed content.
9. **Content-length limits** — The following maximum character limits are enforced at both the application and database levels:
   - Ticket title: **300** characters
   - Post / comment / note body: **50,000** characters
   - Canned response body: **50,000** characters
   - KB article body: **100,000** characters
   - Display name: **100** characters
   - Team name: **100** characters
   - Tag name: **50** characters
   - Category / type name: **100** characters
   - Custom field text value: **1,000** characters
   - CSAT comment: **2,000** characters
   - User note body: **50,000** characters
   - File attachment original filename: **255** characters
   - Subscription tier key: **50** characters
   - Subscription tier display name: **100** characters
   Inputs exceeding these limits are rejected with a validation error.
10. **Concurrent editing** — The application uses a last-write-wins strategy for concurrent edits. If two users edit the same post, ticket title, or metadata simultaneously, the most recently submitted change is persisted. No optimistic locking or conflict detection is implemented in this version.
11. **Scheduled tasks** — Deferred and periodic tasks (CSAT survey email dispatch, notification cleanup, notification coalescing, auto-reply log cleanup, SLA monitoring) are implemented using **Supabase `pg_cron`** (the `pg_cron` extension available in hosted Supabase). Five cron jobs are configured: (1) a job running every **5 minutes** that sends pending CSAT survey emails whose scheduled send time has passed and whose tickets have not been re-opened since scheduling; (2) a job running **daily** that deletes read notifications older than 30 days and all notifications older than 90 days (see 14a.6); (3) a job running **daily** that deletes `auto_reply_log` rows older than 24 hours (see 15.5); (4) a job running every **5 minutes** that scans all tickets with an active SLA policy and a status of **open** or **pending**, calculates elapsed business-hours against SLA targets (first response and resolution), and sends approaching or breach notifications as defined in 17.5; (5) a job running every **1 minute** that processes the `notification_coalescing_queue` table — for each entry where `send_after <= now()`, it renders and sends the consolidated email notification (or a standard single-event notification if only one event was queued), then deletes the processed entry (see 14.6). Each combination of ticket, target type (response/resolution), and notification level (approaching/breached) is sent at most once per SLA evaluation period (from when the timer starts or resumes until it stops). Deduplication is tracked via an `sla_notifications_sent` table with columns: ticket ID, target type (response/resolution), notification level (approaching/breached), and sent timestamp. The cron job checks this table before sending a notification and inserts a row after sending. When a ticket's status changes in a way that resets the SLA evaluation period (e.g., re-opened after being closed), the corresponding rows are deleted so notifications can fire again for the new evaluation period. CSAT survey emails are queued by inserting a row into a `csat_survey_queue` table when a ticket is closed; the row stores the ticket ID, recipient, scheduled send time, and a status flag. Re-opening a ticket cancels the pending survey by updating the status flag.

---
