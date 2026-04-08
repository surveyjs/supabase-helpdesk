# Phase 3 — Ticket CRUD (User Side)

## Context

You are building the user-facing ticket functionality for a **HelpDesk** application. Read `docs/requirements.md` sections 2, 3.1–3.9, 3.12, 3.14, and `docs/design.md`.

Phases 0–2 are complete: project initialized, database schema with RLS, and authentication working.

## Tasks

### 1. Server Actions for Tickets

**`src/lib/actions/tickets.ts`**:

- `createTicket(formData)`:
  - Validate: title required (max 300 chars), body required (max 50,000 chars), urgency (valid enum), type (valid ID), category (optional valid ID), privacy (boolean)
  - Check creation rate limit (query tickets created in last 24h by this user)
  - Check user is not blocked
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
  - If ticket is pending/closed and user is not agent: transition to 'open'
  - Log status change in activity_log if status changed
  - Revalidate the page

### 2. Utility Functions

**`src/lib/utils/slug.ts`**:
- `generateSlug(title: string): string` — lowercase, replace non-alphanumeric with hyphens, trim

**`src/lib/utils/validation.ts`**:
- Reusable validation functions for title length, body length, required fields

**Important display rule:** Email addresses are never shown in ticket-facing UI (ticket lists, ticket detail, posts, comments). Always use display names. If no display name is set, show a placeholder (e.g., "User #123"). See requirement 20.3 / 8.2.

**`src/lib/utils/markdown.ts`**:
- `renderMarkdown(text: string): string` — convert Markdown to sanitized HTML **server-side** using `unified + remark-parse + remark-gfm + remark-rehype + rehype-sanitize + rehype-stringify`
- Safe subset only: headings, lists, links, code blocks, emphasis, images
- Strip script tags, event handlers, dangerous attributes
- **Note:** Do NOT use `react-markdown` for server rendering — it's a React component designed for client-side. Use the `unified` pipeline for server-side HTML string output. `react-markdown` is used only in the client-side Markdown preview component.

### 3. UI Components

**`src/components/ui/Badge.tsx`**:
- Status badge: green (open), yellow (pending), gray (closed)
- Priority badge with appropriate colors (low=blue, medium=teal, high=orange, critical=red)
- Reusable across the app

**`src/components/ui/Pagination.tsx`**:
- Previous/Next buttons + page numbers
- Uses URL search params (not React state)
- Server Component

**`src/components/features/tickets/TicketList.tsx`**:
- Server Component
- Renders a list of ticket entries: title, last-updated date, status badge
- Used on both "My Tickets" and "Team Tickets" views

**`src/components/features/tickets/StatusFilter.tsx`**:
- "All" / "Active" (open + pending) / "Closed" toggle buttons
- URL-based (search params)

**`src/components/features/tickets/TicketForm.tsx`**:
- Create ticket form with: title, type selector, urgency selector, category selector (if categories exist), body (textarea), privacy checkbox
- Server Action form submission
- Validation error display

**`src/components/features/tickets/MarkdownPreview.tsx`**:
- `"use client"` component (permitted by architecture constraint 2b)
- "Write" / "Preview" toggle tabs
- Preview renders Markdown client-side with same sanitization config

### 4. Pages

**`src/app/(main)/tickets/page.tsx`** — My Tickets:
- Paginated list of current user's tickets (sorted by updated_at DESC)
- Status filter (All / Active / Closed)
- Search field (search by title or original post body)
- Search and filter use URL search params
- "Create Ticket" button
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
- Show: title, type name, status badge, urgency badge, severity badge, category (if set), assigned agent display name (if any), creator display name, creation date
- Show original post first, then subsequent posts in chronological order
- Each post: author display name, timestamp, markdown body rendered to HTML
- Current user's posts: blue-tinted background; others: white
- Reply form at the bottom (textarea + "Reply" button)
- If ticket is duplicate: show banner with link to original

**`src/app/(main)/tickets/public/page.tsx`** — Browse Public Tickets:
- Paginated list of all public tickets
- Search field + status filter
- Accessible via link from tickets page
- If public access for unauthenticated visitors is enabled: accessible without login (Phase 7 will add the admin toggle)

### 5. NavBar Update

Update the NavBar to include:
- "My Tickets" link (for authenticated users)
- Role badges next to user name

### 5a. Seed Data Update

Extend `supabase/seed.sql` (created in Phase 2) to add:
- **9 tickets** across Alice, Bob, Carol, and Dave with realistic helpdesk subjects (password reset issues, feature requests, billing questions, bug reports, etc.) in mixed statuses (open, pending, closed)
- Dave has 2 tickets (testing no-team experience)
- Eve has no tickets (testing empty state per 3.3)
- Each ticket has an **original post** (is_original = true)
- Additional **posts**, **comments**, and **notes** simulating realistic agent–customer conversations
- This seed data is essential for testing all subsequent phases

### 6. Tests

**`tests/db/003-tickets.test.ts`**:
- User can create a ticket (own)
- User can read own ticket
- User cannot read another user's private ticket
- User can read public tickets
- Agent can read all tickets (including private)
- Teammate can read teammate's private ticket
- User cannot reply to a duplicate ticket
- Replying to closed/pending ticket transitions to open
- Rate limit: exceed limit and get rejected
- Content-length constraints enforced

**`tests/e2e/tickets.spec.ts`**:
- Create a ticket with all fields → appears in "My Tickets"
- Ticket detail shows correct metadata and posts
- Reply to a ticket → new post appears
- Search tickets by title → correct results
- Filter by status → correct results
- Slug redirect works (navigate to wrong slug → redirected)
- Empty state shown for user with no tickets
- Public tickets page shows only public tickets
- Cannot access another user's private ticket (shows 403 or redirects)

## Implementation Notes

- Install additional server-side markdown dependencies: `npm install unified remark-parse remark-gfm remark-rehype rehype-sanitize rehype-stringify`
- `react-markdown` (installed in Phase 0) is used only for the client-side MarkdownPreview component
- All data fetching is server-side (no client components except MarkdownPreview)
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
- [ ] `npm run test:db` passes ticket tests
- [ ] `npm run test:e2e` passes ticket e2e tests
