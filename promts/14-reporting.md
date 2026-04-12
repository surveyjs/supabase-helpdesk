# Phase 14 — Reporting & Analytics

## Context

You are building the Reporting & Analytics dashboard for a **HelpDesk** application. Read `docs/requirements.md` sections 18.1–18.8, and `docs/architecture.md` constraints 2, 2c.

Phases 0–13 are complete: project init, database schema, authentication, tickets, agent dashboard, taxonomy, posts/comments/notes, admin setup, file attachments, email notifications, real-time/in-app notifications, CSAT ratings, SLA policies, and knowledge base.

This phase adds the reporting dashboard with client-side charts (architecture constraint 2c — charts are one of the allowed client-side components), providing ticket volume, resolution metrics, agent performance, CSAT summary, SLA compliance, and backlog overview. All with CSV export.

## Tasks

### 1. Chart Library Setup

Install a lightweight chart library for client-side rendering. Recommended: **recharts** (React-based, composable, good for the chart types needed).

```bash
npm install recharts
```

> **Architecture constraint 2c:** Charts are explicitly listed as an acceptable client-side component. The reporting page uses `"use client"` chart components that receive data from server-rendered parent pages.

### 2. Reporting Data Queries

**`src/lib/queries/reports.ts`** (new file):

All query functions accept a `timeRange: { start: Date, end: Date }` and optional `filters: { status?, severity?, type?, category?, agentId? }`. For agent-scoped views, also accept the current user's ID to restrict data.

- `getTicketVolumeData(timeRange, groupBy: 'day' | 'week' | 'month', filters?)`:
  - Query ticket counts grouped by the time period
  - Optionally filtered by status, severity, type, category
  - Returns `Array<{ period: string, count: number, status?: string }>`

- `getResolutionMetrics(timeRange, filters?)`:
  - Average time to first response (from `sla_timers.first_response_at - tickets.created_at`)
  - Average time to resolution (from `sla_timers.resolved_at - tickets.created_at`)
  - Median resolution time
  - Broken down by severity level
  - Returns `{ avgFirstResponse: number, avgResolution: number, medianResolution: number, bySeverity: Record<string, {...}> }`

- `getAgentPerformanceData(timeRange, agentId?)`:
  - Per-agent: tickets assigned, tickets resolved, avg response time, avg resolution time, avg CSAT rating
  - If `agentId` provided, return only that agent's data (agent-scoped view)
  - Returns `Array<{ agentId, displayName, assigned, resolved, avgResponseTime, avgResolutionTime, avgCsat }>`

- `getCsatSummaryData(timeRange)`:
  - Average CSAT rating for the period
  - Distribution: count of 1-star through 5-star ratings
  - Trend: average rating per time period (weekly or monthly)
  - Returns `{ average: number, distribution: Record<number, number>, trend: Array<{ period, average }> }`

- `getSlaComplianceData(timeRange)`:
  - Percentage of tickets meeting first response SLA
  - Percentage of tickets meeting resolution SLA
  - Broken down by severity
  - List of breached ticket IDs with links
  - Returns `{ firstResponseCompliance: number, resolutionCompliance: number, bySeverity: Record<string, {...}>, breachedTickets: Array<{ ticketId, title, slaType, target, actual }> }`

- `getBacklogData(timeRange?)`:
  - Current count of open/pending tickets, by severity and assigned/unassigned
  - Trend: backlog size over time (daily snapshots or calculated)
  - Returns `{ open: number, pending: number, bySeverity: Record<string, { open, pending }>, unassigned: number, trend: Array<{ date, open, pending }> }`

### 3. CSV Export Utility

**`src/lib/utils/csv.ts`** (new file):

- `generateCsv(headers: string[], rows: any[][]): string` — Generate a CSV string from headers and row data, with proper escaping (commas, quotes, newlines).

- `downloadCsv(filename: string, csvContent: string)` — Client-side utility: create a Blob and trigger browser download.

### 4. Reporting Dashboard Page

**`src/app/(main)/reports/page.tsx`** — Server-rendered page:
- **Access control** (§18.1):
  - Agents: read-only, filtered to their own data (own performance, tickets assigned to them)
  - Admins: full access to all data and all agents
  - Regular users: redirect to home
- Fetch all report data server-side based on current filters
- Pass data as props to client-side chart components
- URL-based state for time range and filters: `?start=2025-01-01&end=2025-03-31&groupBy=weekly&severity=high`

**Layout:**
- Top controls bar:
  - Time range picker (preset options: Last 7 days, Last 30 days, Last 90 days, Custom date range)
  - Filters: status, severity, type, category dropdowns (admin only for full filter set)
  - "Export CSV" button (exports the currently visible data)
- Below: report sections in a grid/tab layout

### 5. Chart Components

All chart components are `"use client"` and receive data as props from the server-rendered page.

**`src/components/features/reports/TicketVolumeChart.tsx`**:
- Bar chart showing ticket count over time
- Group by selector: daily / weekly / monthly
- Color-coded by status if status filter not applied
- Uses recharts `<BarChart>` or `<AreaChart>`

**`src/components/features/reports/ResolutionMetricsPanel.tsx`**:
- Stat cards: avg first response time, avg resolution time, median resolution time
- Comparison with previous period (green/red arrow + percentage)
- Severity breakdown table below

**`src/components/features/reports/AgentPerformanceTable.tsx`**:
- Sortable table with columns: agent name, assigned, resolved, avg response time, avg resolution time, avg CSAT
- Sortable by clicking column headers (client-side sort)
- Admin view: shows all agents
- Agent view: shows only the current agent's row

**`src/components/features/reports/CsatSummaryChart.tsx`**:
- Average CSAT rating large display (e.g., "4.2 / 5 ★")
- Bar chart: distribution of 1–5 star ratings
- Line chart: CSAT trend over time

**`src/components/features/reports/SlaCompliancePanel.tsx`**:
- Two gauge-style metrics: first response compliance %, resolution compliance %
- Severity breakdown table
- "Breached Tickets" expandable list with links to ticket detail pages

**`src/components/features/reports/BacklogOverview.tsx`**:
- Current counts: open tickets, pending tickets, unassigned tickets (stat cards)
- Severity breakdown (small table or stacked bar)
- Trend line chart: backlog over time

### 6. CSV Export Server Action

**`src/lib/actions/reports.ts`** (new file):

- `exportReportCsv(reportType, timeRange, filters?)`:
  - Require agent role (agents export own data, admins export all)
  - Query the relevant data based on `reportType`: 'ticket_volume', 'resolution_metrics', 'agent_performance', 'csat_summary', 'sla_compliance', 'backlog'
  - Generate CSV using `generateCsv()`
  - Return the CSV string (client handles download)

### 7. NavBar Update

Update `src/components/layout/NavBar.tsx`:
- Add **"Reports"** link visible to agents and admins
- Links to `/reports`

### 8. Tests

**`tests/e2e/reports.spec.ts`** (new file):
- Reports page accessible to agents (own data only)
- Reports page accessible to admins (all data)
- Reports page NOT accessible to regular users (redirect)
- Ticket volume chart renders with data
- Time range selector changes displayed data
- Resolution metrics show avg first response and resolution times
- Agent performance table: admin sees all agents, agent sees only self
- CSAT summary chart renders with distribution
- SLA compliance panel shows percentages
- Backlog overview shows current counts
- CSV export downloads a file
- URL-based filters persist across page loads

**No new DB test file needed** — reporting queries use existing tables with existing RLS. If specific SQL views or functions are created for reporting, add tests for those.

## Implementation Notes

- **Client-side charts:** The chart components are `"use client"` components per architecture constraint 2c. Data is fetched server-side and passed as props — no client-side data fetching.
- **Agent-scoped access:** When an agent accesses reports, all queries are filtered by `assigned_agent_id = currentUserId`. Agents see only their own metrics. Admins see everything.
- **Performance:** Reporting queries may be expensive on large datasets. Use proper indexes (already created on tickets, sla_timers, csat_ratings). Consider adding SQL views or materialized aggregates if needed.
- **Time formatting:** Display times in human-readable format: "2h 15m" for response times, not raw minutes.
- **Backlog trend:** Since there's no daily snapshot table, calculate backlog trend by querying tickets created before each date and still open/pending at that date. If this is too slow, consider a materialized approach.
- **Empty states:** When no data exists for a time range, show "No data for this period" in chart areas.

## Deferred Features (Added by Later Phases)

- Tier as a filter dimension on ticket volume, resolution metrics, and CSAT charts — Phase 20

## Verification Checklist

- [ ] Reports page accessible to agents (own data) and admins (all data)
- [ ] Regular users redirected away
- [ ] Ticket volume chart renders correctly with time grouping
- [ ] Resolution metrics: avg first response, avg resolution, median, severity breakdown
- [ ] Agent performance table: sortable, correct data for agent vs admin view
- [ ] CSAT summary: average, distribution bar chart, trend line
- [ ] SLA compliance: first response and resolution percentages, severity breakdown
- [ ] Breached tickets list links to ticket detail
- [ ] Backlog overview: open/pending/unassigned counts, trend chart
- [ ] Time range picker works (presets + custom)
- [ ] Filters work (status, severity, type, category)
- [ ] CSV export generates valid CSV and triggers download
- [ ] URL state preserved (time range, filters)
- [ ] NavBar: "Reports" link visible to agents/admins only
- [ ] `npm run test:e2e` passes reports e2e tests
