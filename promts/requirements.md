# HelpDesk — Business-Oriented Recreation Prompt

---

## Prompt

Build a web-based **HelpDesk** application — a customer-support ticket system where end-users submit and track support requests, and support agents manage, respond to, and resolve them.

Use **Supabase** (hosted Postgres + built-in auth) for the backend and **Next.js** (latest, App Router) with **Tailwind CSS** and **TypeScript** for the frontend. No custom API server — rely on Supabase's auto-generated REST API and Next.js Server Actions for all data operations. All pages should be server-rendered (no client-side React state management).

---

### Roles & Permissions

There are three user roles: **User**, **Agent**, and **Admin**.

| Capability | User | Agent | Admin |
|---|:---:|:---:|:---:|
| Create tickets | ✓ | ✓ | ✓ |
| View own tickets | ✓ | ✓ | ✓ |
| View public tickets | ✓ | ✓ | ✓ |
| View all tickets (including private) | — | ✓ | ✓ |
| Reply to visible tickets | ✓ | ✓ | ✓ |
| Change ticket status (pending / closed) | — | ✓ | ✓ |
| Delete tickets | — | — | ✓ |
| Access the Agent Dashboard | — | ✓ | ✓ |

All permission checks must be enforced **at the database level** using Postgres Row-Level Security — the frontend should not be the only line of defense.

---

### User Stories

#### Authentication

1. **Sign up** — A visitor can create an account with email and password. After signing up they are told to check their email for confirmation.
2. **Log in** — A user can log in with email and password. Invalid credentials show an error message on the same page.
3. **Sign out** — A logged-in user can sign out from the navigation bar.
4. **Unauthenticated visitors** — Unauthenticated visitors can view public tickets. They can't create or make any modification to any ticket.

#### Tickets (End-User Perspective)

5. **Create a ticket** — A logged-in user can create a support ticket with a title (required), description (optional), and a "Private" checkbox (checked by default). Private tickets are only visible to the owner, their teammates, and agents.
6. **View my tickets** — The home page shows a list of the current user's tickets sorted by last-updated. Each entry shows the title, last-updated date, and a color-coded status badge (green = open, yellow = pending, gray = closed). Clicking a ticket opens the detail page.
7. **Empty state** — If a user has no tickets, show a friendly message with a link to create one.
8. **Ticket detail** — Shows the ticket title, status, submitter email, creation date, full description, and a chronological list of replies. The user's own replies have a blue-tinted background; others have a white background.
9. **Reply to a ticket** — Below the reply list there is a text area and a "Reply" button. Users can reply as long as the ticket is not closed.
10. **Public vs private** — Public tickets (is_private = false) are visible to any user. Private tickets are visible only to the owner, teammates, and agents/admins.

#### Teams

11. **Teams** — Users can belong to a team. If a user is on a team, the home page shows a toggle between "My Tickets" and "Team Tickets". The team view lists all tickets created by any member of the same team.
12. **Teammate visibility** — Team members can see and comment on each other's private tickets.
13. **No team management UI needed** — Teams are set up via the database / seed data. No UI for creating or managing teams is required in this version.

#### Agent Dashboard

14. **Agent dashboard access** — Agents and admins see an "Agent Dashboard" link in the navigation bar. Regular users do not see it, and are redirected away if they try to access it directly.
15. **View all tickets** — The dashboard shows ALL tickets in the system (both private and public), with the submitter's email, last-updated date, reply count, and status badge.
16. **Filter by status** — Toggle buttons let the agent filter by "All", "Active" (open + pending), or "Closed".
17. **Sort** — Toggle buttons let the agent sort by "Last Modified" (default) or "Created" date.
18. **Filter by user** — A text field lets the agent search tickets by submitter email (partial match). A "Clear" link removes the filter.
19. **Result count** — The dashboard shows "N ticket(s) found" above the list.
20. **All filters are URL-based** — Filters use URL search params so the page is bookmarkable and shareable.

#### Agent Actions on Tickets

21. **Change status** — On a ticket detail page, an agent sees "Mark Pending" and "Close Ticket" buttons (only if the ticket isn't already closed). Regular users do not see these buttons.
22. **Reply as agent** — Agents can reply to any ticket.

---

### Navigation Bar

- **Left side**: App name "HelpDesk" (links to home), "My Tickets" link, and (for agents/admins) "Agent Dashboard" link.
- **Right side**: Current user's email, role badges, and a "Sign out" button.
- The nav bar is only visible to logged-in users.

---

### Visual Design

- Clean, minimal look. Light gray page background (`gray-50`), white cards with subtle borders.
- Blue primary color for buttons and active states.
- Status badges: **open** = green pill, **pending** = yellow pill, **closed** = gray pill.
- Centered content area, max-width ~5xl.
- Use Geist font family (sans + mono).
- Forms in white card containers with padding and rounded corners.
- No dark mode needed (just light theme).

---

### Seed / Test Data

For local development, create seed data with these accounts (all passwords: `password123`):

| Email | Role | Team |
|---|---|---|
| admin@example.com | admin | — |
| agent.smith@example.com | agent | — |
| agent.jones@example.com | agent | — |
| alice@example.com | user | Alice's Team |
| bob@example.com | user | Alice's Team |
| carol@example.com | user | Alice's Team |

Seed **7 tickets** across Alice, Bob, and Carol with realistic helpdesk subjects (password reset issues, feature requests, billing questions, bug reports, etc.) in mixed statuses. Seed **12 replies** that simulate realistic agent–customer conversations.

---

### Architecture Constraints

1. **No custom API layer** — Use Supabase client libraries to read/write data directly. Mutations happen through Next.js Server Actions called from `<form>` elements.
2. **Server-rendered everything** — No `"use client"` components. All pages are async Server Components that fetch data on the server.
3. **Database-enforced security** — Every table must have Row-Level Security enabled. Helper functions like `is_agent()`, `is_admin()`, and `is_teammate()` should live in Postgres and be used in RLS policies.
4. **Cookie-based auth** — Use `@supabase/ssr` for server-side Supabase clients. A Next.js middleware refreshes the session on every request.
5. **Agent dashboard performance** — Create a Postgres VIEW (`agent_tickets`) that joins tickets with profile emails and pre-aggregates reply counts. The agent page queries this view instead of doing complex joins on the client.
6. **URL-driven state** — Filtering and view switching (my tickets vs team tickets, agent dashboard filters) should use URL search params, not React state.

---
