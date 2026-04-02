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
| Manage agents (promote/revoke) | — | — | ✓ |\n| Manage email configuration | — | — | ✓ |\n| Manage notification templates | — | — | ✓ |\n| Manage inbound email settings | — | — | ✓ |
| Access the Admin Setup page | — | — | ✓ |

All permission checks must be enforced **at the database level** using Postgres Row-Level Security — the frontend should not be the only line of defense.

---

### User Stories

#### 1. Authentication

1.1. **Sign up** — A visitor can create an account with email and password. After signing up they are told to check their email for confirmation.
1.2. **Log in** — A user can log in with email and password. Invalid credentials show an error message on the same page.
1.3. **Sign out** — A logged-in user can sign out from the navigation bar.
1.4. **Unauthenticated visitors** — Unauthenticated visitors can view public tickets. They can't create or make any modification to any ticket.

#### 2. Tickets (End-User Perspective)

2.1. **Create a ticket** — A logged-in user can create a support ticket with a title (required), a type (selected from available ticket types, defaults to the system default type), an optional severity (**"Minor"**, **"Moderate"**, or **"Severe"**), an original post body (required, Markdown text), and a "Private" checkbox (checked by default). Private tickets are only visible to the owner, their teammates, and agents. The original post is created automatically together with the ticket.
2.2. **View my tickets** — The home page shows a list of the current user's tickets sorted by last-updated. Each entry shows the title, last-updated date, and a color-coded status badge (green = open, yellow = pending, gray = closed). Clicking a ticket opens the detail page.
2.3. **Empty state** — If a user has no tickets, show a friendly message with a link to create one.
2.4. **Ticket detail** — Shows the ticket title, type, status, severity (if set), category (if categories exist and one is set), assigned agent (if any), submitter email, creation date, and a chronological list of posts. If the ticket is marked as a duplicate, a banner shows the link to the original ticket. The original post appears first as the ticket's description. Each post can have its own chronological list of comments displayed beneath it. The current user's own posts/comments have a blue-tinted background; others have a white background.
2.5. **Reply to a ticket** — Below the post list there is a text area and a "Reply" button to add a new post. Users can reply even if the ticket is closed — doing so automatically re-opens the ticket. Users cannot reply to a ticket that is marked as a duplicate.
2.6. **Public vs private** — Public tickets (is_private = false) are visible to any user. Private tickets are visible only to the owner, teammates, and agents/admins.
2.7. **Search tickets** — A search field on the tickets list page lets the user search their own tickets (and team tickets, if applicable) by title or original post content (partial match). Public tickets are also searchable. Search uses URL search params so results are bookmarkable. A "Clear" link removes the search filter.
2.8. **Filter by status** — Toggle buttons on the tickets list page let the user filter by "All", "Active" (open + pending), or "Closed".

#### 3. Teams

3.1. **Teams** — Users can belong to a team. If a user is on a team, the home page shows a toggle between "My Tickets" and "Team Tickets". The team view lists all tickets created by any member of the same team.
3.2. **Teammate visibility** — Team members can see and comment on each other's private tickets.
3.3. **No team management UI needed** — Teams are set up via the database / seed data. No UI for creating or managing teams is required in this version.

#### 4. Ticket Types

4.1. **Ticket types** — Every ticket has a type. The system comes with three pre-defined types: **"Question"** (default), **"Issue"**, and **"Suggestion"**. One type is marked as the default and is pre-selected when creating a new ticket. Once a ticket is created, only an agent or admin can change its type.
4.2. **Manage ticket types** — Admins can create, rename, and delete ticket types. Admins can also change which type is the default. Deleting a type that is in use by existing tickets is not allowed.

#### 5. Ticket Categories

5.1. **Ticket categories** — A ticket has an optional category field. The list of available categories is managed by the admin. There are no default categories. If the categories list is empty, the category field is not shown in the ticket creation form or ticket detail page. The category can be set or changed by the ticket owner or an agent/admin.
5.2. **Manage categories** — Admins can create, rename, and delete categories. Deleting a category that is in use by existing tickets is not allowed.

#### 6. Agent Dashboard

6.1. **Agent dashboard access** — Agents and admins see an "Agent Dashboard" link in the navigation bar. Regular users do not see it, and are redirected away if they try to access it directly.
6.2. **View all tickets** — The dashboard shows ALL tickets in the system (both private and public), with the submitter's email, last-updated date, post count, and status badge.
6.3. **Filter by status** — Toggle buttons let the agent filter by "All", "Active" (open + pending), or "Closed".
6.4. **Sort** — Toggle buttons let the agent sort by "Last Modified" (default) or "Created" date.
6.5. **Filter by user** — A text field lets the agent search tickets by submitter email (partial match). A "Clear" link removes the filter.
6.6. **Result count** — The dashboard shows "N ticket(s) found" above the list.
6.7. **All filters are URL-based** — Filters use URL search params so the page is bookmarkable and shareable.

#### 7. Agent Actions on Tickets

7.1. **Change status** — On a ticket detail page, an agent sees "Mark Pending" and "Close Ticket" buttons (only if the ticket isn't already closed). Regular users do not see these buttons. Closing a ticket automatically removes the assigned agent.
7.2. **Reply as agent** — Agents can reply to any post in a ticket (adding a post or a comment on an existing post).
7.3. **Assign agent** — A ticket can be assigned to an agent, indicating that this agent is responsible for working on it. Only agents and admins can assign or reassign an agent. A ticket can have at most one assigned agent at a time.
7.4. **Mark as duplicate** — Only an agent or admin can mark a ticket as a duplicate of another ticket by linking it to the original. When a ticket is marked as duplicate, it is automatically closed and a system-generated post is added to the ticket with a Markdown message containing a link to the original ticket. The Markdown template for the duplicate message is configurable by the admin; there is a default template (e.g., *"This ticket has been closed as a duplicate of [#{{ticketId}}](link)."*). An agent or admin can also remove the duplicate link, which automatically re-opens the ticket.

#### 8. Canned Responses (Reply Templates)

8.1. **Canned responses** — Agents and admins can create pre-written reply templates (canned responses) to speed up common replies. A canned response has a title, a body (Markdown text), and a visibility setting: **public** (visible to all agents and admins) or **private** (visible only to the agent who created it).
8.2. **Using canned responses** — When composing a post or comment, an agent can pick a canned response from a dropdown or searchable list. Selecting a canned response inserts its body into the text area. The agent can edit the inserted text before submitting.
8.3. **Managing canned responses** — An agent can create, edit, and delete their own private canned responses. Public canned responses can be created by any agent but can only be edited or deleted by the agent who created them or by an admin.

#### 9. Posts, Comments & Notes

A **post** is the primary unit of content within a ticket. Every post belongs to a ticket (foreign key) and stores: creation date, author (user / agent / admin), body (Markdown text), and optional file attachments.

There are three post types:

9.1. **Post (root post)** — A top-level entry in a ticket's timeline. Every ticket has at least one post — the **original post**, which is created together with the ticket and contains its initial description. After that, any user or agent can add more posts. A post cannot reference another post; it always sits at the root level.
9.2. **Comment** — A reply attached to a specific post (foreign key to that post). Comments provide threaded discussion under a post. A comment **cannot** be made on another comment — only on a post.
9.3. **Note** — An internal post visible **only to agents and admins**. Notes are used for internal discussion and are never shown to regular users, regardless of ticket visibility.
9.4. **File attachments** — Any post, comment, or note can include one or more file attachments. Files are uploaded to Supabase Storage. Allowed file types: images (PNG, JPG, GIF, WebP), documents (PDF, DOC, DOCX, XLS, XLSX, TXT, CSV), and archives (ZIP). Maximum file size: 10 MB per file. Attachments are displayed below the post body — images show an inline thumbnail preview; other file types show the file name, size, and a download link. Attachments inherit the visibility of the post they belong to (private post attachments are not accessible to unauthorized users). File access is enforced via Supabase Storage RLS policies.

#### 10. Post Visibility & Privacy

10.1. **Private posts / comments** — Any post or comment can be marked as **private**, except the original post that is created together with the ticket. When a post or comment is private, it is visible only to the ticket owner, their team members, and agents/admins — even if the ticket itself is public.
10.2. **Notes are always internal** — Notes are implicitly restricted to agents and admins and are never visible to regular users.
10.3. **Draft posts** — Any post (post, comment, or note) created by an agent can be saved as a **draft**. A draft post is visible only to agents and admins — regular users cannot see it regardless of ticket or post visibility settings. The draft state indicates that the agent is working on a response but it is not ready to be shared yet. When the agent is satisfied with the content, they publish the draft, which turns it into a regular post visible according to normal visibility rules.

#### 11. Activity / Audit Log

11.1. **Ticket activity log** — Every ticket maintains a chronological activity log that records all significant events. Activity entries are displayed inline in the ticket timeline alongside posts and comments, styled as compact system messages (e.g., gray text, no background card). Each entry records the actor (who performed the action), the timestamp, and a description of the change.
11.2. **Tracked events** — The following events are logged: status changes (open → pending, pending → closed, closed → open, etc.), agent assignment and unassignment, ticket type changes, category changes, severity changes, marking as duplicate (with link to original), removing duplicate link, draft published, and privacy changes on posts/comments.
11.3. **Activity log visibility** — Activity log entries follow the same visibility rules as the ticket itself. All users who can view the ticket can see its activity log. Internal details (e.g., note-related activity) are visible only to agents and admins.

#### 12. Email Notifications

12.1. **Email notifications for users** — Users receive email notifications when: a new post or comment is added to their ticket (by an agent or teammate), the ticket status changes, or an agent is assigned to their ticket. Private notes and draft posts do not trigger notifications to users.
12.2. **Email notifications for agents** — Agents receive email notifications when: a new ticket is created, a user replies to a ticket assigned to them, a ticket is assigned to them, or a user re-opens a closed ticket. An agent does not receive notifications for their own actions.
12.3. **Notification templates** — The admin configures separate email templates for each notification event (e.g., "New reply on your ticket", "Ticket assigned to you", "New ticket created"). Templates support Markdown and placeholders such as `{{ticketTitle}}`, `{{ticketId}}`, `{{authorName}}`, `{{postBody}}`, and `{{ticketUrl}}`. Each template has a subject line and a body. A "Reset to default" button restores the built-in template.
12.4. **Email configuration** — The admin configures outbound email settings (SMTP host, port, username, password, sender address, and sender display name). A "Send test email" button lets the admin verify the configuration. Email sending is disabled until the configuration is saved and verified.

#### 13. Inbound Email (Email-to-Ticket)

13.1. **Inbound email configuration** — The admin configures a reply-to address (e.g., `support@example.com`) used as the sender/reply address in outbound notifications. When a user replies to a notification email, the system processes the incoming email.
13.2. **Create ticket by email** — An incoming email from a known user that does not match an existing ticket thread creates a new ticket. The email subject becomes the ticket title and the email body becomes the original post.
13.3. **Reply by email** — An incoming email that matches an existing ticket thread (identified by a ticket reference in the email subject, e.g., `[Ticket #123]`) creates a new post on that ticket. If the ticket was closed, the reply re-opens it (same as 2.5). Only emails from users who have permission to view the ticket are processed; others are ignored.
13.4. **Unknown sender auto-reply** — If an incoming email is from an address that does not match any registered user, the system sends an automatic reply informing them that they are not registered and providing a link to the registration page. The email is not processed further (no ticket or post is created). The auto-reply email template is configurable by the admin with a "Reset to default" option.

#### 14. Admin Setup Page

14.1. **Admin setup access** — Only admins can access the Admin Setup page. Admins see a "Setup" link in the navigation bar. Non-admin users do not see it and are redirected away if they try to access the URL directly.
14.2. **Ticket types management** — A section to manage ticket types: add new types, rename existing ones, delete unused types, and set which type is the default. (See 4.1, 4.2.)
14.3. **Categories management** — A section to manage ticket categories: add new categories, rename existing ones, and delete unused categories. (See 5.1, 5.2.)
14.4. **Duplicate ticket template** — A section to edit the Markdown template used for the system-generated post when a ticket is marked as duplicate. The template supports a `{{ticketId}}` placeholder. A "Reset to default" button restores the built-in template. (See 7.4.)
14.5. **Agent management** — A section that shows the list of current agents. The admin can search for a user by email and promote them to the agent role. The admin can also revoke agent rights, turning an agent back into a regular user.
14.6. **Email configuration** — A section to configure outbound SMTP settings and verify them with a test email. (See 12.4.)
14.7. **Notification templates** — A section to view and edit all email notification templates for users and agents, including the unknown-sender auto-reply template, with per-template subject and body fields and a reset-to-default option. (See 12.3, 13.4.)
14.8. **Inbound email configuration** — A section to configure the reply-to address and enable/disable inbound email processing. (See 13.1.)

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
