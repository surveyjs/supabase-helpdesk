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

## Design decisions (confirmed with product)

| Decision | Choice |
|---|---|
| Who owns the cloned ticket? | The **original author** — `creator_id` = source ticket's `creator_id` (ticket clone) or the **comment's author** (comment clone). |
| What happens to the source comment when cloned? | Its body is **replaced** (edited in place, not deleted) with an admin-defined templated message containing a link to the new ticket. The previous body is preserved in the activity log. |
| What does a cloned ticket copy? | Subject (newly generated), type, category, urgency, severity, custom fields, privacy, and **tags**. The thread (replies, comments, notes) is **not** copied. |
| New ticket's original post | The source's original post body (ticket clone) or the comment body (comment clone), **prefixed** with an admin-defined templated note linking back to the source ticket. |
| Where do the links resolve? | Use the canonical-redirect form `/tickets/{{ticketId}}/redirect` (the `[id]/[slug]` page redirects a non-matching slug to the canonical URL — same convention as the duplicate/merge templates, see `032_fix_template_ticket_urls.sql`). |

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

### 3. New server actions — `src/lib/actions/clone.ts`

Follow the structure of `duplicate.ts`/`merge.ts`:
- Reuse the local `requireAgentRole()` helper (server client + role check).
- Use `createServiceRoleClient()` for the cross-user inserts/updates, because the
  new ticket's `creator_id` is **not** the acting agent and RLS insert policies
  require `creator_id = auth.uid()` (same reason `merge.ts` uses the service role).
- A shared helper renders a template body and substitutes placeholders
  (`replace(/\{\{key\}\}/g, value)`), falling back to the `DEFAULT_TEMPLATES` body
  when the row is missing.

#### `cloneTicket(formData: FormData): Promise<void>`

1. `requireAgentRole()`; `ticketId = Number(formData.get('ticket_id'))`; bail if falsy.
2. Fetch source: `id, title, slug, type_id, category_id, urgency, severity, is_private, custom_fields, creator_id, merged_into_id`.
3. Guard: source must exist; **skip if `merged_into_id`** (a stub has no usable content).
4. Fetch the source original post body (`is_original = true`).
5. New title: `Copy of ${source.title}` (truncate to the 300-char column limit); `slug = generateSlug(newTitle)`.
6. Render `clone_origin_note` with `{{ticketId}} = source.id`; new original body =
   `${renderedNote}\n\n${sourceOriginalBody}`.
7. Insert the new ticket (service role): copy `type_id, category_id, urgency, severity, is_private, custom_fields`; set `creator_id = source.creator_id`, `cloned_from_id = source.id`, `title`, `slug`. Select `id, slug`.
8. Insert the new original post (`author_id = source.creator_id, is_original = true, post_type = 'post', body = combined`).
9. Copy tags: read `ticket_tags` for the source, insert the same `tag_id`s for the new ticket.
10. Auto-follow: insert `ticket_followers { new ticket, source.creator_id }`.
11. `initializeSlaTimer(newId, source.severity).catch(...)`.
12. Activity log: on source `action: 'cloned_to' { new_ticket_id }`; on new ticket `action: 'cloned_from' { source_ticket_id: source.id }`.
13. `revalidatePath('/agent')`, `revalidatePath('/tickets/${source.id}/${source.slug}')`, then `redirect('/tickets/${newId}/${newSlug}')`.

#### `cloneCommentToTicket(formData: FormData): Promise<void>`

1. `requireAgentRole()`; `postId = formData.get('post_id')` (UUID); optional `title = formData.get('title')`.
2. Fetch the post: `id, body, author_id, ticket_id, post_type, is_original`.
   - Guard: must exist; **reject `is_original`** (use Clone Ticket for that) and `post_type === 'note'` (private agent content).
3. Fetch the author profile (`display_name`) for `{{userName}}` and the source ticket
   (`id, title, slug, type_id, category_id, urgency, severity, is_private, merged_into_id`). Skip if the source is a merged stub.
4. New title: trimmed `title` from the form if provided, else `Copy of ${source.title}`; `slug = generateSlug(newTitle)`.
5. Render `clone_origin_note` with `{{ticketId}} = source.id`; new original body =
   `${renderedNote}\n\n${post.body}`.
6. Insert the new ticket (service role): copy `type_id, category_id, urgency, severity, is_private`; set
   `creator_id = post.author_id`, `cloned_from_id = source.id`, `cloned_from_post_id = post.id`, `title`, `slug`.
7. Insert the new original post (`author_id = post.author_id, is_original = true, post_type = 'post'`).
8. Auto-follow the author; `initializeSlaTimer(newId, source.severity)`.
9. **Replace the source comment**: render `clone_comment_reply` with
   `{{userName}} = author display_name (fallback to a generic label)`, `{{ticketTitle}} = newTitle`, `{{ticketId}} = newId`;
   `update posts set body = rendered, edited_at = now() where id = postId`.
10. Activity log on the source ticket: `action: 'comment_cloned' { post_id, new_ticket_id: newId, previous_body: post.body }`
    (mirrors how `deletePost`/`editPost` retain the prior body for audit).
11. `revalidatePath('/tickets/${source.id}/${source.slug}')`, `revalidatePath('/agent')`, then `redirect('/tickets/${newId}/${newSlug}')`.

> **Inline attachments:** do **not** call `claimInlineAttachments` on cloned bodies —
> claiming would re-point the source post's attachments to the new post. Copied
> bodies keep referencing the source's attachment URLs (acceptable for v1; note it
> in the spec as a known limitation).

### 4. UI — Clone a ticket button

New client component `src/app/(main)/tickets/[id]/[slug]/CloneTicketButton.tsx`,
modeled on `DeleteTicketButton`/`MarkAsDuplicateForm`:

- Renders a **Clone** button, `data-testid="clone-ticket-btn"`.
- On click, a `window.confirm("Create a copy of this ticket?")` then a form
  `action={cloneTicket}` with `<input type="hidden" name="ticket_id" value={ticketId} />`.

Wire it into `page.tsx` inside the existing **Advanced** `<dd>` block (next to
`MarkAsDuplicateForm`/`MergeTicketForm`, ~line 966), under the same
`isAgent && !ticket.merged_into_id && !ticket.duplicate_of_id` guard.

### 5. UI — Clone a comment button

New client component `src/app/(main)/tickets/[id]/[slug]/CloneCommentButton.tsx`:

- Renders a **Clone to new ticket** button, `data-testid="clone-comment-btn"`.
- On click, expands an inline form (`data-testid="clone-comment-form"`) with:
  - a title `<input name="title" data-testid="clone-comment-title-input" />` prefilled with `defaultTitle`,
  - a Confirm submit + Cancel,
  - `action={cloneCommentToTicket}` with `<input type="hidden" name="post_id" value={postId} />`.
- Props: `{ postId: string; defaultTitle: string }`.

Wire it into the post **action buttons** row in `page.tsx` (~line 454, next to the
Delete button), gated to agents on real user content:

```tsx
{isAgent && !isDraft && !post.is_original && post.post_type !== 'note' && !ticket.merged_into_id && (
  <CloneCommentButton postId={post.id} defaultTitle={ticket.title} />
)}
```

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
  `clone-ticket-btn`, confirm. Assert redirect to a new ticket whose title is
  `Copy of …`, whose original post contains the origin-note link to the source, and
  whose tags match the source. Assert the new ticket's `creator_id` is the source
  creator (via service client).
- **Agent clones a comment:** open a ticket with a user comment, click
  `clone-comment-btn`, set a title, confirm. Assert redirect to a new ticket owned by
  the comment author whose original post contains the comment body + origin note.
  Return to the source ticket and assert the original comment now shows the
  `clone_comment_reply` text linking to the new ticket.
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
