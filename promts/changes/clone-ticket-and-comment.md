# Change: Clone (Copy) a Ticket and Clone (Copy) a Comment into a New Ticket

Implements [issue #49](https://github.com/surveyjs/supabase-helpdesk/issues/49).

## Summary

Add two agent-only operations to the ticket detail page:

1. **Clone a ticket** — create a brand-new ticket that copies the metadata and the
   original post of an existing ticket.
2. **Clone a comment into a new ticket** — take an individual user post/comment from a
   thread and spin it off into its own new ticket, then replace the original
   comment in the source thread with a system message linking to the new ticket.

Both operations are admin-template-driven (see *Templates* below) and produce a new
ticket **owned by the original user** (not the agent who performed the action).

> **Flow (revised):** Clone is a two-step, review-before-create flow. The Clone
> controls are **links** to the standard create-ticket page (`/tickets/new`) with a
> `clone_from=<ticketId>` or `clone_post=<postId>` query param. That page prefills
> the create form from the source (title, body with origin note, type, category,
> urgency, privacy, custom fields) and points **Cancel** back at the source ticket.
> **Nothing is written until the agent submits the form.** On submit, `createTicket`
> re-resolves the source server-side, inserts the new ticket owned by the original
> author via the service role, copies tags, records lineage, and — for a comment
> clone — replaces the source comment. If the agent cancels, no ticket is created and
> the source comment is left untouched.

## Design decisions (confirmed with product)

| Decision | Choice |
|---|---|
| Who owns the cloned ticket? | The **original author** — `creator_id` = source ticket's `creator_id` (ticket clone) or the **comment's author** (comment clone). |
| What happens to the source comment when cloned? | Its body is **replaced** (edited in place, not deleted) with an admin-defined templated message containing a link to the new ticket. The previous body is preserved in the activity log. |
| What does a cloned ticket copy? | Subject (newly generated), type, category, urgency, severity, custom fields, privacy, and **tags**. The thread (replies, comments, notes) is **not** copied. |
| New ticket's original post | The source's original post body (ticket clone) or the comment body (comment clone), **prefixed** with an admin-defined templated note linking back to the source ticket. |
| Where do the links resolve? | Use the canonical-redirect form `/tickets/{{ticketId}}/redirect` (the `[id]/[slug]` page redirects a non-matching slug to the canonical URL — same convention as the duplicate/merge templates, see `032_fix_template_ticket_urls.sql`). |
| When is the clone created? | **On the agent's explicit submit** of the prefilled create form, not on the Clone click. Cancel returns to the source ticket and writes nothing (the comment clone's source-comment replacement also happens only on submit). |
| Who creates it / via which action? | The existing `createTicket` action, made clone-aware. It owns the clone to the original author (service role) and runs the clone side effects. There is **no** dedicated `cloneTicket`/`cloneCommentToTicket` form action. |

## Prerequisites (already in place)

| What | Where |
|---|---|
| `tickets` table (`id BIGSERIAL`, `duplicate_of_id`/`merged_into_id BIGINT`) | `supabase/migrations/001_core_schema.sql` |
| `posts` table (`id UUID`, `is_original`, `post_type`) | `supabase/migrations/001_core_schema.sql` |
| `ticket_tags`, `ticket_followers`, `activity_log` tables | `supabase/migrations/001_core_schema.sql` |
| `notification_templates` pattern + `duplicate_post` / `merge_post` precedent | `015_advanced_tickets.sql`, `src/lib/actions/duplicate.ts`, `src/lib/actions/merge.ts` |
| `DEFAULT_TEMPLATES` / `TEMPLATE_PLACEHOLDERS` / `TEMPLATE_LABELS` | `src/lib/constants/notification-templates.ts` |
| Admin template editor (categories + reset-to-default) | `src/app/(main)/admin/templates/page.tsx` |
| `generateSlug`, `initializeSlaTimer`, `requireAgentRole` pattern | `src/lib/utils/slug.ts`, `src/lib/utils/sla.ts`, `duplicate.ts` |
| Existing advanced-action UI (placement reference) | `MarkAsDuplicateForm.tsx`, `MergeTicketForm.tsx`, `page.tsx` lines ~454 (post actions) and ~961 (Advanced panel) |

---

## Changes

### 1. Migration — `supabase/migrations/033_clone_ticket_and_comment.sql`

```sql
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
```

`ON DELETE SET NULL` keeps lineage references from blocking deletion of a source
ticket/post.

### 2. Template constants — `src/lib/constants/notification-templates.ts`

Add to all three maps (keep bodies identical to the migration defaults so
"Reset to default" matches the seed):

```ts
// DEFAULT_TEMPLATES
clone_origin_note: {
  subject: 'Cloned ticket origin note',
  body: 'This ticket is a copy of a post from [#{{ticketId}}](/tickets/{{ticketId}}/redirect).',
},
clone_comment_reply: {
  subject: 'Comment cloned to a new ticket',
  body: 'Hello {{userName}}, I created a separate ticket on your behalf: [{{ticketTitle}}](/tickets/{{ticketId}}/redirect).',
},

// TEMPLATE_PLACEHOLDERS
clone_origin_note: ['ticketId'],
clone_comment_reply: ['userName', 'ticketTitle', 'ticketId'],

// TEMPLATE_LABELS
clone_origin_note: 'Clone Origin Note',
clone_comment_reply: 'Clone Comment Reply',
```

In `src/app/(main)/admin/templates/page.tsx`, add both event types to the
`'Auto-Replies & System'` category array (alongside `duplicate_post`, `merge_post`)
so they appear in the admin editor with placeholder hints and a reset button.

### 3. Clone helpers — `src/lib/actions/clone.ts`

A server-only helper module (no `'use server'` — nothing here is a form action):

- `renderTemplate(svc, eventType, values)` — render a template body, falling back to
  `DEFAULT_TEMPLATES` when the row is missing.
- `resolveCloneSource(cloneFromRaw, clonePostRaw): Promise<CloneSource | null>` —
  resolve a source from `clone_from` (ticket id) or `clone_post` (post uuid) and
  return everything both the prefill page and the create action need:
  `{ kind, sourceTicketId, sourceSlug, ownerId, severity, sourcePostId, authorName,
  prefill: { title, body, typeId, categoryId, urgency, isPrivate, customFields } }`.
  Applies the guards: a **merged stub** is not clonable; for a comment clone the post
  must exist and **must not be the original post or a private note**. The `prefill.body`
  is the source body (original post or comment) with the rendered `clone_origin_note`
  prepended. The caller does the agent-role check.
- `finalizeClone(svc, { source, agentId, newTicketId, newTitle })` — side effects run
  **after** the clone ticket + original post are created: copy the source's tags,
  record lineage in the activity log (`cloned_to`+`cloned_from` for a ticket clone;
  `cloned_from` + a source-side `comment_cloned` for a comment clone), and for a comment
  clone render `clone_comment_reply` and replace the source post body (preserving the
  previous body in the `comment_cloned` log entry).

There is **no** `cloneTicket`/`cloneCommentToTicket` form action; creation goes through
`createTicket`.

### 3a. `createTicket` integration — `src/lib/actions/tickets.ts`

After validation, before the insert, read `clone_from`/`clone_post` from the form. When
present **and** the actor is an agent, call `resolveCloneSource` and:
- pick the DB client: `createServiceRoleClient()` for a clone (owner ≠ acting agent, so
  RLS would block the insert), otherwise the normal RLS client;
- set `creator_id`/`author_id` to `clone.ownerId` (else `user.id`);
- on the ticket insert add `severity: clone.severity`, `cloned_from_id`,
  `cloned_from_post_id`;
- **skip `claimInlineAttachments`** for clones (claiming would re-point the source's
  attachments — copied bodies keep referencing the source's attachment URLs; known
  limitation);
- start the SLA timer with `clone.severity ?? 'medium'`;
- after insert, call `finalizeClone(...)` and `revalidatePath` the source ticket, then
  redirect to the new ticket as usual.

The submitted (possibly edited) title/body/type/urgency/category/privacy/custom-fields are
used as-is — the origin note is already part of the prefilled body, so it is **not**
re-added on submit.

### 4. UI — Clone a ticket link

`src/app/(main)/tickets/[id]/[slug]/CloneTicketButton.tsx` is a server component that
renders a **Clone** `next/link` (`data-testid="clone-ticket-btn"`) to
`/tickets/new?clone_from=${ticketId}`. Wired into the **Advanced** `<dd>` block in
`page.tsx` (next to `MarkAsDuplicateForm`/`MergeTicketForm`) under the same
`isAgent && !ticket.merged_into_id && !ticket.duplicate_of_id` guard.

### 5. UI — Clone a comment link

`src/app/(main)/tickets/[id]/[slug]/CloneCommentButton.tsx` is a server component that
renders a **Clone to new ticket** `next/link` (`data-testid="clone-comment-btn"`) to
`/tickets/new?clone_post=${postId}`. Props: `{ postId: string }` (no inline title form —
the title is edited on the prefilled create page). Wired into the post action row in
`page.tsx` (next to Delete), gated to agents on real user content:

```tsx
{isAgent && !isOriginal && !isNote && !isDraft && !ticket!.merged_into_id && (
  <CloneCommentButton postId={post.id} />
)}
```

### 6. Create-ticket page + form prefill

`src/app/(main)/tickets/new/page.tsx` reads `clone_from`/`clone_post`; for an agent it
calls `resolveCloneSource` and passes the prefill into `TicketForm` (`initialTitle`,
`initialBody`, `initialType`, `initialCategory`, `initialUrgency`, `initialPrivate`,
`initialCustomFields`), plus `cloneFromId`/`cloneFromPostId` (rendered as hidden
`clone_from`/`clone_post` inputs) and `cancelHref` pointing at the source ticket. The
heading switches to **Clone Ticket**. `TicketForm` applies these as the field defaults,
prefills the Markdown editor via its `defaultValue`, and points the **Cancel** link at
`cancelHref` (defaulting to `/tickets`). Stable test ids: `create-ticket-btn`,
`cancel-ticket-btn`.

---

## Specification changes — `docs/requirements.md`

1. **Permissions matrix** (the table around lines 33–42): add a row
   `| Clone ticket / clone comment to a new ticket | — | ✓ | ✓ |`.

2. **New section 9.7 — Clone (copy) a ticket.** An agent can create a copy of an
   existing ticket from the ticket detail page (Advanced panel). The new ticket is
   **owned by the original ticket's creator**, with a newly generated subject
   (`"Copy of <title>"`) and copied type, category, urgency, severity, custom
   fields, privacy, and tags. The new ticket's original post is the source's
   original post body, prefixed with an admin-configurable note linking back to the
   source ticket (see 16.30; default: *"This ticket is a copy of a post from
   [#{{ticketId}}](link)."*). The thread (replies, comments, notes) is **not**
   copied. A fresh SLA timer starts; the creator auto-follows. Lineage is recorded
   (`cloned_from_id`) and the activity log records `cloned_to` on the source and
   `cloned_from` on the new ticket. The agent is redirected to the new ticket.
   Cloning a merged stub is not allowed.

3. **New section 9.8 — Clone (copy) a comment into a new ticket.** An agent can spin
   an individual user post or comment off into its own new ticket from the post's
   action row. The new ticket is **owned by the comment's author**, copies the source
   ticket's type/category/urgency/severity/privacy, and uses the comment body as its
   original post (prefixed with the same origin note as 9.7, see 16.30). The agent
   supplies/confirms the new subject (defaulting to `"Copy of <source title>"`). The
   **original comment in the source thread is replaced** (edited, not deleted) with an
   admin-configurable system message linking to the new ticket (see 16.31; default:
   *"Hello {{userName}}, I created a separate ticket on your behalf:
   [{{ticketTitle}}](link)."*). The replaced text's previous body is retained in the
   activity log (`comment_cloned`). The original post of a ticket and private notes
   cannot be cloned this way (use 9.7 for the former). The agent is redirected to the
   new ticket. *Known limitation: inline image attachments referenced in cloned
   bodies continue to point at the source ticket's attachments.*

4. **New section 16.30 — Clone origin note template.** A section to edit the Markdown
   template prepended to the original post of a cloned ticket, linking back to the
   source. Supports `{{ticketId}}`. Reset-to-default available. (See 9.7, 9.8.)

5. **New section 16.31 — Clone comment reply template.** A section to edit the Markdown
   template that replaces the original comment in the source thread when a comment is
   cloned to a new ticket. Supports `{{userName}}`, `{{ticketTitle}}`, `{{ticketId}}`.
   Reset-to-default available. (See 9.8.)

6. **Activity log tracked events (13.2):** add ticket clone (`cloned_to` on source,
   `cloned_from` on new ticket) and comment clone (`comment_cloned`, retaining the
   replaced comment's previous body).

7. **Admin audit log (16.24):** add template edits/resets for the two new clone
   templates to the list of logged template events.

> If `docs/design-system/docs/requirements.md` is a maintained mirror, apply the same
> edits there; otherwise update only `docs/requirements.md`.

---

## Tests

### DB test — `tests/db/033-clone.test.ts`

- `tickets.cloned_from_id` and `cloned_from_post_id` columns exist and accept a value;
  deleting the referenced ticket/post sets them to `NULL` (`ON DELETE SET NULL`).
- `clone_origin_note` and `clone_comment_reply` rows exist in `notification_templates`
  with the expected default bodies/placeholders.
- (Optional, mirroring `016-advanced-tickets.test.ts` which exercises data logic via
  the service client) replicate the clone data flow: insert a source ticket + original
  post, perform the inserts a `cloneTicket` would, and assert the new ticket has the
  copied fields, the prefixed original post, copied tags, and `cloned_from_id` set.

### E2E test — `tests/e2e/clone.spec.ts` (or extend `advanced-tickets.spec.ts`)

Set up source tickets via the service client (as `advanced-tickets.spec.ts` does).

- **Agent clones a ticket:** log in as an agent, open a source ticket, click
  `clone-ticket-btn`. Assert it lands on `/tickets/new` with the title prefilled to
  `Copy of …` and the description containing the origin-note link to the source. Click
  `create-ticket-btn`; assert redirect to a new ticket. Via the service client, assert
  the new ticket's `creator_id` is the source creator and its tags match the source.
- **Cancel creates nothing:** click `clone-ticket-btn`, then `cancel-ticket-btn` on the
  create page; assert the browser returns to the source ticket and (service client) no
  new `cloned_from_id` row was created.
- **Agent clones a comment:** open a ticket with a user comment, click
  `clone-comment-btn`. On the prefilled create page edit the title and click
  `create-ticket-btn`. Assert redirect to a new ticket owned by the comment author whose
  original post contains the comment body + origin note, and that the source comment was
  replaced with the `clone_comment_reply` text linking to the new ticket.
- **Comment cancel leaves the comment untouched:** click `clone-comment-btn`, then
  `cancel-ticket-btn`; assert (service client) the source comment body is unchanged.
- **Permissions:** a regular (non-agent) user does **not** see `clone-ticket-btn` or
  `clone-comment-btn`.

---

## Acceptance Criteria

1. Agents can clone a ticket; the clone is owned by the original creator, copies
   type/category/urgency/severity/custom-fields/privacy/tags, and its original post is
   prefixed with the configurable origin note linking to the source.
2. Agents can clone a user post/comment into a new ticket owned by the comment author;
   the source comment is replaced with the configurable reply text linking to the new
   ticket, and the previous body is preserved in the activity log.
3. Cloning the original post or a private note via the comment-clone action is
   rejected; cloning a merged stub is rejected.
4. Both clone templates are editable and resettable in the admin template editor.
5. Lineage (`cloned_from_id` / `cloned_from_post_id`) is set and is cleared
   (`SET NULL`) when the referenced ticket/post is deleted.
6. Non-agents see no clone controls.
7. `npm run typecheck` passes.
8. `npm run lint` passes.
9. `npm run test` passes (unit + db, including `033-clone.test.ts`).
10. `npm run test:e2e -- tests/e2e/clone.spec.ts` passes.

## Verification Checklist

- [ ] Migration `033_clone_ticket_and_comment.sql` adds both columns (+ FK `SET NULL`) and seeds both templates
- [ ] `notification-templates.ts` adds both event types to all three maps (bodies match the seed)
- [ ] `admin/templates/page.tsx` lists both new templates in the editor
- [ ] `clone.ts` exports `cloneTicket` and `cloneCommentToTicket` (service-role inserts, template rendering, activity log, redirect)
- [ ] `cloneTicket` copies metadata + tags, prefixes the origin note, owns the clone to the source creator
- [ ] `cloneCommentToTicket` owns the clone to the comment author, replaces the source comment, rejects originals/notes/merged stubs
- [ ] `CloneTicketButton` wired into the Advanced panel; `CloneCommentButton` wired into the post action row (agent-only)
- [ ] `requirements.md` updated: permissions row, 9.7, 9.8, 16.30, 16.31, 13.2, 16.24
- [ ] DB test + E2E test added and passing
