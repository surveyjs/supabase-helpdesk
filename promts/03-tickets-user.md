# Phase 3 — Ticket CRUD (User Side)

## Context

You are building the user-facing ticket functionality for a **HelpDesk** application. Read `docs/requirements.md` sections 2, 3.1–3.9, 3.12, 3.14, and `docs/design.md`.

Phases 0–2 are complete: project initialized, database schema with RLS, and authentication working.

## Tasks

### 1. Server Actions for Tickets

**`src/lib/actions/tickets.ts`**:

- `createTicket(formData)`:
  - Validate: title required (max 300 chars), body required (max 50,000 chars), urgency (valid enum), type (valid ID), category (optional valid ID), privacy (boolean)
  - Set `severity` to `'medium'` (DB default). Do NOT expose severity in the user-facing creation form — only agents can set severity.
  - Skip rate limit check if user is agent/admin (agents are exempt per §3.14)
  - Read the rate limit from `app_settings` (key `ticket_creation_rate_limit`, default 10, 0 = unlimited). Compare against ticket count from this user in last 24h. Note: The DB trigger `check_ticket_rate_limit` also enforces this as defense-in-depth. Both checks are intentional.
  - Check user is not blocked
  - Read `ticket_default_privacy` and `allow_user_privacy_control` from `app_settings`. If privacy control is disabled, ignore the form value and use the admin default. (Phase 7 builds the admin UI for these settings; for now, default to private.)
  - Generate slug from title
  - Insert ticket + original post (is_original = true) in a transaction
  - Auto-follow: insert ticket_followers row for creator
  - Redirect to `/tickets/{id}/{slug}`

- `replyToTicket(formData)`:
  - Validate: body required (max 50,000 chars)
  - Check user can access the ticket (own, public, teammate, or agent)
  - Check user is not blocked
  - Check ticket is not a duplicate (for non-agents)
  - Insert new post
  - If ticket is pending/closed and user is not agent: transition to 'open'. Agent replies never auto-transition status (§9.2).
  - Log status change in activity_log if status changed
  - Revalidate the page (`revalidatePath`)

### 2. Utility Functions

**`src/lib/utils/slug.ts`**:
- `generateSlug(title: string): string` — **must match the Postgres `generate_slug()` function exactly:** lowercase, strip non-alphanumeric (except spaces/hyphens), replace spaces with hyphens, collapse consecutive hyphens, trim leading/trailing hyphens, return `'untitled'` for empty/null/special-chars-only input.
- Slugs are NOT unique across tickets. The `{id}` in the URL is the authoritative identifier (§3.9).

**`src/lib/utils/validation.ts`**:
- Reusable validation functions for title length, body length, required fields

**Important display rule:** Email addresses are never shown in ticket-facing UI (ticket lists, ticket detail, posts, comments). Always use display names. If no display name is set, show a placeholder (e.g., "User #123"). See requirement 20.3 / 8.2.

**`src/lib/utils/markdown.ts`**:
- `renderMarkdown(text: string): string` — convert Markdown to sanitized HTML **server-side** using `unified + remark-parse + remark-gfm + remark-rehype + rehype-sanitize + rehype-stringify`
- Safe subset only: headings, lists, links, code blocks, emphasis, images
- Strip script tags, event handlers, dangerous attributes
- **Note:** Do NOT use `react-markdown` for server rendering — it's a React component designed for client-side. Use the `unified` pipeline for server-side HTML string output. `react-markdown` is used only in the client-side Markdown preview component.

### 2a. Search Infrastructure (Migration `003_tickets.sql`)

Phase 1 created a `search_vector` tsvector column and GIN index on `tickets`, with a trigger that indexes only the title. Phase 1 noted: "In Phase 3, this trigger will be extended to also include the first post body in the search vector."

Create migration **`supabase/migrations/003_tickets.sql`**:

1. **Extend `update_ticket_search_vector()`** to combine both the ticket title AND the original post body:
   ```sql
   CREATE OR REPLACE FUNCTION update_ticket_search_vector()
   RETURNS TRIGGER AS $$
   BEGIN
     NEW.search_vector := to_tsvector('english',
       COALESCE(NEW.title, '') || ' ' ||
       COALESCE((SELECT body FROM posts WHERE ticket_id = NEW.id AND is_original = true LIMIT 1), '')
     );
     RETURN NEW;
   END;
   $$ LANGUAGE plpgsql;
   ```

2. **Add a trigger on `posts`** that recalculates the parent ticket's `search_vector` when an original post (is_original = true) is inserted or its body is updated:
   ```sql
   CREATE OR REPLACE FUNCTION update_ticket_search_on_post()
   RETURNS TRIGGER AS $$
   BEGIN
     IF NEW.is_original THEN
       UPDATE tickets SET search_vector = to_tsvector('english',
         COALESCE(title, '') || ' ' || COALESCE(NEW.body, '')
       ) WHERE id = NEW.ticket_id;
     END IF;
     RETURN NEW;
   END;
   $$ LANGUAGE plpgsql;

   CREATE TRIGGER posts_update_ticket_search
     AFTER INSERT OR UPDATE OF body ON posts
     FOR EACH ROW EXECUTE FUNCTION update_ticket_search_on_post();
   ```

3. All search queries on My Tickets and Public Tickets pages **must use `to_tsquery('english', ...)` with the `search_vector` column** — do NOT use `ILIKE`.

### 3. UI Components

**`src/components/ui/Badge.tsx`**:
- Status badge: green (open), yellow (pending), gray (closed)
- Priority badge with appropriate colors (low=blue, medium=teal, high=orange, critical=red)
- Reusable across the app

**`src/components/ui/Pagination.tsx`**:
- Previous/Next buttons + page numbers
- Uses URL search params (not React state)
- Server Component
- Accept `pageSize` as a prop (hardcode to 20 for now; Phase 7 will read from `app_settings`)

**`src/components/features/tickets/TicketList.tsx`**:
- Server Component
- Renders a list of ticket entries: title, last-updated date, status badge
- Used on "My Tickets" page (Phase 5 adds a "Team Tickets" toggle)

**`src/components/features/tickets/StatusFilter.tsx`**:
- "All" / "Active" (open + pending) / "Closed" toggle buttons
- Implemented as `<Link>` elements updating URL search params — no `"use client"` needed
- Server Component

**`src/components/features/tickets/TicketForm.tsx`**:
- Create ticket form with: title, type selector, urgency selector, category selector (if categories exist), body (`<MarkdownEditor>` component), privacy checkbox
- Server Action form submission
- Validation error display

**`src/components/features/tickets/MarkdownEditor.tsx`**:
- `"use client"` component (permitted by architecture constraint 2b)
- **Abstraction layer** — this is the ONLY file importing the underlying editor library (`react-markdown-editor-lite`). Swapping to a different editor requires changes only here.
- Rich Markdown editor using `react-markdown-editor-lite` (dynamically imported with `ssr: false`)
- Uses `markdown-it` for preview rendering (consistent with server-side config)
- Built-in toolbar: bold, italic, headings, links, images, code blocks (fenced + inline), lists, tables, quotes
- Native image *paste* via `onImageUpload` prop. Drag-and-drop and the
  toolbar button now route through the new **Attach file(s)** dialog
  (`onAttachmentUpload` prop), supporting any admin-allowed file type.
  See `promts/changes/attach-files.md`.
- Hidden `<textarea>` with `name` attribute for Server Action form compatibility
- `compact` prop for smaller forms (comments, notes)
- `viewMode` prop (`'both' | 'preview' | 'editor'`) — controls editor/preview display, driven by user's `editor_view_mode` profile preference
- `minHeightPx` / `maxHeightPx` props — initial and maximum editor height in px (defaults `300` / `540`); the wrapper auto-grows from the initial height to the maximum as the user types, then scrolls internally. Driven by the agent's `editor_min_height_px` / `editor_max_height_px` profile preferences (migration 027).
- `extraToolbarPlugins` prop — allows injecting custom toolbar buttons (e.g., canned response plugin for agents)
- `onValueChange` callback for external text insertion (canned responses, AI suggestions)
- `data-testid="markdown-editor"` on wrapper div

### 4. Pages

**`src/app/(main)/tickets/page.tsx`** — My Tickets:
- Paginated list of current user's tickets (sorted by updated_at DESC)
- Status filter (All / Active / Closed)
- Search field (search by title or original post body)
- Search and filter use URL search params
- No page title heading (to avoid duplicating the selected top-nav label)
- "New Ticket" action is placed inside the search/filter control row (not a separate page header)
- **"Browse Public Tickets" link** (navigates to `/tickets/public`, per requirement 3.7)
- Empty state if no tickets (friendly message + link to create)
- Page size: default 20 (will be configurable by admin in Phase 7)

**`src/app/(main)/tickets/new/page.tsx`** — Create Ticket:
- Ticket creation form
- Fetch ticket types and categories from DB
- Show privacy checkbox (default based on admin setting — for now, default to private)

**`src/app/(main)/tickets/[id]/[slug]/page.tsx`** — Ticket Detail:
- Fetch ticket by ID
- If slug doesn't match current title slug: redirect 307 to correct URL
- Check access: own ticket, public ticket, teammate ticket (if on team), or agent
- **Full-width layout**: the ticket detail page uses full viewport width (overriding the `max-w-5xl` constraint from the main layout). Apply via a CSS breakout class `.ticket-detail-full-width` on the outermost wrapper or via a nested layout.
- **Two-column layout**: main content area (left, ~65-70%) with subject, posts timeline, and reply form; sidebar (right, ~30-35%) with ticket metadata, agent controls, and secondary info. Responsive: single-column on mobile, two-column on `lg+` breakpoint.
- **Sidebar** (`data-testid="ticket-sidebar"`): single sticky scrollable container (`lg:sticky lg:top-4 lg:max-h-[calc(100vh-2rem)] lg:overflow-y-auto`). Contains: ticket number (#123) as first field, type, category, status badge, urgency badge, severity badge, assigned agent, creator (+ team name §4.4), created date with relative time (e.g., "4/18/2026 (2 d ago)"), last updated, SLA, CSAT, tags, custom fields, follow/unfollow, agent controls, tier controls, user notes, AI summary. When the viewer is an agent, fields editable in Agent Controls (Type, Category, Urgency, Severity, Assignment, Privacy) are **hidden** from the Ticket Information section to avoid duplication. Uses compact inline `<dl>` layout (one `<dt>`+`<dd>` per line with `flex` and `w-28` label column).
- **Main area** (`data-testid="ticket-main-content"`): editable title only (no ticket #, no status badge, no border/hr under title), posts timeline (with Posts/Notes tabs for agents), reply form
- **No back-links** — no "← My Tickets" or "← Agent Dashboard" links. These are in the nav bar.
- **Phase 3 renders only root posts** (`post_type = 'post'` AND `NOT is_draft`). Comments, notes, threaded replies, post editing, and Posts/Notes tab separation are added in Phase 6. Post visibility is enforced by RLS.
- Show original post first, then subsequent posts in chronological order
- Each post: author display name, timestamp, markdown body rendered to HTML
- Current user's posts: blue-tinted background; others: white
- Reply form at the bottom of the main content area (uses `<MarkdownEditor>` component with `viewMode` from user profile)
- If ticket is duplicate: show banner with link to original (full-width, above the two-column layout)

**`src/app/(main)/tickets/public/page.tsx`** — Browse Public Tickets:
- Paginated list of all public tickets
- Search field + status filter
- Accessible via link from tickets page
- For now, require authentication (route is inside `(main)` layout). Phase 7 will add the admin toggle for unauthenticated access (`allow_public_ticket_browsing` in `app_settings`) and may move this route outside the authenticated layout or add a middleware exception.

### 5. NavBar Update

Nav links use active-state highlighting for the selected section (`aria-current="page"`, active styling) in both desktop and mobile nav menus. (Phase 7 may add a "Browse Tickets" link for unauthenticated visitors per req §1.5/16.10.)

### 5a. Seed Data Update

Extend `supabase/seed.sql` (created in Phase 2) to add:
- **9 tickets** with realistic helpdesk subjects (password reset issues, feature requests, billing questions, bug reports, etc.) in mixed statuses (open, pending, closed)
- Distribution: Alice: 3 tickets, Bob: 2 tickets, Carol: 2 tickets, Dave: 2 tickets. Eve: 0 tickets (testing empty state per §3.3).
- Dave has 2 tickets (testing no-team experience)
- Use the known user UUIDs established in Phase 2's seed.sql for `creator_id` values
- Assign `assigned_agent_id` on some tickets to test agent assignment display
- **Mark one ticket as a duplicate** of another (set `duplicate_of_id`) to test duplicate banner display and reply restriction
- Each ticket has an **original post** (is_original = true)
- Additional **posts**, **comments**, and **notes** simulating realistic agent–customer conversations (comments/notes will render in Phase 6 but must exist now for testing)
- This seed data is essential for testing all subsequent phases

> **Scope:** Phase 3 seeds only tickets, posts, comments, notes, and ticket_followers (auto-follow for creators). Categories, tags, and tag assignments are seeded in Phase 5 per the build-plan schedule.

### 6. Tests

**`tests/db/003-tickets.test.ts`**:
- User can create a ticket (own)
- User can read own ticket
- User cannot read another user's private ticket
- User can read public tickets
- Agent can read all tickets (including private)
- Teammate can read teammate's private ticket
- User cannot reply to a duplicate ticket
- Replying to closed/pending ticket transitions to open (for non-agent user)
- Agent reply does NOT auto-transition status
- Rate limit: exceed limit and get rejected
- Rate limit: agent is exempt from rate limit
- Content-length constraints enforced (title > 300, body > 50000 rejected)
- Creating a ticket automatically inserts a `ticket_followers` row for the creator
- Blocked user cannot insert into posts table (RLS denied)
- Blocked user cannot create tickets (RLS denied)
- Full-text search: `search_vector` is populated on ticket creation and matches `to_tsquery`
- Full-text search: `search_vector` updates when original post body changes

**`tests/e2e/tickets.spec.ts`**:
- Create a ticket with all fields → appears in "My Tickets"
- Ticket detail shows correct metadata in the sidebar (`data-testid="ticket-sidebar"`) — type, urgency visible
- Ticket detail shows team name next to creator display name in the sidebar (if on team)
- Reply to a ticket → new post appears (reply form uses MarkdownEditor — interact via `[data-testid="markdown-editor"] textarea`)
- Search tickets by title → correct results (uses full-text search)
- Filter by status → correct results
- Slug redirect works (navigate to wrong slug → redirected)
- Empty state shown for user with no tickets (Eve)
- Public tickets page shows only public tickets
- Accessing another user's private ticket returns 404 (not 403, to avoid revealing existence)
- Duplicate ticket shows banner with link to original
- Markdown in posts renders correctly (bold, links, code blocks)
- Post with `<script>` tag does not execute (XSS protection)
- Creating tickets beyond the rate limit shows an error message

## Implementation Notes

- Install additional server-side markdown dependencies: `npm install unified remark-parse remark-gfm remark-rehype rehype-sanitize rehype-stringify`
- Install rich Markdown editor: `npm install react-markdown-editor-lite markdown-it`
- `markdown-it` is used by the editor for preview rendering and should also be used server-side for post rendering
- `MarkdownEditor.tsx` is an abstraction layer — no other file imports `react-markdown-editor-lite` directly
- All data fetching is server-side (client components: MarkdownEditor, TicketForm)
- Search and filters are all URL search params
- The `tickets/[id]/[slug]` route uses Next.js dynamic segments
- Markdown is rendered server-side for posts; preview uses client-side rendering with the same config
- The original post is stored as a post with `is_original = true`

## Verification Checklist

- [ ] Create ticket flow works end-to-end
- [ ] My Tickets page shows paginated list with correct badges
- [ ] Ticket detail page shows all metadata and posts
- [ ] Reply adds a new post and appears in timeline
- [ ] Search filters tickets correctly
- [ ] Status filter works
- [ ] URL slug redirect works correctly
- [ ] Empty state displays for users with no tickets
- [ ] Public tickets browsable separately
- [ ] Rate limit blocks excessive creation
- [ ] Markdown renders safely (XSS protection)
- [ ] `npm run typecheck` passes with no errors
- [ ] `npm run lint` passes with no errors
- [ ] `npm run test:db` passes ticket tests
- [ ] `npm run test:e2e` passes ticket e2e tests
