# Phase 6 — Posts, Comments & Notes

## Context

You are building the full post interaction layer for a **HelpDesk** application. Read `docs/requirements.md` sections 11, 12, 13.1–13.3, and `docs/architecture.md` constraints 1, 2, 8, 9, 10.

Phases 0–5 are complete: project init, database schema, authentication, ticket CRUD, agent dashboard, and teams/types/categories/tags. The database already has the `posts` table with `post_type` (post/comment/note), `parent_post_id`, `parent_comment_id`, `is_private`, `is_draft`, `is_original`, and `edited_at` columns. RLS policies on `posts` are already in place from Phase 1.

Phase 3 implemented basic post rendering (root posts only, no comments/notes visible to users). This phase adds the full comment threading, internal notes, drafts, post editing, title editing, privacy controls, collapsible timeline, and activity log display.

## Tasks

### 1. Migration: `supabase/migrations/004_posts.sql`

Add a constraint to enforce the 2-level nesting limit for comments:

```sql
-- Prevent 3rd-level nesting: a comment cannot be a reply to a comment that already has a parent_comment_id
CREATE OR REPLACE FUNCTION check_comment_nesting()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.parent_comment_id IS NOT NULL THEN
    -- Check if the parent comment is itself a reply to another comment
    IF EXISTS (
      SELECT 1 FROM posts
      WHERE id = NEW.parent_comment_id
      AND parent_comment_id IS NOT NULL
    ) THEN
      RAISE EXCEPTION 'Comments can only be nested up to 2 levels';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER enforce_comment_nesting
  BEFORE INSERT ON posts
  FOR EACH ROW
  WHEN (NEW.post_type = 'comment')
  EXECUTE FUNCTION check_comment_nesting();
```

Also add a trigger to update `tickets.updated_at` when a post is published from draft (the existing `posts_update_ticket_timestamp` trigger fires on INSERT but not on UPDATE of `is_draft`):

```sql
CREATE OR REPLACE FUNCTION update_ticket_on_draft_publish()
RETURNS TRIGGER AS $$
BEGIN
  IF OLD.is_draft = true AND NEW.is_draft = false THEN
    UPDATE tickets SET updated_at = now() WHERE id = NEW.ticket_id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER posts_draft_publish_timestamp
  AFTER UPDATE OF is_draft ON posts
  FOR EACH ROW
  EXECUTE FUNCTION update_ticket_on_draft_publish();
```

### 2. Server Actions

**Update `src/lib/actions/tickets.ts`**:

- `addComment(formData)`:
  - Validate: body required (max 50,000 chars), parent_post_id required, optional parent_comment_id
  - If `parent_comment_id` is provided, verify it's not a 2nd-level comment (to prevent 3-level nesting)
  - Check user can access the ticket
  - Check user is not blocked
  - If ticket is duplicate and user is not agent: reject
  - Insert post with `post_type = 'comment'`
  - If ticket is pending/closed and user is not agent: auto-transition to 'open'
  - Revalidate page

- `addNote(formData)`:
  - Require agent role
  - Validate: body required (max 50,000 chars), ticket_id required
  - Insert post with `post_type = 'note'`, `is_private = true` (notes are always internal)
  - No status auto-transition for notes
  - Revalidate page

- `editPost(formData)`:
  - Validate: body required (max 50,000 chars), post_id required
  - Fetch the post
  - **Permission check:**
    - Author can edit their own posts/comments — this includes the original post (the ticket creator is the original post's author and may therefore edit the ticket description)
    - Agents can edit any post or comment (regardless of authorship), including the original post
    - Agents can only edit their **own** notes — not notes by other agents
  - Update body and set `edited_at = now()`. The DB trigger `posts_update_ticket_search` keeps the ticket's `search_vector` in sync when the original post body changes
  - Revalidate page

- `editTicketTitle(formData)`:
  - Validate: title required (max 300 chars), ticket_id required
  - Check: ticket owner or agent
  - Update title and regenerate slug
  - Log title change in `activity_log` (old title → new title)
  - Revalidate page

- `deletePost(postId)`:
  - Fetch the post
  - **Permission check:**
    - Original post cannot be deleted
    - Regular users cannot delete any posts/comments
    - Agents can delete any post or comment (except original)
    - Agents can only delete their **own** notes
    - Admins can delete any note regardless of authorship
  - Delete post (CASCADE deletes child comments and attachments)
  - Revalidate page

- `togglePostPrivacy(postId)`:
  - Require agent role
  - Cannot toggle privacy on the original post
  - Toggle `is_private` on the post
  - Log privacy change in `activity_log`
  - Revalidate page

- `saveDraft(formData)`:
  - Require agent role
  - Validate: body required (max 50,000 chars), ticket_id required, post_type (post/comment/note)
  - Insert post with `is_draft = true`
  - Revalidate page

- `publishDraft(postId)`:
  - Require agent role
  - Verify post is a draft and belongs to current agent
  - Set `is_draft = false`
  - Log "draft published" in `activity_log`
  - Revalidate page

### 3. Ticket Detail Page Updates

Significantly update `src/app/(main)/tickets/[id]/[slug]/page.tsx`:

#### 3.0 Posts / Notes Tab Separation

Create `src/app/(main)/tickets/[id]/[slug]/TicketTabs.tsx` — a `"use client"` component:
- Two tabs: "Posts" and "Notes"
- "Posts" tab shows the timeline of all non-note posts, comments, activity entries, and the reply form
- "Notes" tab shows all internal notes chronologically and the note form at the bottom
- Note count badge on the Notes tab
- `data-testid="ticket-tabs"` on container, `data-testid="posts-tab"` and `data-testid="notes-tab"` on buttons

**Only agents see tabs.** Regular users see the posts stream directly — no `TicketTabs` component is rendered. Users never see notes or the Notes tab.

Split rendered posts in the server component:
- `notePosts = renderedPosts.filter(p => p.post_type === 'note')`
- `nonNotePosts = renderedPosts.filter(p => p.post_type !== 'note')`
- Build the timeline from `nonNotePosts` only
- Pass both to `TicketTabs` for agents; render only the posts stream for users

#### 3a. Full Post Rendering with Threaded Comments

Replace the current flat post list with a threaded view:

- **Original post**: always rendered first, styled as the ticket description
- **Root posts** (`post_type = 'post'`, `parent_post_id IS NULL`, `NOT is_draft OR (is_draft AND viewer is agent)`): rendered in chronological order after the original post
- **Comments** on each post: rendered indented beneath their parent post, sorted chronologically
  - Level-1 comments: indented once, with a "Reply" link
  - Level-2 comments (replies to comments): indented twice, **no** "Reply" link (max 2 levels)
- **Notes** (`post_type = 'note'`): rendered only for agents **in the Notes tab** (not in the Posts timeline), with amber/yellow background and "Internal Note" label
- **Drafts** (`is_draft = true`): rendered only for agents, with a dashed border and "Draft" label. Show a "Publish" button. No reply/comment actions on drafts.

Each post/comment/note shows:
- Author display name
- Timestamp (relative for recent, absolute for older)
- "(edited)" indicator if `edited_at` is set
- Markdown body rendered to sanitized HTML
- **Edit** button: shown for author (and agents on posts/comments; agents on own notes only)
- **Delete** button: shown for agents on non-original posts/comments; agents on own notes; admins on all notes
- **Reply** button: on posts and level-1 comments (not on level-2 comments, not on drafts, not on notes)
- **Privacy toggle** (agents only): "Make Private" / "Make Public" on non-original posts

#### 3b. Inline Edit Form

When the user clicks "Edit" on a post/comment/note:
- Replace the rendered body with a `<MarkdownEditor>` component pre-filled with the current Markdown body, with `viewMode`, `minHeightPx`, and `maxHeightPx` from the user's profile preferences (`editor_view_mode`, `editor_min_height_px`, `editor_max_height_px`)
- Show "Save" and "Cancel" buttons
- On save: call `editPost` Server Action
- On cancel: revert to rendered view
- This requires a `"use client"` wrapper component for the edit toggle state (permitted — minimal interactivity)

#### 3c. Inline Comment/Reply Forms

- Each post has a "Reply" link that reveals an inline comment form (`<MarkdownEditor name="body" compact viewMode={editorViewMode} minHeightPx={editorMinHeightPx} maxHeightPx={editorMaxHeightPx}>` + "Comment" button). The editor opens at the agent's preferred initial height and grows as they type, up to the maximum.
- Each level-1 comment has a "Reply" link that reveals a reply form
- Forms call `addComment` Server Action with appropriate `parent_post_id` and `parent_comment_id`
- These are `<form>` elements with hidden fields for IDs

#### 3d. Note Form (Agent Only)

- Inside the **Notes tab** (not below the reply form), show the "Add Internal Note" section
- `<MarkdownEditor name="body" compact viewMode={editorViewMode}>` with "Add Note" button
- Notes are always private — no privacy checkbox needed
- Calls `addNote` Server Action

#### 3e. Draft Controls (Agent Only)

- On the reply/note/comment forms, agents see an additional "Save as Draft" button alongside the normal submit button
- Clicking "Save as Draft" calls `saveDraft` instead of the normal form action
- Draft posts appear in the timeline with visual distinction (dashed border, "Draft" badge)
- Each draft shows: "Publish" button (calls `publishDraft`), "Edit" and "Delete" buttons

#### 3f. Title Editing

- If the current user is the ticket owner or an agent: show an "Edit" icon/button next to the ticket title
- Clicking it transforms the title into an editable input with "Save" and "Cancel" buttons
- On save: call `editTicketTitle` Server Action, which also updates the slug
- This requires a `"use client"` wrapper for the inline edit toggle

#### 3g. Collapsible Timeline (§3.4.1)

Implement progressive disclosure for long tickets:

- Read **visible posts threshold** from `app_settings` (key `visible_posts_threshold`, default 10) and **visible comments threshold** (key `visible_comments_threshold`, default 3). These settings were seeded in Phase 1.
  - **Note:** If these keys don't exist in `app_settings` yet, add them to the seed data or use hardcoded defaults (10 and 3).
- The **original post** is always visible at the top
- Show the most recent **N** root posts (with their comments, notes, and inline activity entries)
- If the ticket has more than N root posts, collapse the older ones behind a **"Show X older posts"** button between the original post and the visible recent posts
- The collapse/expand is a `"use client"` component (architecture constraint 2f) that toggles visibility in place
- For **comment threads**: show the most recent **M** comments per post. If more exist, show a **"Show X older comments"** link that expands in place
- Activity log entries interspersed chronologically (see Task 3h)

#### 3h. Activity Log Display

- Fetch `activity_log` entries for the ticket, sorted chronologically
- Render activity entries inline in the timeline as compact system messages (gray text, smaller font, no background card):
  - "Agent Smith changed status from open to pending"
  - "Agent Smith assigned Agent Jones"
  - "Agent Smith added tag 'urgent'"
  - "Alice changed title from 'X' to 'Y'"
  - etc.
- Activity entries are interleaved chronologically with posts
- Activity entries follow the same collapsible rules as posts (older activity entries collapse with older posts)
- Agent-only activity (notes-related) is visible only to agents

### 4. Markdown Rendering Updates

**`src/lib/utils/markdown.ts`**:
- Verify the existing `renderMarkdown()` function handles all GFM features: tables, strikethrough, task lists, autolinks
- Ensure the sanitization config allows `<table>`, `<thead>`, `<tbody>`, `<tr>`, `<th>`, `<td>` elements (for GFM tables)
- Ensure `<del>` (strikethrough) and `<input type="checkbox" disabled>` (task lists) are allowed

**`src/components/features/tickets/MarkdownEditor.tsx`** (replaces `MarkdownPreview.tsx`):
- Verify the client-side editor/preview renders consistently with server-side rendering
- Rich Markdown editor using `react-markdown-editor-lite` with built-in toolbar, code block support, native image paste (`onImageUpload` prop) and an **Attach file(s)** toolbar button / drop dialog (`onAttachmentUpload` prop) — see `promts/changes/attach-files.md`
- Both server-rendered HTML and editor preview must use the same sanitization configuration (both use `markdown-it`)
- This component is an **abstraction layer** — it is the ONLY file that imports `react-markdown-editor-lite`. Swapping editors requires changing only this file.

### 5. Tests

**`tests/db/006-posts.test.ts`** (new file):
- Comment nesting: level-1 comment on a post succeeds
- Comment nesting: level-2 reply on a comment succeeds
- Comment nesting: level-3 reply (on a level-2 comment) is rejected by trigger
- Post editing: author can edit own post → `edited_at` is set
- Post editing: agent can edit any post/comment
- Post editing: agent can edit own note only, not other agent's note
- Post editing: original post cannot be edited via editPost
- Post deletion: agent can delete non-original post
- Post deletion: original post cannot be deleted
- Post deletion: agent can delete own note, not other agent's note
- Post deletion: admin can delete any note
- Post deletion: regular user cannot delete any post
- Draft visibility: draft post is not visible to regular users (RLS)
- Draft visibility: draft post is visible to agents
- Publishing a draft: `is_draft` changes to false, `tickets.updated_at` updates
- Post privacy: private post is visible to owner, teammates, and agents; not to other users
- Post privacy: making a post private hides its comments from non-authorized users
- Note visibility: notes are only visible to agents (RLS)
- Title editing: owner can update title via SQL (tests the DB-level behavior)
- Title editing: slug is regenerated on title change (verify via `generate_slug()`)

**`tests/e2e/posts-comments.spec.ts`** (new file):
- Add a reply to the ticket → reply appears (uses MarkdownEditor — interact via `[data-testid="markdown-editor"] textarea`)
- Add a comment on a post → comment appears indented (uses MarkdownEditor compact)
- Reply to a comment → reply appears at level 2
- Level-2 comment has no "Reply" action
- Agent sees "Posts" and "Notes" tabs on ticket detail (`data-testid="ticket-tabs"` visible)
- Regular user does not see tab bar (`data-testid="ticket-tabs"` not visible)
- Agent can add an internal note → click "Notes" tab first, fill MarkdownEditor, note visible to agent in Notes tab
- Note not visible to regular user — also verify no `ticket-tabs` element
- Note does not appear in the "Posts" tab for agents
- Edit a post → "(edited)" indicator shows (edit mode renders MarkdownEditor)
- Edit title → URL redirects to new slug
- Agent can create a draft post → shows with "Draft" badge
- Agent publishes draft → post becomes visible to users
- Agent can make a post private → privacy badge shows, non-authorized users can't see it
- Agent can delete a non-original post → post disappears
- Activity log entries display inline (e.g., status change shows in timeline)
- Collapsible timeline: ticket with >10 posts shows "Show older posts" link
- Collapsible timeline: expanding shows hidden posts
- Two-column layout: sidebar shows metadata (Type, Created by fields visible in `data-testid="ticket-sidebar"`)
- Markdown editor shows toolbar with code formatting button

## Implementation Notes

- **Client components**: This phase introduces several small `"use client"` wrappers:
  - Inline edit toggle (post editing, title editing) — uses `<MarkdownEditor>` in edit mode
  - Collapsible timeline expand/collapse
  - Comment/reply form reveal — uses `<MarkdownEditor compact>`
  - `TicketTabs` — Posts/Notes tab switcher (agents only)
  All must be minimal — no application state management. They wrap server-rendered content with a toggle.

- **Post rendering order**: Fetch all posts for the ticket in one query. Sort and group in the Server Component:
  1. Separate notes from non-notes: `notePosts` vs `nonNotePosts`
  2. Original post (always first in Posts tab)
  3. Root posts (non-notes) + activity entries, interleaved chronologically
  4. For each root post: comments sorted chronologically, with nesting
  5. Notes rendered separately in the Notes tab (agents only)
  6. Apply visibility filters: agents see all; users see non-draft, non-note, non-private (unless owner/teammate)

- **Privacy inheritance**: When a post is made private, all its comments become effectively private (they are children of the private post). The `get_root_post_is_private()` function (Phase 1) handles this at the RLS level.

- **Draft rules**: Drafts do not accept comments or replies. The "Reply" action is hidden on all drafts regardless of who views them.

- **Edit history**: No edit history is kept. Editing overwrites the body and sets `edited_at`.

## Deferred Features (Added by Later Phases)

- File attachments on posts — Phase 8
- Email notifications for new posts — Phase 9
- Realtime updates for new posts — Phase 10
- Draft publish trigger for notifications — Phase 9 (notification coalescing)
- Inline image paste in the Markdown editor — see
  `promts/changes/inline-image-paste.md` (post-create / edit Server Actions
  must invoke `claimInlineAttachments(postId, body)` after every insert /
  update so orphan attachments get linked to the new post).
- **Attach file(s)** toolbar button + drop dialog supporting any
  admin-allowed file type (not just images) — see
  `promts/changes/attach-files.md`. Re-uses the same orphan-claim flow as
  the inline image paste; no extra Server Action plumbing required
  beyond `claimInlineAttachments`.

## Verification Checklist

- [ ] Comments appear threaded (indented) under their parent post
- [ ] Level-2 comments have no Reply action
- [ ] 3rd-level nesting is rejected
- [ ] Notes are visible only to agents, in the Notes tab (not in Posts timeline)
- [ ] Agents see Posts and Notes tabs; regular users see no tabs
- [ ] Notes tab shows note count badge
- [ ] Drafts are visible only to agents, with "Publish" action
- [ ] Publishing a draft makes it visible to users
- [ ] Post editing shows "(edited)" indicator
- [ ] Title editing updates the slug and URL
- [ ] Private posts are hidden from unauthorized users
- [ ] Collapsible timeline works for long tickets
- [ ] Activity log entries display inline in the timeline
- [ ] Markdown renders correctly (tables, code blocks, links)
- [ ] `npm run typecheck` passes with no errors
- [ ] `npm run lint` passes with no errors
- [ ] `npm run test:db` passes post/comment tests
- [ ] `npm run test:e2e` passes post/comment e2e tests
