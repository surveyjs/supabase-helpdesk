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
| Add posts/comments to visible tickets | ✓ | ✓ | ✓ |
| Change ticket type | — | ✓ | ✓ |
| Set/change ticket category | ✓ (owner) | ✓ | ✓ |
| Change ticket status (pending / closed) | — | ✓ | ✓ |
| Assign agent to a ticket | — | ✓ | ✓ |
| Mark ticket as duplicate | — | ✓ | ✓ |
| Delete tickets | — | — | ✓ |
| Access the Agent Dashboard | — | ✓ | ✓ |
| Manage ticket types | — | — | ✓ |
| Manage ticket categories | — | — | ✓ |
| Manage agents (promote/revoke) | — | — | ✓ |
| Access the Admin Setup page | — | — | ✓ |

All permission checks must be enforced **at the database level** using Postgres Row-Level Security — the frontend should not be the only line of defense.

---

### User Stories

#### Authentication

1. **Sign up** — A visitor can create an account with email and password. After signing up they are told to check their email for confirmation.
2. **Log in** — A user can log in with email and password. Invalid credentials show an error message on the same page.
3. **Sign out** — A logged-in user can sign out from the navigation bar.
4. **Unauthenticated visitors** — Unauthenticated visitors can view public tickets. They can't create or make any modification to any ticket.

#### Tickets (End-User Perspective)

5. **Create a ticket** — A logged-in user can create a support ticket with a title (required), a type (selected from available ticket types, defaults to the system default type), an optional severity (**"Minor"**, **"Moderate"**, or **"Severe"**), an original post body (required, Markdown text), and a "Private" checkbox (checked by default). Private tickets are only visible to the owner, their teammates, and agents. The original post is created automatically together with the ticket.
6. **View my tickets** — The home page shows a list of the current user's tickets sorted by last-updated. Each entry shows the title, last-updated date, and a color-coded status badge (green = open, yellow = pending, gray = closed). Clicking a ticket opens the detail page.
7. **Empty state** — If a user has no tickets, show a friendly message with a link to create one.
8. **Ticket detail** — Shows the ticket title, type, status, severity (if set), category (if categories exist and one is set), assigned agent (if any), submitter email, creation date, and a chronological list of posts. If the ticket is marked as a duplicate, a banner shows the link to the original ticket. The original post appears first as the ticket's description. Each post can have its own chronological list of comments displayed beneath it. The current user's own posts/comments have a blue-tinted background; others have a white background.
9. **Reply to a ticket** — Below the post list there is a text area and a "Reply" button to add a new post. Users can reply even if the ticket is closed — doing so automatically re-opens the ticket. Users cannot reply to a ticket that is marked as a duplicate.
10. **Public vs private** — Public tickets (is_private = false) are visible to any user. Private tickets are visible only to the owner, teammates, and agents/admins.

#### Teams

11. **Teams** — Users can belong to a team. If a user is on a team, the home page shows a toggle between "My Tickets" and "Team Tickets". The team view lists all tickets created by any member of the same team.
12. **Teammate visibility** — Team members can see and comment on each other's private tickets.
13. **No team management UI needed** — Teams are set up via the database / seed data. No UI for creating or managing teams is required in this version.

#### Ticket Types

14. **Ticket types** — Every ticket has a type. The system comes with three pre-defined types: **"Question"** (default), **"Issue"**, and **"Suggestion"**. One type is marked as the default and is pre-selected when creating a new ticket. Once a ticket is created, only an agent or admin can change its type.
15. **Manage ticket types** — Admins can create, rename, and delete ticket types. Admins can also change which type is the default. Deleting a type that is in use by existing tickets is not allowed.

#### Ticket Categories

16. **Ticket categories** — A ticket has an optional category field. The list of available categories is managed by the admin. There are no default categories. If the categories list is empty, the category field is not shown in the ticket creation form or ticket detail page. The category can be set or changed by the ticket owner or an agent/admin.
17. **Manage categories** — Admins can create, rename, and delete categories. Deleting a category that is in use by existing tickets is not allowed.

#### Agent Dashboard

18. **Agent dashboard access** — Agents and admins see an "Agent Dashboard" link in the navigation bar. Regular users do not see it, and are redirected away if they try to access it directly.
19. **View all tickets** — The dashboard shows ALL tickets in the system (both private and public), with the submitter's email, last-updated date, post count, and status badge.
20. **Filter by status** — Toggle buttons let the agent filter by "All", "Active" (open + pending), or "Closed".
21. **Sort** — Toggle buttons let the agent sort by "Last Modified" (default) or "Created" date.
22. **Filter by user** — A text field lets the agent search tickets by submitter email (partial match). A "Clear" link removes the filter.
23. **Result count** — The dashboard shows "N ticket(s) found" above the list.
24. **All filters are URL-based** — Filters use URL search params so the page is bookmarkable and shareable.

#### Agent Actions on Tickets

25. **Change status** — On a ticket detail page, an agent sees "Mark Pending" and "Close Ticket" buttons (only if the ticket isn't already closed). Regular users do not see these buttons. Closing a ticket automatically removes the assigned agent.
26. **Reply as agent** — Agents can reply to any post in a ticket (adding a post or a comment on an existing post).
27. **Assign agent** — A ticket can be assigned to an agent, indicating that this agent is responsible for working on it. Only agents and admins can assign or reassign an agent. A ticket can have at most one assigned agent at a time.
28. **Mark as duplicate** — Only an agent or admin can mark a ticket as a duplicate of another ticket by linking it to the original. When a ticket is marked as duplicate, it is automatically closed and a system-generated post is added to the ticket with a Markdown message containing a link to the original ticket. The Markdown template for the duplicate message is configurable by the admin; there is a default template (e.g., *"This ticket has been closed as a duplicate of [#{{ticketId}}](link)."*). An agent or admin can also remove the duplicate link, which automatically re-opens the ticket.

#### Posts, Comments & Notes

A **post** is the primary unit of content within a ticket. Every post belongs to a ticket (foreign key) and stores: creation date, author (user / agent / admin), body (Markdown text), and optional file attachments.

There are three post types:

29. **Post (root post)** — A top-level entry in a ticket's timeline. Every ticket has at least one post — the **original post**, which is created together with the ticket and contains its initial description. After that, any user or agent can add more posts. A post cannot reference another post; it always sits at the root level.
30. **Comment** — A reply attached to a specific post (foreign key to that post). Comments provide threaded discussion under a post. A comment **cannot** be made on another comment — only on a post.
31. **Note** — An internal post visible **only to agents and admins**. Notes are used for internal discussion and are never shown to regular users, regardless of ticket visibility.

#### Post Visibility & Privacy

32. **Private posts / comments** — Any post or comment can be marked as **private**, except the original post that is created together with the ticket. When a post or comment is private, it is visible only to the ticket owner, their team members, and agents/admins — even if the ticket itself is public.
33. **Notes are always internal** — Notes are implicitly restricted to agents and admins and are never visible to regular users.
34. **Draft posts** — Any post (post, comment, or note) created by an agent can be saved as a **draft**. A draft post is visible only to agents and admins — regular users cannot see it regardless of ticket or post visibility settings. The draft state indicates that the agent is working on a response but it is not ready to be shared yet. When the agent is satisfied with the content, they publish the draft, which turns it into a regular post visible according to normal visibility rules.

#### Admin Setup Page

35. **Admin setup access** — Only admins can access the Admin Setup page. Admins see a "Setup" link in the navigation bar. Non-admin users do not see it and are redirected away if they try to access the URL directly.
36. **Ticket types management** — A section to manage ticket types: add new types, rename existing ones, delete unused types, and set which type is the default. (See #14, #15.)
37. **Categories management** — A section to manage ticket categories: add new categories, rename existing ones, and delete unused categories. (See #16, #17.)
38. **Duplicate ticket template** — A section to edit the Markdown template used for the system-generated post when a ticket is marked as duplicate. The template supports a `{{ticketId}}` placeholder. A "Reset to default" button restores the built-in template. (See #28.)
39. **Agent management** — A section that shows the list of current agents. The admin can search for a user by email and promote them to the agent role. The admin can also revoke agent rights, turning an agent back into a regular user.

---

### Navigation Bar

- **Left side**: App name "HelpDesk" (links to home), "My Tickets" link, (for agents/admins) "Agent Dashboard" link, and (for admins only) "Setup" link.
- **Right side**: Current user's email, role badges, and a "Sign out" button.
- The nav bar is always visible. For unauthenticated visitors it shows the app name and a "Log in" link. The full nav bar (My Tickets, Agent Dashboard, user email, Sign out) is only shown to logged-in users.

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

Seed **7 tickets** across Alice, Bob, and Carol with realistic helpdesk subjects (password reset issues, feature requests, billing questions, bug reports, etc.) in mixed statuses. Each ticket must have an original post. Seed additional **posts**, **comments**, and **notes** that simulate realistic agent–customer conversations.

---

### Architecture Constraints

1. **No custom API layer** — Use Supabase client libraries to read/write data directly. Mutations happen through Next.js Server Actions called from `<form>` elements.
2. **Server-rendered everything** — No `"use client"` components. All pages are async Server Components that fetch data on the server.
3. **Database-enforced security** — Every table must have Row-Level Security enabled. Helper functions like `is_agent()`, `is_admin()`, and `is_teammate()` should live in Postgres and be used in RLS policies.
4. **Cookie-based auth** — Use `@supabase/ssr` for server-side Supabase clients. A Next.js middleware refreshes the session on every request.
5. **Agent dashboard performance** — Create a Postgres VIEW (`agent_tickets`) that joins tickets with profile emails and pre-aggregates post counts. The agent page queries this view instead of doing complex joins on the client.
6. **URL-driven state** — Filtering and view switching (my tickets vs team tickets, agent dashboard filters) should use URL search params, not React state.

---
