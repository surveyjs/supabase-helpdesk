# Phase 5 — Teams, Types, Categories, Tags

## Context

You are building team ticket views and taxonomy management for a **HelpDesk** application. Read `docs/requirements.md` sections 4, 5, 6, 7 and `docs/design.md`.

Phases 0–4 are complete: project init, database schema with RLS, authentication, user-facing ticket CRUD, and agent dashboard. The database already has the `teams`, `ticket_types`, `categories`, `tags`, and `ticket_tags` tables (created in Phase 1 migration `001_core_schema.sql`), along with RLS policies for admin-only management. Seed data includes 8 users, "Alice's Team" (Alice/Bob/Carol), 3 default ticket types (Question/Issue/Suggestion), 9 tickets with posts/comments/notes, and auto-follow entries. **No new migration is needed for existing tables** — this phase adds seed data, UI, and Server Actions on top of the existing schema.

## Tasks

### 1. Seed Data Update

Extend `supabase/seed.sql` to add reference data per `docs/seed-data.md`:

**Categories** (3):
- "Billing"
- "Technical"
- "Account"

**Tags** (5, with distinct colors):
- "urgent" — red (#EF4444)
- "bug" — orange (#F97316)
- "feature-request" — blue (#3B82F6)
- "documentation" — teal (#14B8A6)
- "UI" — purple (#8B5CF6)

**Tag assignments** on existing tickets — assign 2–3 tags to 4–5 of the 9 seeded tickets to exercise tag display and filtering.

**Category assignments** — assign categories to 4–5 of the 9 seeded tickets (mix of Billing, Technical, Account).

> **Important:** Seed data must be appended to the existing `seed.sql`, not replacing it. Insert categories and tags after the ticket data section. Then UPDATE existing tickets to set `category_id`. Insert into `ticket_tags` for tag assignments.

### 2. Team Tickets View (User Side)

Update `src/app/(main)/tickets/page.tsx`:

- Add toggle buttons above the ticket list: **"My Tickets"** (default) and **"Team Tickets"**
- Use URL search param `?view=team` for the team tickets view; default (no param or `?view=my`) shows My Tickets
- Only show the toggle if the current user belongs to a team (check `profile.team_id`)
- **My Tickets**: same as current behavior (user's own tickets)
- **Team Tickets**: show all tickets created by any member of the user's team, sorted by `updated_at` DESC. Each entry shows the same info as My Tickets (title, last-updated, status badge) **plus the submitter's display name** so the user can see which teammate created the ticket
- Team Tickets uses the same pagination, search, and status filter as My Tickets
- The search in Team Tickets searches by title and original post body (same `search_vector` approach as My Tickets)

### 3. Ticket Types Management (Admin)

This is a preliminary standalone page. Phase 7 will move it into the Admin Setup sidebar layout. For now, create a simple page.

**`src/app/(main)/admin/types/page.tsx`**:
- Require admin role (redirect non-admins)
- List all ticket types with their names and a "(default)" indicator
- For each type: rename form (inline), delete button (with confirmation), set-as-default button
- Add new type form at the bottom
- Deleting a type that is in use by tickets shows an error (FK constraint prevents it)
- Setting a new default unsets the previous default

**Server Actions** (`src/lib/actions/admin.ts` — new file):
- `createTicketType(name)` — require admin, validate name (max 100 chars, non-empty), insert, revalidate
- `renameTicketType(typeId, newName)` — require admin, validate name, update, log to admin audit (Phase 7 adds full audit log; for now just do the update), revalidate
- `deleteTicketType(typeId)` — require admin, attempt delete (DB will reject if in use), revalidate
- `setDefaultTicketType(typeId)` — require admin, unset current default, set new default, revalidate

### 4. Categories Management (Admin)

**`src/app/(main)/admin/categories/page.tsx`**:
- Require admin role
- List all categories with rename/delete controls
- Add new category form
- Same patterns as ticket types management
- Deleting a category in use shows an error

**Server Actions** (add to `src/lib/actions/admin.ts`):
- `createCategory(name)` — require admin, validate name (max 100 chars), insert, revalidate
- `renameCategory(categoryId, newName)` — require admin, validate, update, revalidate
- `deleteCategory(categoryId)` — require admin, attempt delete (DB rejects if in use), revalidate

### 5. Tags Management (Admin)

**`src/app/(main)/admin/tags/page.tsx`**:
- Require admin role
- List all tags showing name as a colored pill (using the tag's color)
- For each tag: rename form, color picker (hex input or predefined palette), delete button
- Add new tag form with name + color input
- Deleting a tag removes it from all tickets (CASCADE on `ticket_tags`)

**Server Actions** (add to `src/lib/actions/admin.ts`):
- `createTag(name, color)` — require admin, validate name (max 50 chars), validate color (max 20 chars, valid hex format), insert, revalidate
- `renameTag(tagId, newName)` — require admin, validate, update, revalidate
- `updateTagColor(tagId, newColor)` — require admin, validate hex, update, revalidate
- `deleteTag(tagId)` — require admin, delete (CASCADE removes from ticket_tags), revalidate

### 6. Team Management (Admin)

**`src/app/(main)/admin/teams/page.tsx`**:
- Require admin role
- List all teams with member count
- Create new team form (name, max 100 chars)
- Rename team (inline form)
- Delete team (only if no members — check and show error if members exist)
- Click/expand each team to see member list
- Add member: search by email input, form to add user to team. If user is already on another team, show warning: "This user is currently on team '{name}'. Adding them here will remove them from that team."
- Remove member: button next to each member

**Server Actions** (add to `src/lib/actions/admin.ts`):
- `createTeam(name)` — require admin, validate name (max 100 chars), insert, revalidate
- `renameTeam(teamId, newName)` — require admin, validate, update, revalidate
- `deleteTeam(teamId)` — require admin, check no members (query profiles where team_id = teamId), reject if any, delete, revalidate
- `addTeamMember(teamId, userEmail)` — require admin, find user by email, update their `team_id`, revalidate
- `removeTeamMember(userId)` — require admin, set `team_id = null`, revalidate

### 7. Tag Display & Agent Tag Management on Tickets

Update `src/app/(main)/tickets/[id]/[slug]/page.tsx`:
- Fetch the ticket's tags (JOIN through `ticket_tags` → `tags`)
- Display tags as colored pills in the ticket metadata section (only if at least one tag is defined in the system)
- For agents: show an "Add Tag" dropdown (listing all available tags not already on the ticket) and a "Remove" button on each tag pill
- Tag add/remove uses Server Actions (no page reload needed — `<form>` + revalidate)

**Server Actions** (add to `src/lib/actions/agent.ts`):
- `addTagToTicket(ticketId, tagId)` — require agent role, insert into `ticket_tags`, log in `activity_log`, revalidate
- `removeTagFromTicket(ticketId, tagId)` — require agent role, delete from `ticket_tags`, log in `activity_log`, revalidate

### 8. Tag Filter on Agent Dashboard

Update `src/app/(main)/agent/page.tsx`:
- Add a tag filter control to the filter bar. Only show if at least one tag is defined.
- The tag filter should be a multi-select mechanism (e.g., clickable tag pills or checkboxes). When tags are selected, show tickets that have **any** of the selected tags (OR logic).
- Tag filter uses URL search params (e.g., `?tags=tagId1,tagId2`)
- Combine with all existing filters

Update `src/lib/queries/agent-dashboard.ts`:
- Add tag filtering to `getAgentTickets()`:
  - When tag IDs are provided, filter tickets that appear in `ticket_tags` for any of those tag IDs
  - This requires a subquery or JOIN against `ticket_tags`
- Add `getFilterOptions()` to also return available tags (for the filter UI)

### 9. Category Display on Ticket Detail

Update the ticket detail page to show the category (if set) in the metadata section. This was partially done in Phase 3 — verify it displays correctly with actual category data. If not present, add it:
- Show "Category: {name}" in the metadata section (only if a category is set)
- The category was already made selectable in the creation form (Phase 3) and changeable by agents (Phase 4)

### 10. NavBar Update

Update `src/components/layout/NavBar.tsx`:
- Add a "Setup" link visible only to admins, inside the user menu dropdown as the first item, pointing to `/admin/types` (Phase 7 will change this to `/admin` with a sidebar)

### 11. Tests

**`tests/db/005-teams-tags.test.ts`** (new file):
- Seed data verification: 3 categories exist, 5 tags exist with correct colors
- Tag assignments: verify seeded tickets have expected tags
- Category assignments: verify seeded tickets have expected categories
- Admin can create/rename/delete a ticket type
- Admin can create/rename/delete a category
- Admin can create/rename/delete a tag (with color)
- Deleting a type in use is rejected
- Deleting a category in use is rejected
- Deleting a tag removes it from ticket_tags (CASCADE)
- Non-admin cannot create/modify types, categories, or tags (RLS enforced)
- Agent can add/remove tags on tickets
- Non-agent user cannot modify ticket_tags
- Team tickets: user can read teammates' private tickets
- Team tickets: user cannot read non-teammate's private tickets
- Admin can create/rename/delete a team
- Admin can add/remove team members
- Deleting a team with members is rejected (ON DELETE RESTRICT on profiles.team_id)
- Setting default type works (partial unique index)
- Only one default type allowed

**`tests/e2e/teams-tags.spec.ts`** (new file):
- Team tickets toggle: user on a team sees toggle, user not on team doesn't
- Team tickets view: shows teammates' tickets with display names
- Ticket detail shows tags as colored pills
- Agent can add a tag to a ticket → tag appears
- Agent can remove a tag from a ticket → tag disappears
- Agent dashboard tag filter: selecting a tag shows only matching tickets
- Admin types page: create, rename, delete type, set default
- Admin categories page: create, rename, delete category
- Admin tags page: create tag with color, rename, change color, delete
- Admin teams page: create team, add member, remove member, delete empty team
- Admin teams page: cannot delete team with members (error shown)
- Non-admin cannot access admin pages (redirected)

## Implementation Notes

- All admin pages are Server Components — forms use `<form>` + Server Actions
- All management pages use the same visual style: white card, centered content, consistent with design.md
- Tag colors should be stored as hex values. Render tag pills with inline `style={{ backgroundColor: color }}` and use contrasting text color (white text for dark backgrounds, dark text for light backgrounds). A simple heuristic: if the hex value's relative luminance is below 0.5, use white text; otherwise use dark text.
- The admin pages created here are standalone. Phase 7 will reorganize them into a sidebar layout at `/admin/*`. Structure the page components so they can easily be extracted into child components of an admin layout.
- `ticket_tags` has CASCADE on delete for `tag_id`, so deleting a tag automatically removes all its assignments — no manual cleanup needed
- `teams` has RESTRICT on delete from `profiles.team_id`, so deleting a team with members will be rejected by the DB — catch the error and show a user-friendly message

## Deferred Features (Added by Later Phases)

- Category display on agent dashboard — verify it already works from Phase 4 filters
- Tag filter combined with saved views — saved views (Phase 4) already serialize all URL params, so tag params will be included automatically
- Admin audit log entries for management actions — Phase 7

## Verification Checklist

- [ ] Seed data includes 3 categories and 5 tags with correct colors
- [ ] Tags are assigned to seeded tickets
- [ ] Team tickets toggle appears for team members
- [ ] Team tickets view shows teammates' tickets with display names
- [ ] Tag pills display on ticket detail with correct colors
- [ ] Agent can add/remove tags on tickets
- [ ] Agent dashboard tag filter works with other filters
- [ ] Admin can manage ticket types (CRUD + set default)
- [ ] Admin can manage categories (CRUD)
- [ ] Admin can manage tags (CRUD with colors)
- [ ] Admin can manage teams (CRUD + member management)
- [ ] Non-admin redirected from admin pages
- [ ] Deleting in-use types/categories shows error
- [ ] `npm run typecheck` passes with no errors
- [ ] `npm run lint` passes with no errors
- [ ] `npm run test:db` passes teams/tags tests
- [ ] `npm run test:e2e` passes teams/tags e2e tests
