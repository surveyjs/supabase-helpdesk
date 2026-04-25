# Phase 4 — Agent Dashboard (Basic)

## Context

You are building the Agent Dashboard for a **HelpDesk** application. Read `docs/requirements.md` sections 8.1–8.16 and 9.1–9.5.

Phases 0–3 are complete: project init, database schema, authentication, and user-facing ticket CRUD.

## Tasks

### 1. Server Actions for Agent Operations

**`src/lib/actions/agent.ts`**:

- `changeTicketStatus(ticketId, newStatus)`:
  - Require agent role
  - Reject if ticket has `merged_into_id` (merged tickets are read-only stubs)
  - Note: Duplicate/merge status constraints are fully enforced in Phase 17, but the action should not break invariants on such tickets
  - Update ticket status
  - Log in activity_log
  - Revalidate page

- `assignAgent(ticketId, agentId)`:
  - Require agent role
  - Update ticket assigned_agent_id
  - Log in activity_log
  - Revalidate page

- `reassignAgent(ticketId, newAgentId, reason?)`:  
  - Require agent role  
  - Only valid when ticket already has an assigned agent (reassignment, not initial assignment)
  - Optionally accept a reassignment reason (free-text). If provided, insert a new `posts` record with `post_type = 'note'` containing the reassignment reason (visible only to agents). Also store the reason text in the activity_log `details` JSONB.
  - Update ticket assigned_agent_id
  - Log reassignment in activity_log
  - Revalidate page

- `unassignAgent(ticketId)`:
  - Require agent role
  - Set assigned_agent_id = null
  - Log in activity_log
  - Revalidate page

- `assignToMe(ticketId)`:
  - Require agent role
  - Shortcut: assigns current user (agent) to the ticket
  - Log in activity_log
  - Revalidate page

- `changeUrgency(ticketId, newUrgency)`:
  - Require agent role
  - Validate `newUrgency` is a valid `priority_level` enum value
  - Update ticket urgency
  - Log in activity_log
  - Revalidate page

- `changeSeverity(ticketId, newSeverity)`:
  - Require agent role
  - Validate `newSeverity` is a valid `priority_level` enum value
  - Update ticket severity
  - Log in activity_log
  - Revalidate page

- `changeType(ticketId, newTypeId)`:
  - Require agent role
  - Validate type exists
  - Update ticket type_id
  - Log in activity_log
  - Revalidate page

- `changeCategory(ticketId, newCategoryId | null)`:
  - Require agent role
  - Validate category exists (or null to clear)
  - Update ticket category_id
  - Log in activity_log
  - Revalidate page

- `toggleTicketPrivacy(ticketId)`:
  - Require agent role
  - Toggle `is_private` boolean
  - Log in activity_log
  - Revalidate page

### 2. Data Queries

**`src/lib/queries/agent-dashboard.ts`**:
- `getAgentTickets(filters)` — query the `agent_tickets` VIEW with:
  - Status filter (all / active / closed)
  - **Search by title AND all post bodies** (§8.14 — deeper than user search which only covers title + original post). This cannot use the `search_vector` column on tickets (which only indexes title + original post). Instead, use a subquery/JOIN against the `posts` table: search all posts' bodies for matches using `to_tsvector` or `ILIKE`. Consider creating a helper view or function for this.
  - Filter by submitter email (partial match, server-side only)
  - Filter by urgency / severity
  - Filter by category
  - Filter by type
  - Filter by assigned agent: options are "All" (default), "Unassigned", and each agent's display name with email in parentheses for disambiguation (e.g., "Agent Smith (agent.smith@example.com)") per §8.9
  - Filter by team: options are "All" (default), "No team", and each team name per §8.10
  - Sort by: last modified (default), created date
  - Pagination (page + page size). Read `agent_dashboard_page_size` from `app_settings` (default 20). Phase 7 adds the admin UI to configure this.
  - Returns total count for "N ticket(s) found"
- All filters are read from URL search params
- The `agent_tickets` VIEW uses `security_invoker = true` — always query it using the authenticated user's Supabase client (not service role) so RLS is enforced.

### 3. Pages

**`src/app/(main)/agent/page.tsx`** — Agent Dashboard:
- Require agent role (redirect non-agents)
- Show all tickets from `agent_tickets` VIEW
- No page title heading (top navigation already indicates the section)
- Each row: title (link to detail), submitter display name (**never email** — 8.2), last-updated, post count, urgency badge, severity badge, status badge
- **Important:** The `agent_tickets` VIEW includes `creator_email` for server-side filtering (8.5) only. Emails must NOT be rendered in the ticket list.
- Result count: "N ticket(s) found"
- All filters are URL search params
- Paginated

### 3a. Agent Personal Stats Panel (8.16)

Add a collapsible "My Stats" panel at the top of the agent dashboard using `<details>`/`<summary>` (no JavaScript needed, consistent with Phase 2 NavBar dropdown pattern). Default state: collapsed.
- Metrics for the last 30 days: tickets assigned, tickets resolved (closed), average response time, average resolution time, average CSAT rating, SLA compliance rate
- Read-only, calculated server-side from existing data
- Agents can only see their own stats
- **Note:** CSAT and SLA stats will show meaningful data only after those features are built (Phases 11–12). For now, show "N/A" or 0 for those metrics.

### 3b. Consolidated Views & Filters Panel

**Important Change:** The Saved Views section and Filter bar are now consolidated into a single collapsible panel (see `promts/changes/agent-dashboard-panel-consolidation.md` for full UI spec).

**Panel Structure:**
- Position: immediately below the "My Stats" panel
- Default state: **collapsed**
- Summary (collapsed state): Shows `"Views & Filters: [Current View Name]"` or `"Views & Filters: Default"` if no view selected
- When expanded, displays:
  1. **Saved Views Section** (at top of expanded panel):
     - Label: `"Saved Views:"`
     - Special "Default" view: always present, non-removable, represents baseline ticket list with no special filters
     - List saved views as clickable links/buttons that apply stored filter combinations
     - Each saved view (except "Default") has a delete button
     - Cannot delete the only non-default view if Default is selected
     - Always at least one view is selected (Default or other)

  2. **Filter Controls Section** (below Saved Views):
     - Status toggle: All / Active / Closed
     - Search by title/content (searches ALL posts, not just original — §8.14)
     - Filter by submitter email
     - Filter by urgency (dropdown)
     - Filter by severity (dropdown)
     - Filter by category (dropdown, only if categories exist)
     - Filter by type (dropdown)
     - Filter by assigned agent (dropdown: All / Unassigned / each agent by display name + email)
     - Filter by team (dropdown: All / No team / each team name)
     - Filter by tier (dropdown, only if tiers defined)
     - Filter by tags (multi-select pills)
     - Sort toggle: Last Modified / Created / SLA Risk
     - Grid layout: `grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3`
     - "Apply Filters" button and "Clear All" link

**Server Actions** (`src/lib/actions/saved-views.ts`):
- Existing actions unchanged: `createSavedView(name, filters)`, `renameSavedView(viewId, newName)`, `deleteSavedView(viewId)`
- All require agent role and validate ownership
- All filters are serialized as JSONB in the `saved_views` table

**UI Behavior** (no `"use client"` needed — all CRUD via `<form>` + Server Actions):
- Clicking a saved view link updates URL with stored filter params
- Applying custom filters updates URL (the `<details>` panel is a native HTML element; it does not auto-collapse on navigation — it resets to its default collapsed state on page load)
- Clearing filters reverts to "Default" in collapsed summary
- Panel summary always reflects the currently active view
- Browser back/forward preserves view and filter state

### 3c. Saved Views Semantics

- **"Default" view**: Represents the baseline ticket list with no custom filters applied
  - Never deleted; always available as fallback
  - When user has custom filters but hasn't saved them, summary shows "Default"
  - When user explicitly saves a view, it gets a custom name and becomes a "Saved View"
  
- **Saved Views**: Agent's custom filter combinations with assigned names
  - Stored in `saved_views` table with `filters` JSONB
  - Can be renamed and deleted (except the "Default" semantic meaning)
  - Clicking applies all stored filters to the dashboard

### 4. Ticket Detail Updates (Agent View)

Update `src/app/(main)/tickets/[id]/[slug]/page.tsx`:

When the current user is an agent, show additional controls:
- **Status buttons**: "Mark Pending", "Close Ticket", "Re-open" / "Mark Open" (adapt to current status)
- **Assign agent**: "Assign to me" button (when unassigned), agent picker dropdown listing all agents/admins by display name with email in parentheses for disambiguation (e.g., "Agent Smith (agent.smith@example.com)"), "Unassign" button (when assigned)
- **Urgency selector**: dropdown (Low / Medium / High / Critical)
- **Severity selector**: dropdown (Low / Medium / High / Critical)
- **Category selector**: dropdown (if categories exist, plus "None" to clear)
- **Type selector**: dropdown listing all ticket types
- **Privacy toggle**: button to toggle public/private
- All controls are `<form>` elements calling their respective Server Actions

### 5. NavBar Update

Update NavBar to show:
- "Agent Dashboard" link in the top-level navigation bar (visible only to agents/admins)
- "My Tickets", "Reports", and "Canned Responses" links are NOT in the top-level nav for agents/admins — they go in the user menu dropdown (see Phase 2 NavBar spec)
- Selected top-level links are visually highlighted and set `aria-current="page"` on desktop and mobile.

### 6. Tests

**`tests/db/004-agent.test.ts`**:
- Agent can read all tickets (including private)
- Agent can change ticket status
- Agent cannot change status of a merged ticket (rejected)
- Agent can assign/unassign themselves
- Agent can change ticket urgency
- Agent can change ticket severity
- Agent can change ticket type
- Agent can change ticket category (set + clear)
- Agent can toggle ticket privacy
- Regular user cannot access any agent operations (all actions rejected)
- `agent_tickets` VIEW returns correct joined data (all columns)
- Filters work correctly on the VIEW
- Activity log entries are created for all agent actions (status, assign, urgency, severity, type, category, privacy)
- Saved views: agent can create, rename, delete own views
- Saved views: creating two views with the same name for the same agent is rejected (UNIQUE constraint)

**`tests/e2e/agent-dashboard.spec.ts`**:
- Agent sees "Agent Dashboard" link in nav
- Regular user doesn't see the link
- Non-agent navigating to `/agent` is redirected
- Dashboard loads with all tickets
- **Consolidated Views & Filters Panel:**
  - Panel is collapsed on page load (by default)
  - Panel summary shows "Views & Filters: Default" when no view selected
  - Panel summary shows "Views & Filters: [View Name]" when saved view applied
  - Clicking summary expands panel to show filters and saved views
  - Saved views list shows "Default" as non-removable option
  - Creating a saved view shows it in the expanded panel
  - Clicking saved view applies filters and updates collapsed summary
  - Renaming saved view updates collapsed summary (if active)
  - Deleting saved view (not Default) works correctly
  - Cannot delete Default view
  - Cannot delete last non-Default view if Default is selected
  - Applying custom filters updates URL and collapsed summary
  - Clearing filters reverts to "Default" in collapsed summary
  - Browser back/forward preserves view and filter state
- Status filter works
- Search by title works (all-posts search)
- Filter by submitter email works
- Sort toggles work
- Pagination works
- Agent can change ticket status from detail page
- Agent can change urgency/severity from detail page
- Agent can change type/category from detail page
- Agent can toggle privacy from detail page
- Agent can assign/unassign from detail page
- "Assign to me" button works
- Agent can reassign ticket to another agent with a reason — reason appears as an internal note
- Result count updates with filters
- Agent stats panel: collapse/expand toggle works
- Agent stats panel shows correct assigned/resolved counts
- Agent stats panel shows "N/A" for CSAT and SLA metrics
- E2E nav assertions should rely on active nav link state (`aria-current="page"`) rather than a page heading.

## Deferred Features (Added by Later Phases)

The following features extend the agent dashboard and are NOT part of this phase:
- Tag filter — Phase 5
- Submitter display name as clickable profile link — Phase 15

## Change Update — SurveyJS Filters

Agent dashboard filters are now rendered through SurveyJS (React) instead of plain HTML form controls.

Implementation expectations:
- Keep URL-driven filtering semantics identical (`/agent?...`).
- Keep saved views behavior unchanged.
- Read optional JSON config from `app_settings.survey_agent_dashboard_config` to control enabled fields and default sort.
- Preserve existing filter coverage (status, search, email, urgency, severity, category, type, agent, team, tier, tags, sort).
- Block indicator on submitter names — Phase 15
- SLA sort ("SLA Risk") — Phase 12
- Bulk actions (checkboxes, toolbar) — Phase 17
- Tier filter + tier pill display — Phase 20

## Verification Checklist

- [ ] Agent dashboard shows all tickets (including private)
- [ ] All filter combinations work correctly
- [ ] Search searches title and ALL post content (not just original post)
- [ ] Sort by last modified / created works
- [ ] Pagination works correctly with filters
- [ ] Agent can change status from ticket detail
- [ ] Agent can change urgency/severity from ticket detail
- [ ] Agent can change type/category from ticket detail
- [ ] Agent can toggle privacy from ticket detail
- [ ] Agent can assign/unassign from ticket detail
- [ ] "Assign to me" shortcut works
- [ ] Reassignment with reason creates internal note
- [ ] Non-agents redirected away from dashboard
- [ ] Result count is accurate
- [ ] All filters are URL-based (bookmarkable)
- [ ] Views & Filters panel is collapsed by default
- [ ] Views & Filters collapsed summary shows current view or "Default"
- [ ] Saved views: create, apply, rename, delete all work
- [ ] Default view is always available and cannot be deleted
- [ ] Browser back/forward preserves view and filter state
- [ ] Stats panel shows correct assigned/resolved counts for last 30 days
- [ ] Stats panel CSAT and SLA metrics show "N/A"
- [ ] `npm run typecheck` passes with no errors
- [ ] `npm run lint` passes with no errors
- [ ] `npm run test:db` passes agent tests
- [ ] `npm run test:e2e` passes agent dashboard tests
