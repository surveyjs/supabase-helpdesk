# Ticket Detail: New Thread Design + Remove Status From Sidebar Title

## Summary

Apply the posts-thread redesign documented in `docs/design-system/thread-redesign.jsx` and `docs/design-system/Posts Thread Redesign.html` to the ticket detail page, and remove the duplicate status badge from the ticket-info sidebar's top row. Status remains editable in the sidebar via the existing SurveyJS form.

This is a **visual + structural** change to the thread. It does **not** change:

- Server actions or RLS.
- The SurveyJS sidebar form (`TicketSidebarSurvey`) and the dispatch layer.
- The Activity Logs tab or its visibility rules.
- Internal-note storage (still `post_type = 'note'`).
- Editor / Markdown / canned-response wiring.

---

## Motivation

The current layout has two recurring problems flagged in `thread-redesign.jsx` / the annotated `ThreadOriginalAnnotated` variation:

1. **Comment ownership is unclear.** Two identical "Add a comment" buttons sit at the bottom of the thread with no spatial link to a specific post.
2. **Tabs sit mid-conversation** because the original post is rendered above them, making the tab bar look like a divider.
3. **Status appears twice.** The sidebar shows a `<Badge variant="status">` next to `#123` *and* a Status dropdown inside the SurveyJS form — they go out of sync visually whenever the form is being edited.

The redesign attaches a `Reply` button (and a one-click composer) to each post, folds the original post into the conversation as the first post (with an `Original post` pill), and removes the duplicate status badge.

---

## Changes

### 1. Thread layout — `src/app/(main)/tickets/[id]/[slug]/page.tsx`

#### 1a. Move the original post into the Conversation tab

Currently:

```
Subject + meta
[Original post card]   ← rendered above tabs
[Thread | Notes | Logs] tabs
  Thread:  reply posts only
```

New:

```
Subject + meta (no status badge — already removed from main column)
[Conversation | Internal notes | Logs] tabs
  Conversation:
    Post 1 — original (pill: "Original post")
    Post 2
    …
    Post N
    [Reply to this ticket…]   ← bottom composer pill
```

- Remove the "Original post — always visible above tabs" block.
- Include `originalPost` as the first item passed into `renderTimelineItems(...)` for the Conversation tab.
- Drop the `data-testid="thread-tab"` rename if needed → keep as `thread-tab`, but display label is **"Conversation"** (`TicketTabs` label change only). `notes-tab` label becomes **"Internal notes"** (with a small lock glyph in the label, matching the design system) — `logs-tab` is unchanged.

#### 1b. Flatten the comment hierarchy to a single nesting level

The current code allows three levels (post → comment → comment-of-comment) via `level: 0 | 1 | 2`, `commentsByParentComment`, and `ml-6 / ml-12` indents. The new design has exactly two levels:

- **Posts** are the timeline items.
- **Comments** belong to a single parent post and render directly underneath the post card with a `border-l-2 border-gray-100 pl-4 ml-5` rail.

Action:

- Collapse the level-2 branch in `renderPostCard`. Any existing level-2 records (replies whose `parent_comment_id` is set) are re-parented in the rendered tree to their grand-parent post (i.e. shown as flat comments under the post). No DB migration; this is a render-only flatten.
- Remove the `parentCommentId` prop path through `ReplyToggle` for new replies created from the redesigned UI — replies always create a comment whose parent is the post, never a comment-of-comment. Keep the column in the schema; existing rows still render correctly because they collapse upward.

#### 1c. Per-post composer (`Reply` button attached to the post)

Replace the current pattern (a `ReplyToggle` rendered *outside and below* the post card, with `ml-6` indent) with the design pattern:

- The post card's footer has a single inline button: **`↩ Reply`** + a `· N comments` counter.
- Clicking `Reply` reveals an `InlineComposer` rendered **inside the comments list** of that post (under the `border-l-2` rail), so it visually belongs to the post.
- The composer has: textarea, attach button, markdown hint, internal-note checkbox (agents only — same as today's `NoteForm` logic), Cancel, Send.
- For agents, an internal-note checkbox toggles the composer's amber styling (`border-amber-300 bg-amber-50/40`) and routes the submission to the existing note-creation server action; for users it is hidden.

Implementation notes:

- `ReplyToggle.tsx` is rewritten to render inline the composer at the bottom of the comments list of its parent post (caller passes `parentPostId` only).
- A new small client component `PostInlineActions.tsx` (or inline JSX in `renderPostCard`) renders the `Reply` button and toggles `ReplyToggle`'s open state.

#### 1d. Adaptive collapse (per-post and per-thread)

The redesign defines two thresholds that reproduce smoothly as a thread grows:

```ts
const COMMENT_INLINE_MAX = 2;   // ≤ 2 comments → show all inline
const COMMENT_TAIL       = 2;   // > 2 → show last 2, hide rest behind "Show N earlier comments"
const POST_INLINE_MAX    = 4;   // ≤ 4 posts → show all
const POST_TAIL          = 2;   // > 4 → show first + last 2, fold middle behind "Show N earlier replies"
```

- The **comment fold** replaces `CollapsibleComments`. The trigger label is **"Show N earlier comment(s)"** with a chevron-up (a rotated `chevron`).
- The **post fold** replaces the existing `CollapsibleTimeline` rule. The post fold keeps **the first** post (now the original) and the last `POST_TAIL` posts, hiding the middle. The trigger label is **"Show N earlier replies"** rendered as a `CollapsedPostsRow` styled like a small timeline node with a connector line.

Keep the existing `CollapsibleTimeline.tsx` file for the Logs tab if used there; reuse / adjust internally for the new fold layout.

#### 1e. Avatar gutter + connector line

Each post is laid out as a flex row of `Avatar` (32px circle, initials, role-tinted) + card. A 1px gray connector line runs down the avatar gutter behind subsequent posts so the timeline reads as a single thread. Implementation per `thread-redesign.jsx`:

```tsx
<li className="relative">
  {!isLast && <span className="absolute left-[19px] top-10 bottom-0 w-px bg-gray-200" />}
  <div className="flex gap-3">
    <Avatar … />
    <div className="flex-1 min-w-0">
      <article className="rounded-lg border border-gray-200 bg-white">
        … header + body + `Reply` button …
      </article>
      … nested comments + composer …
    </div>
  </div>
</li>
```

#### 1f. Post header pills

Each post header shows the author name (link), then small pills:

- `Agent` (blue) — when `author.role === 'agent'`.
- `Original post` (gray) — when `is_original`.
- `Private` (amber, with lock glyph) — when `is_private` and not a note.
- Notes use the amber card variant (`border-amber-300 bg-amber-50`) and a `Lock · Internal note` pill, matching today's behavior.

The trailing meta cluster (right-aligned) keeps the relative timestamp + the existing `…` actions menu (Edit / Make public / Delete). Delete and Make-public/private actions stay routed through the existing server actions — only their layout moves into a `…` popover (already partially done in `EditablePost`; the redesign converts the inline `Delete` / `Make Private` text links in `renderPostCard`'s action row into items in the popover for posts, mirroring the design).

#### 1g. Bottom-of-thread composer

Replace the always-visible `MainReplyToggle` with the design's two-state pattern:

- **Closed:** a full-width pill with `Avatar` + `Reply to this ticket…` + a `Markdown supported` hint on the right.
- **Open:** the same `InlineComposer` used per post, with autoFocus.

The expanded state still mounts `ReplyForm` (so AI suggested-reply, attachments, editor preferences keep working). The closed pill is the new visual; the open form is the existing `ReplyForm`.

---

### 2. Sidebar — remove status badge from the title row

File: `src/app/(main)/tickets/[id]/[slug]/page.tsx`, the right `<aside data-testid="ticket-sidebar">` block.

Current:

```tsx
{/* Ticket # and status */}
<div className="flex items-center justify-between mb-3">
  <span className="text-xs text-gray-500 font-mono">#{ticket.id}</span>
  <Badge variant="status" value={ticket.status} />
</div>
```

New:

```tsx
{/* Ticket # */}
<div className="mb-3">
  <span className="text-xs text-gray-500 font-mono">#{ticket.id}</span>
</div>
```

- The `Badge` import becomes unused in `page.tsx` if no other usage remains — clean up the import.
- Status is still visible and editable inside `TicketSidebarSurvey` (driven by `ticket-detail-policy.ts`) — no policy change.
- `data-testid="ticket-sidebar"` and any test IDs on existing rows stay the same.

---

### 3. New / updated components

| File | Change |
|---|---|
| `page.tsx` | Wire originalPost into the Conversation tab; flatten level-2 comments; remove `<Badge variant="status">` from sidebar title; rewire `MainReplyToggle` placement. |
| `TicketTabs.tsx` | Rename labels: `Thread → Conversation`, `Notes → Internal notes`; lock glyph next to "Internal notes". Keep `data-testid` values unchanged. |
| `ReplyToggle.tsx` | Render the composer **inside** the comments list of the parent post (under the `border-l-2` rail); single `parentPostId` prop. |
| `MainReplyToggle.tsx` | Two-state pill → composer. |
| `CollapsibleTimeline.tsx` / `CollapsibleComments` | Update fold visuals + labels (`Show N earlier replies` / `Show N earlier comment(s)`); ensure first-post-kept fold pattern when overflowing. |
| New (optional): `PostInlineActions.tsx` | Inline `Reply` button + comment counter footer. May be inlined in `renderPostCard` to avoid an extra file. |

`EditablePost.tsx`, `CommentForm.tsx`, `NoteForm.tsx`, `ReplyForm.tsx`, `TicketSidebarSurvey.tsx`, `ticket-detail-policy.ts`, `ticket-detail-dispatch.ts`, server actions, AI summary panel, attachment list — **unchanged**.

---

### 4. Tests

Update only what the layout move actually breaks:

- `tests/e2e/ticket-detail*` selectors that target the standalone "Original post" block above the tabs need to look inside the Conversation tab now.
- Snapshot/markup tests that asserted the sidebar contained `Badge variant="status"` in the title row need to look for the Status field inside the SurveyJS sidebar form instead (already covered by `ticket-sidebar-survey` test ID).
- Add coverage for: comment fold trigger when a post has > 2 comments; post fold when a thread has > 4 posts; per-post `Reply` button revealing the inline composer; agent internal-note checkbox in the per-post composer; closed→open transition of the bottom "Reply to this ticket…" pill.
- Re-verify accessibility: per-post `Reply` button has `aria-expanded`; the inline composer is focused on open.

---

## Out of scope

- Editor changes (Markdown, view-mode preference, canned responses) — already covered by other prompts under `promts/changes/`.
- SLA / CSAT / suggested-articles sidebar cards — visuals untouched.
- Mobile-specific overrides beyond what flows from the existing flex layout.
- Any change to `parent_comment_id` schema; comment-of-comment rows are flattened at render time only.

## Acceptance

1. The ticket detail page renders the original post as the first item in the Conversation tab; no separate "Original post" card sits above the tabs.
2. The right sidebar's first row shows only `#<ticket-id>`. There is no `Badge variant="status"` next to it.
3. Each post in the timeline has its own `Reply` button; clicking it opens a composer attached to that post.
4. Threads with more than 4 posts collapse the middle behind a single "Show N earlier replies" trigger; posts with more than 2 comments collapse older comments behind a "Show N earlier comments" trigger.
5. The bottom-of-thread main composer is a closed pill until clicked.
6. All existing server actions, RLS-gated permissions, SurveyJS sidebar autosave behavior, and Logs / Internal notes tab visibility rules continue to work unchanged.
