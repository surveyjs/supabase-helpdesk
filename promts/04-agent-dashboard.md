# Phase 4 — Agent Dashboard (Basic)

## Context

You are building the Agent Dashboard for a **HelpDesk** application. Read `docs/requirements.md` sections 8.1–8.14 and 9.1–9.3.

Phases 0–3 are complete: project init, database schema, authentication, and user-facing ticket CRUD.

## Tasks

### 1. Server Actions for Agent Operations

**`src/lib/actions/agent.ts`**:

- `changeTicketStatus(ticketId, newStatus)`:
  - Require agent role
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
  - Optionally accept a reassignment reason (free-text). If provided, store as an internal note visible only to agents
  - Update ticket assigned_agent_id
  - Log reassignment (with reason, if provided) in activity_log
  - Revalidate page

- `unassignAgent(ticketId)`:
  - Require agent role
  - Set assigned_agent_id = null
  - Log in activity_log
  - Revalidate page

- `assignToMe(ticketId)`:
  - Shortcut: assigns current user (agent) to the ticket
  - Log in activity_log

### 2. Data Queries

**`src/lib/queries/agent-dashboard.ts`**:
- `getAgentTickets(filters)` — query the `agent_tickets` VIEW with:
  - Status filter (all / active / closed)
  - Search by title or post content
  - Filter by submitter email (partial match)
  - Filter by urgency / severity
  - Filter by category
  - Filter by type
  - Filter by assigned agent (all / unassigned / specific agent)
  - Filter by team
  - Sort by: last modified (default), created date
  - Pagination (page + page size)
  - Returns total count for "N ticket(s) found"
- All filters are read from URL search params

### 3. Pages

**`src/app/(main)/agent/page.tsx`** — Agent Dashboard:
- Require agent role (redirect non-agents)
- Show all tickets from `agent_tickets` VIEW
- Each row: title (link to detail), submitter display name (**never email** — 8.2), last-updated, post count, urgency badge, severity badge, status badge
- **Important:** The `agent_tickets` VIEW includes `creator_email` for server-side filtering (8.5) only. Emails must NOT be rendered in the ticket list.
- Filter bar at the top:
  - Status toggle: All / Active / Closed
  - Search by title/content
  - Filter by submitter email
  - Filter by urgency (dropdown)
  - Filter by severity (dropdown)
  - Filter by category (dropdown, only if categories exist)
  - Filter by type (dropdown)
  - Filter by assigned agent (dropdown)
  - Filter by team (dropdown, only if teams exist)
  - Sort toggle: Last Modified / Created
- Result count: "N ticket(s) found"
- All filters are URL search params
- Paginated

### 3a. Saved Views (8.13)

Create a `saved_views` table:
- `id` UUID PRIMARY KEY
- `agent_id` UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE
- `name` TEXT NOT NULL (max 100 chars)
- `filters` JSONB NOT NULL (stores all filter + sort params)
- `created_at` TIMESTAMPTZ

RLS: agents can CRUD only their own views.

UI:
- Quick-access links above the filter bar showing the agent's saved views
- "Save current view" button that prompts for a name
- Each saved view: click to apply filters, rename, delete
- Clicking a saved view sets all URL search params from the stored `filters` JSON

### 3b. Agent Personal Stats Panel (8.16)

Add a collapsible "My Stats" panel at the top of the agent dashboard:
- Metrics for the last 30 days: tickets assigned, tickets resolved (closed), average response time, average resolution time, average CSAT rating, SLA compliance rate
- Read-only, calculated server-side from existing data
- Agents can only see their own stats
- **Note:** CSAT and SLA stats will show meaningful data only after those features are built (Phases 11–12). For now, show "N/A" or 0 for those metrics.

### 4. Ticket Detail Updates (Agent View)

Update `src/app/(main)/tickets/[id]/[slug]/page.tsx`:

When the current user is an agent, show additional controls:
- **Status buttons**: "Mark Pending", "Close Ticket", "Re-open" / "Mark Open" (adapt to current status)
- **Assign agent**: "Assign to me" button (when unassigned), agent picker dropdown, "Unassign" button (when assigned)
- These are `<form>` elements calling Server Actions

### 5. NavBar Update

Update NavBar to show:
- "Agent Dashboard" link (visible only to agents/admins)

### 6. Tests

**`tests/db/004-agent.test.ts`**:
- Agent can read all tickets (including private)
- Agent can change ticket status
- Agent can assign/unassign themselves
- Regular user cannot access agent operations
- agent_tickets VIEW returns correct joined data
- Filters work correctly on the VIEW

**`tests/e2e/agent-dashboard.spec.ts`**:
- Agent sees "Agent Dashboard" link in nav
- Regular user doesn't see the link
- Dashboard loads with all tickets
- Status filter works
- Search by title works
- Filter by submitter email works
- Sort toggles work
- Pagination works
- Agent can change ticket status from detail page
- Agent can assign/unassign from detail page
- "Assign to me" button works
- Result count updates with filters
- Saved views: create, apply, rename, delete
- Agent stats panel shows correct assigned/resolved counts

## Deferred Features (Added by Later Phases)

The following features extend the agent dashboard and are NOT part of this phase:
- Tag filter — Phase 5
- Block indicator on submitter names — Phase 15
- SLA sort ("SLA Risk") — Phase 12
- Bulk actions (checkboxes, toolbar) — Phase 17
- Tier filter + tier pill display — Phase 20

## Verification Checklist

- [ ] Agent dashboard shows all tickets (including private)
- [ ] All filter combinations work correctly
- [ ] Search searches title and all post content
- [ ] Sort by last modified / created works
- [ ] Pagination works correctly with filters
- [ ] Agent can change status from ticket detail
- [ ] Agent can assign/unassign from ticket detail
- [ ] "Assign to me" shortcut works
- [ ] Non-agents redirected away from dashboard
- [ ] Result count is accurate
- [ ] All filters are URL-based (bookmarkable)
- [ ] `npm run test:db` passes agent tests
- [ ] `npm run test:e2e` passes agent dashboard tests
