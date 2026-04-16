# Phase 17 — Advanced Ticket Operations

## Context

You are building advanced ticket operations — mark as duplicate, merge tickets, bulk actions, and ticket deletion — for a **HelpDesk** application. Read `docs/requirements.md` sections 8.15, 9.4, 9.5, 9.6, 13.2, 16.5, 16.8, 16.17, 16.22, and `docs/architecture.md` constraints 1, 2, 5, 6.

Phases 0–16 are complete: project init, database schema, authentication, tickets, agent dashboard, taxonomy, posts/comments/notes, admin setup, file attachments, email notifications, real-time/in-app notifications, CSAT ratings, SLA policies, knowledge base, reporting, user profile/account management, and canned responses/follow/custom fields.

This phase adds the ability to mark tickets as duplicate, merge two tickets, perform bulk actions from the agent dashboard, and delete tickets (admin only). It also adds merge/duplicate/bulk notification templates and the merged-ticket stub page.

### Existing Infrastructure

- **Tickets table** already has `duplicate_of_id BIGINT REFERENCES tickets(id)` and `merged_into_id BIGINT REFERENCES tickets(id)` columns (from Phase 1 migration `001_core_schema.sql`).
- **Notification templates** already seeded in `005_admin.sql`: `duplicate_post`, `merge_post`, `merge_banner` with default body text and `{{ticketId}}` placeholder.
- **`changeTicketStatus`** in `src/lib/actions/agent.ts` already skips CSAT scheduling and notifications when `duplicate_of_id` is set.
- **`notifyTicketRecipients`** in `src/lib/email/notify.ts` handles owner + followers, coalescing, and preference checks.
- **SLA utilities** in `src/lib/utils/sla.ts` provide `pauseSlaTimer`, `stopResolutionTimer`, `recalculateSlaTargets`, `initializeSlaTimer`.
- **CSAT utilities** in `src/lib/actions/csat.ts` provide `scheduleCsatSurvey`, `cancelCsatSurvey`.
- **Activity log** table (`activity_log`) with columns: `ticket_id`, `actor_id`, `action`, `details` (JSONB).
- **Admin audit log** table (`admin_audit_log`) for admin-only destructive actions.

## Tasks

### 1. Migration: `supabase/migrations/015_advanced_tickets.sql`

The tickets table already has `duplicate_of_id` and `merged_into_id` columns. This migration adds the bulk action notification template and any missing templates.

```sql
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
```

> **Note:** The templates use `ON CONFLICT DO NOTHING` because Phase 7 already seeds `duplicate_post`, `merge_post`, and `merge_banner`. This migration ensures the `bulk_action_summary` template exists.

### 2. Server Actions: Mark as Duplicate

**`src/lib/actions/duplicate.ts`** (new file):

- `markAsDuplicate(formData: FormData)`:
  - Extract `ticket_id` (the source — the one being marked as duplicate) and `original_ticket_id` (the target — the original)
  - Require agent role
  - Validate both tickets exist; they must be different tickets
  - Validate source ticket is not already merged (`merged_into_id IS NULL`)
  - Validate source ticket is not already marked as duplicate of a different ticket (if already duplicate of same target, no-op)
  - Validate original ticket exists and is accessible
  - Update source ticket: set `duplicate_of_id = original_ticket_id`, `status = 'closed'`
  - Fetch the duplicate post template from `notification_templates` where `event_type = 'duplicate_post'`
  - Replace `{{ticketId}}` with the original ticket ID in the template body
  - Insert a system-generated post on the source ticket: `post_type = 'post'`, `author_id = current user`, body = rendered template
  - Log in `activity_log`: action `'marked_duplicate'`, details `{ original_ticket_id }`
  - **Do NOT** call `scheduleCsatSurvey` (§9.4: duplicate closure skips CSAT)
  - **Do NOT** send status-change notifications (§9.4: duplicate closure skips all notifications)
  - **Do NOT** send SLA breach/approaching alerts
  - Call `stopResolutionTimer(ticketId)` to freeze SLA
  - Revalidate ticket detail and agent dashboard paths

- `removeDuplicateLink(formData: FormData)`:
  - Extract `ticket_id`
  - Require agent role
  - Validate ticket exists and has `duplicate_of_id IS NOT NULL`
  - Update ticket: set `duplicate_of_id = null` (do **not** change status — §9.4)
  - Log in `activity_log`: action `'duplicate_removed'`, details `{ previous_original_id }`
  - Revalidate

### 3. Server Actions: Merge Tickets

**`src/lib/actions/merge.ts`** (new file):

- `mergeTickets(formData: FormData)`:
  - Extract `source_ticket_id` and `target_ticket_id`
  - Require agent role
  - Validate both tickets exist; they must be different
  - Validate source ticket is not already merged (`merged_into_id IS NULL`)
  - Validate source ticket is not marked as duplicate (`duplicate_of_id IS NULL`, §9.6: must remove duplicate link first)
  - Validate target ticket is not already merged (`merged_into_id IS NULL`) — cannot merge into a stub

  **Move posts, comments, notes:**
  - Update all rows in `posts` where `ticket_id = source_ticket_id`: set `ticket_id = target_ticket_id`
  - This includes the original post (`is_original = true`); update it to `is_original = false` so the target's original post remains the only one marked true

  **Move attachments:**
  - Update all `attachments` rows where `ticket_id = source_ticket_id`: set `ticket_id = target_ticket_id`
  - (If attachments reference `post_id`, the post IDs haven't changed — they just moved tickets)

  **Move activity log entries:**
  - Update all `activity_log` rows where `ticket_id = source_ticket_id`: set `ticket_id = target_ticket_id`

  **Consolidate followers:**
  - Get all followers of the source ticket from `ticket_followers`
  - For each follower, try to insert into `ticket_followers` for the target ticket (use upsert/`ON CONFLICT DO NOTHING` pattern)
  - The source ticket's owner becomes a regular follower of the target ticket (insert if not already following)
  - Delete remaining `ticket_followers` rows for the source ticket

  **Combine tags:**
  - Get all `ticket_tags` for the source ticket
  - For each, try to insert into `ticket_tags` for the target ticket (upsert/`ON CONFLICT DO NOTHING`)
  - Delete `ticket_tags` rows for the source ticket

  **Severity inheritance:**
  - Compare source and target severity using priority order: `critical > high > medium > low`
  - If source severity is higher than target, update target ticket's severity
  - If severity changed, call `recalculateSlaTargets(targetTicketId, newSeverity)` and log severity change in activity log

  **Cancel source CSAT:**
  - Call `cancelCsatSurvey(sourceTicketId)` to cancel any pending CSAT survey for the source

  **Freeze source SLA:**
  - Call `stopResolutionTimer(sourceTicketId)` to freeze the source's SLA timers (preserved for historical reporting)

  **Close and mark source as merged:**
  - Update source ticket: set `merged_into_id = target_ticket_id`, `status = 'closed'`
  - Fetch the merge post template from `notification_templates` where `event_type = 'merge_post'`
  - Replace `{{ticketId}}` with target ticket ID
  - Insert a system-generated post on the source ticket: `post_type = 'post'`, `author_id = current user`, body = rendered template
  - Note: this post stays on the source ticket (it's the stub's redirect message)

  **Activity log entries:**
  - On the target ticket: action `'merged_from'`, details `{ source_ticket_id }`
  - On the source ticket: action `'merged_into'`, details `{ target_ticket_id }`

  **Notifications:**
  - Followers of the source ticket do **not** receive a merge notification (§9.6: silently transferred)
  - Future notifications on the target ticket will reach the transferred followers naturally

  **Revalidate** both ticket detail paths + agent dashboard

### 4. Server Actions: Delete Ticket

Add to `src/lib/actions/agent.ts` (or a new `src/lib/actions/delete-ticket.ts`):

- `deleteTicket(formData: FormData)`:
  - Extract `ticket_id`
  - Require **admin** role (not just agent)
  - Fetch the ticket
  - **Guard: closed tickets cannot be deleted** (§9.5). If `status = 'closed'`, return error: "Closed tickets cannot be deleted. Re-open the ticket first if deletion is necessary."
  - **Guard: tickets with duplicates pointing to them cannot be deleted**. Query `tickets` where `duplicate_of_id = ticket_id`. If any found, return error listing the blocking ticket IDs.
  - **Guard: tickets that are merge targets cannot be deleted**. Query `tickets` where `merged_into_id = ticket_id`. If any found, return error listing the blocking ticket IDs (merge stubs must be deleted first, outermost-in).
  - If all guards pass:
    - Delete the ticket (cascading deletes handle posts, activity log, followers, etc.)
    - Log in `admin_audit_log`: action `'ticket_deleted'`, target_type `'ticket'`, target_id `ticket_id`, details with ticket title
    - Redirect to `/agent`

### 5. Server Actions: Bulk Actions

**`src/lib/actions/bulk.ts`** (new file):

All bulk actions accept an array of ticket IDs and are processed server-side in a single Server Action call (§8.15).

Common helper:

```typescript
async function requireAgentRole() {
  // Same pattern as agent.ts — returns { supabase, user, profile }
}

async function requireAdminRole() {
  // Similar but checks profile.role === 'admin'
}
```

- `bulkChangeStatus(formData: FormData)`:
  - Extract `ticket_ids` (JSON array) and `new_status` (open/pending/closed)
  - Require agent role
  - For each ticket:
    - Skip if already at the target status
    - Skip if `merged_into_id IS NOT NULL`
    - Update status
    - Log activity: `'status_changed'` with from/to
    - Handle side effects:
      - If closing: call `scheduleCsatSurvey` (unless `duplicate_of_id` is set — duplicate flag overrides, §8.15), call `stopResolutionTimer`
      - If re-opening from closed: call `cancelCsatSurvey`, call `resumeSlaTimer`
      - If setting to pending: call `pauseSlaTimer`
      - If setting to open from pending: call `resumeSlaTimer`
  - Batched notifications: at most **one email per recipient** summarizing all affected tickets (using `bulk_action_summary` template with `{{actionType}}`, `{{ticketCount}}`, `{{actorName}}`, `{{ticketList}}`)
  - Batched in-app notifications: at most **one in-app notification per recipient** (e.g., "50 tickets were closed by Agent Smith")
  - Revalidate `/agent`

- `bulkAssign(formData: FormData)`:
  - Extract `ticket_ids` (JSON array) and `agent_id`
  - Require agent role
  - Validate target agent has agent/admin role
  - For each ticket: update `assigned_agent_id`, log `'agent_assigned'`
  - Batched email + in-app notification
  - Revalidate

- `bulkUnassign(formData: FormData)`:
  - Extract `ticket_ids` (JSON array)
  - Require agent role
  - For each ticket: set `assigned_agent_id = null`, log `'agent_unassigned'`
  - Batched notification
  - Revalidate

- `bulkAddTags(formData: FormData)`:
  - Extract `ticket_ids` (JSON array) and `tag_ids` (JSON array)
  - Require agent role
  - For each ticket × tag: insert into `ticket_tags` (ON CONFLICT DO NOTHING), log `'tag_added'`
  - Revalidate

- `bulkRemoveTags(formData: FormData)`:
  - Extract `ticket_ids` (JSON array) and `tag_ids` (JSON array)
  - Require agent role
  - For each ticket × tag: delete from `ticket_tags`, log `'tag_removed'`
  - Revalidate

- `bulkSetSeverity(formData: FormData)`:
  - Extract `ticket_ids` (JSON array) and `new_severity`
  - Require agent role
  - For each ticket: update severity (skip if already at target), log `'severity_changed'`, call `recalculateSlaTargets(ticketId, newSeverity)`
  - Batched notification
  - Revalidate

- `bulkDelete(formData: FormData)`:
  - Extract `ticket_ids` (JSON array)
  - Require **admin** role
  - Show confirmation (handled by UI before calling)
  - For each ticket:
    - **Skip** if `status = 'closed'` (same as single delete guard)
    - **Skip** if it is the original in a duplicate relationship (other tickets have `duplicate_of_id` pointing to it),  with a warning
    - **Skip** if it is the target of merge operations (other tickets have `merged_into_id` pointing to it), with a warning
    - If all guards pass: delete the ticket, log in `admin_audit_log`
  - Return summary of successful deletes and skipped tickets with reasons
  - Revalidate

**Batched notification helper:**

```typescript
async function sendBulkNotification(
  ticketIds: number[],
  actionType: string,
  actorName: string,
  actorId: string,
): Promise<void> {
  // Collect all unique recipients across all affected tickets (owners + followers)
  // For each recipient, send ONE email using bulk_action_summary template
  // For each recipient, create ONE in-app notification summarizing the action
}
```

### 6. UI: Mark as Duplicate on Ticket Detail

Update `src/app/(main)/tickets/[id]/[slug]/page.tsx`:

- For agents, add a **"Mark as Duplicate"** button/action in the ticket actions area
- Clicking opens a dialog/form:
  - Text input: "Original ticket ID" (the ticket this one duplicates)
  - Optionally: a searchable ticket picker (search by ID or title)
  - "Mark as Duplicate" submit button
  - Calls `markAsDuplicate` Server Action
- If the ticket already has `duplicate_of_id` set:
  - Show "Duplicate of #X" label with a link to the original ticket
  - Show a **"Remove Duplicate Link"** button for agents
  - Calls `removeDuplicateLink` Server Action
- The system-generated duplicate post appears in the timeline as a regular post with the rendered template text

### 7. UI: Merge Tickets on Ticket Detail

Update `src/app/(main)/tickets/[id]/[slug]/page.tsx`:

- For agents, add a **"Merge into..."** button/action in the ticket actions area
- Only shown when ticket is not merged and not marked as duplicate
- Clicking opens a dialog/form:
  - Text input: "Target ticket ID" (the ticket to merge this one into)
  - Optionally: a searchable ticket picker
  - Warning text: "This action is irreversible. All posts, comments, notes, attachments, and followers will be moved to the target ticket."
  - "Merge" submit button
  - Calls `mergeTickets` Server Action

### 8. UI: Merged Ticket Stub Page

Update the ticket detail page to detect when `merged_into_id IS NOT NULL`:

- Render the ticket as **read-only** (no reply form, no action buttons)
- At the top of the page, display a prominent **merge banner**:
  - Fetch the merge banner template from `notification_templates` where `event_type = 'merge_banner'`
  - Replace `{{ticketId}}` with the target ticket ID
  - Render as Markdown (sanitized)
  - Style as a colored banner (info blue or similar)
- The system-generated merge post still appears in the timeline
- The page does **not** redirect (§9.6: source remains accessible at its original URL)
- All metadata (title, status="closed", etc.) is shown as-is but non-editable

### 9. UI: Delete Ticket Button

Update `src/app/(main)/tickets/[id]/[slug]/page.tsx`:

- For **admins only**, show a **"Delete Ticket"** button
- Clicking shows a confirmation prompt:
  - "Are you sure you want to delete ticket #X? This action cannot be undone."
  - If the ticket is closed: show error message "Closed tickets cannot be deleted. Re-open the ticket first if deletion is necessary." and disable the delete button
  - If the ticket has duplicate/merge dependencies: show warning listing blocking ticket IDs
- On confirm: calls `deleteTicket` Server Action
- On success: redirect to `/agent`

### 10. UI: Bulk Actions on Agent Dashboard

Update `src/app/(main)/agent/page.tsx`:

- **Checkboxes:**
  - Add a checkbox column to the ticket list
  - Each ticket row has an individual selection checkbox
  - Header row has a "Select all on this page" checkbox
  - Selection state is tracked client-side (this is a permitted `"use client"` component wrapping the checkboxes and toolbar)

- **Bulk action toolbar:**
  - Appears when at least one ticket is selected
  - Shows count: "N tickets selected"
  - Action buttons:
    1. **Close** — closes all selected tickets
    2. **Assign** — opens agent picker, assigns all to chosen agent
    3. **Unassign** — removes assignment from all selected
    4. **Change Status** — opens status picker (open/pending/closed)
    5. **Add Tags** — opens tag picker (multi-select), only shown if tags exist
    6. **Remove Tags** — opens tag picker (multi-select)
    7. **Set Severity** — opens severity picker
    8. **Delete** (admin only) — deletes selected tickets with confirmation
  - Each action shows a confirmation: "Apply to N tickets?"
  - On confirm: calls the corresponding bulk Server Action

**`src/components/features/bulk-actions/BulkActionToolbar.tsx`** (new `"use client"` component):
- Props: `selectedTicketIds: number[]`, `onClearSelection: () => void`
- Renders the toolbar with action buttons
- Each button opens a confirmation dialog or picker
- Submits via the corresponding Server Action (using `startTransition` for non-form actions)
- On success: clears selection and refreshes

**`src/components/features/bulk-actions/TicketCheckbox.tsx`** (new `"use client"` component):
- Props: `ticketId: number`, `checked: boolean`, `onChange: (ticketId: number, checked: boolean) => void`
- Renders an individual ticket checkbox

**`src/components/features/bulk-actions/BulkSelectProvider.tsx`** (new `"use client"` component):
- Wraps the agent dashboard ticket list
- Manages selection state (Set of ticket IDs)
- Provides `selectedIds`, `toggleId`, `selectAll`, `clearSelection` via context or props
- Renders `BulkActionToolbar` when selection is non-empty

### 11. Admin Template Management Sections

Update the Admin Setup page to include editable sections for the new templates:

- **Duplicate ticket template** (§16.5) — already has route/section from Phase 7; ensure the template with `{{ticketId}}` placeholder is editable with a "Reset to default" button
- **Merge ticket template** (§16.17) — a section to edit the `merge_post` template; supports `{{ticketId}}` placeholder; "Reset to default" button
- **Merge stub banner template** (§16.22) — a section to edit the `merge_banner` template; supports `{{ticketId}}` placeholder; "Reset to default" button
- **Bulk action summary template** (§16.8) — a section to edit the `bulk_action_summary` template; supports `{{actionType}}`, `{{ticketCount}}`, `{{actorName}}`, `{{ticketList}}` placeholders; "Reset to default" button

These should integrate into the existing admin notification templates management UI (from Phase 9 / Phase 7).

### 12. Tests

**`tests/db/016-advanced-tickets.test.ts`** (new file):

- **Mark as duplicate:**
  - Agent can mark ticket as duplicate (sets `duplicate_of_id`, closes ticket)
  - Activity log entry created with action `'marked_duplicate'`
  - Agent can remove duplicate link (clears `duplicate_of_id`, status unchanged)
  - Regular user cannot mark as duplicate (RLS)
  - Cannot mark a merged ticket as duplicate

- **Merge tickets:**
  - Agent can merge source into target
  - Posts move from source to target (verify count)
  - Source ticket's `is_original` post becomes `false`
  - Followers deduplicated (union semantics)
  - Source owner becomes follower of target
  - Tags combined (union)
  - Source ticket set to closed with `merged_into_id`
  - Activity log entries on both source and target
  - Cannot merge a ticket that is marked as duplicate
  - Cannot merge into a ticket that is already merged (stub)
  - Severity inheritance: source with higher severity upgrades target

- **Delete ticket:**
  - Admin can delete open ticket
  - Admin cannot delete closed ticket (guard)
  - Admin cannot delete ticket that is original of duplicates
  - Admin cannot delete ticket that is target of merges
  - Non-admin cannot delete
  - Cascading deletes: posts, followers, activity log cleaned up

- **Bulk actions:**
  - Bulk close: updates status, skips already-closed and merged tickets
  - Bulk assign: sets `assigned_agent_id` on all selected
  - Bulk unassign: clears `assigned_agent_id`
  - Bulk add tags: adds tags (deduplicates)
  - Bulk remove tags: removes specified tags
  - Bulk set severity: updates severity
  - Bulk delete (admin): deletes eligible, skips guarded tickets
  - Non-agent cannot perform bulk actions

**`tests/e2e/advanced-tickets.spec.ts`** (new file):

- **Mark as duplicate:**
  - Agent marks ticket as duplicate → ticket closes, system post appears in timeline
  - "Duplicate of #X" label visible with link to original
  - Agent removes duplicate link → label disappears, status unchanged
  - Regular user does not see "Mark as Duplicate" button

- **Merge tickets:**
  - Agent merges source into target → source becomes read-only stub with merge banner
  - Source ticket shows merge banner template text with link to target
  - Posts from source appear in target's timeline
  - Reply form hidden on merged ticket stub
  - Merge is irreversible (no "unmerge" button)

- **Delete ticket:**
  - Admin sees "Delete" button on open ticket detail
  - Confirmation prompt appears before deletion
  - After deletion, redirected to agent dashboard
  - Delete button disabled/error on closed ticket
  - Non-admin does not see "Delete" button

- **Bulk actions on agent dashboard:**
  - Checkboxes appear on ticket list for agents
  - "Select all on this page" checkbox works
  - Bulk action toolbar appears when tickets selected
  - Bulk close: selected tickets change to closed status
  - Bulk assign: selected tickets assigned to chosen agent
  - Bulk unassign: selected tickets lose assignment
  - Bulk add tags: tags appear on selected tickets
  - Bulk set severity: severity updated on selected tickets
  - Bulk delete (admin): eligible tickets deleted, skipped tickets show warning
  - Regular user does not see checkboxes or bulk toolbar

## Implementation Notes

- **Merge is the most complex operation.** Process steps sequentially to avoid race conditions. Use a single Server Action call that performs all steps atomically (as much as Supabase allows — there are no multi-table transactions via JS client, so execute steps in order and handle partial failures gracefully).
- **Bulk actions and notifications:** For each bulk operation, collect all recipients across all affected tickets into a single set, then send ONE notification per recipient. Do not send per-ticket notifications.
- **Merged ticket detection:** Check `merged_into_id IS NOT NULL` at the top of the ticket detail page rendering to switch to stub mode. No need for a separate route.
- **Client components for bulk selection:** The agent dashboard's checkbox/selection state must be client-side (architecture constraint 2 does not allow this, but bulk checkbox state management is inherently interactive). Keep the `"use client"` wrapper minimal — just state for selected IDs and toolbar rendering. The actual ticket list remains server-rendered.
- **Template rendering:** Fetch templates from `notification_templates` and use simple string replacement for `{{placeholders}}`. No need for a full templating engine.
- **Severity comparison for merge:** Use a severity map: `{ low: 1, medium: 2, high: 3, critical: 4 }` to compare source and target severity numerically.

## Deferred Features (Added by Later Phases)

- AI duplicate detection (Phase 19) — semantic similarity check on ticket creation
- Tier-based override of which users can set severity/tags on their own tickets (Phase 20)

## Verification Checklist

- [ ] Mark as duplicate: sets `duplicate_of_id`, closes ticket, inserts system post from template
- [ ] Mark as duplicate: no CSAT scheduling, no status-change notifications, no SLA alerts
- [ ] Remove duplicate link: clears `duplicate_of_id`, does not change status
- [ ] Merge: posts/comments/notes/attachments/activity-log move from source to target
- [ ] Merge: followers deduplicated (union); source owner becomes follower of target
- [ ] Merge: tags combined (union); target's type/category/urgency preserved
- [ ] Merge: severity inheritance (higher severity wins, SLA recalculated if changed)
- [ ] Merge: source CSAT survey cancelled; source SLA frozen
- [ ] Merge: source ticket closed with `merged_into_id`, merge post from template
- [ ] Merge: source ticket stub page is read-only with merge banner
- [ ] Merge: no redirect — source remains accessible at original URL
- [ ] Merge: irreversible (no undo/unmerge)
- [ ] Delete ticket: admin only, closed tickets rejected, dependency guards enforced
- [ ] Delete ticket: cascading cleanup (posts, followers, activity log)
- [ ] Delete ticket: logged in admin audit log
- [ ] Bulk close: updates status, skips merged/already-closed, handles CSAT/SLA side effects
- [ ] Bulk assign/unassign: updates assignment, validates target agent
- [ ] Bulk add/remove tags: modifies ticket_tags
- [ ] Bulk set severity: updates severity, recalculates SLA
- [ ] Bulk delete: admin only, respects same guards as single delete
- [ ] Bulk notifications: one email per recipient per operation (batched)
- [ ] Bulk in-app notifications: one notification per recipient per operation
- [ ] Agent dashboard: checkboxes, "Select all", bulk action toolbar
- [ ] Admin template sections: duplicate, merge post, merge banner, bulk summary editable
- [ ] Activity log entries for all operations (duplicate, merge, bulk)
- [ ] `npm run typecheck` passes with no errors
- [ ] `npm run lint` passes with no errors
- [ ] `npm run test:db` passes advanced-tickets tests
- [ ] `npm run test:e2e` passes advanced-tickets e2e tests
