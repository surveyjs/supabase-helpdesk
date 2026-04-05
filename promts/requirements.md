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
| Edit own posts/comments | ✓ | ✓ | ✓ |
| Edit own notes | — | ✓ | ✓ |
| Edit any post/comment/note | — | ✓ | ✓ |
| Edit ticket title | ✓ (owner) | ✓ | ✓ |
| Change ticket type | — | ✓ | ✓ |
| Set/change ticket severity | ✓ (owner) | ✓ | ✓ |
| Set/change ticket category | ✓ (owner) | ✓ | ✓ |
| Change ticket status (open / pending / closed) | — | ✓ | ✓ |
| Change ticket privacy | — | ✓ | ✓ |
| Assign agent to a ticket | — | ✓ | ✓ |
| Unassign agent from a ticket | — | ✓ | ✓ |
| Mark ticket as duplicate | — | ✓ | ✓ |
| Escalate ticket | — | ✓ | ✓ |
| Delete tickets | — | — | ✓ |
| Access the Agent Dashboard | — | ✓ | ✓ |
| Manage ticket types | — | — | ✓ |
| Manage ticket categories | — | — | ✓ |
| Add/remove tags on tickets | ✓ (accessible tickets) | ✓ | ✓ |
| Manage tags (create/edit/delete) | — | — | ✓ |
| Manage agents (promote/revoke) | — | — | ✓ |\n| Manage email configuration | — | — | ✓ |\n| Manage notification templates | — | — | ✓ |\n| Manage inbound email settings | — | — | ✓ |
| Access the Admin Setup page | — | — | ✓ |

All permission checks must be enforced **at the database level** using Postgres Row-Level Security — the frontend should not be the only line of defense.

---

### User Stories

#### 1. Authentication

1.1. **Sign up** — A visitor can create an account with email and password. After signing up they are told to check their email for confirmation.

1.2. **Log in** — A user can log in with email and password. Invalid credentials show an error message on the same page.

1.3. **Sign out** — A logged-in user can sign out from the navigation bar.

1.4. **Unauthenticated visitors** — If the admin has enabled public access for unauthenticated visitors (see 16.10), unauthenticated visitors can view public tickets. They can’t create or make any modification to any ticket. If public access is disabled, unauthenticated visitors see only the login page and cannot view any tickets.

#### 2. Ticket Statuses

Every ticket has one of the following statuses:

| Status | Color | Meaning |
|---|---|---|
| **Open** | Green | New ticket or requires agent attention. This is the initial status when a ticket is created. |
| **Pending** | Yellow | Waiting on the customer. An agent has responded or asked for information. The ball is in the customer's court. |
| **Closed** | Gray | Resolved and done. No further action expected. |

Status transition rules:

- A new ticket starts as **open**.
- An agent can manually set a ticket to **open**, **pending**, or **closed**.
- When a user (non-agent) replies to a **pending** ticket, it automatically transitions to **open**.
- When a user (non-agent) replies to a **closed** ticket, it automatically transitions to **open** (re-open), subject to the re-open rate limit (see 16.12).
- Users cannot reply to a ticket that is marked as a duplicate.
- Marking a ticket as duplicate automatically sets it to **closed**.
- Removing a duplicate link does **not** change the ticket's status — it stays in its current state (typically closed).
- Escalating a ticket sets its status to **open** (if not already).
- Closing a ticket does **not** remove the assigned agent. The agent remains assigned for tracking and reporting purposes.

Every ticket has one of the following severity levels:

| Severity | Color | Meaning |
|---|---|---|
| **Low** | Blue | Minor issue, no significant impact. Cosmetic bugs, general questions. |
| **Medium** | Teal | Moderate impact, workaround available. Non-critical functionality affected. This is the default severity. |
| **High** | Orange | Major impact, limited or degraded functionality. No easy workaround. |
| **Critical** | Red | System down or completely unusable. Business-stopping, needs immediate attention. |

A new ticket defaults to **Medium**. The ticket owner, agents, and admins can change the severity at any time.

#### 3. Tickets (End-User Perspective)

3.1. **Create a ticket** — A logged-in user can create a support ticket with a title (required), a type (selected from available ticket types, defaults to the system default type), a severity (selected from the four severity levels, defaults to **Medium**), a category (optional, selected from available categories; only shown if categories exist), an original post body (required, Markdown text), and a "Private" checkbox. The default state of the checkbox (checked or unchecked) is configured by the admin (see 16.10). If the admin has disabled user control over privacy, the checkbox is hidden and all tickets are created with the admin-configured default. Private tickets are only visible to the owner, their teammates, and agents/admins. The original post is created automatically together with the ticket.

3.2. **View my tickets** — The home page shows a paginated list of the current user's tickets sorted by last-updated. Each entry shows the title, last-updated date, and a color-coded status badge (green = open, yellow = pending, gray = closed). Clicking a ticket opens the detail page. The page size is configured by the admin (see 16.11); the default is 20. Pagination controls (previous/next and page numbers) appear at the bottom of the list. The current page is stored in URL search params.

3.3. **Empty state** — If a user has no tickets, show a friendly message with a link to create one.

3.4. **Ticket detail** — Shows the ticket title, type, status, severity, category (if categories exist and one is set), tags (if at least one tag is defined), assigned agent (if any), submitter email, creation date, and a chronological list of posts. If the ticket is marked as a duplicate, a banner shows the link to the original ticket. The original post appears first as the ticket's description. Each post can have its own chronological list of comments displayed beneath it. The current user's own posts/comments have a blue-tinted background; others have a white background.

3.5. **Reply to a ticket** — Below the post list there is a text area and a "Reply" button to add a new post. Users can reply even if the ticket is closed or pending — doing so automatically transitions the ticket to **open** (see section 2). Users cannot reply to a ticket that is marked as a duplicate. Re-opening a closed ticket via reply is subject to a rate limit configured by the admin (see 16.12); if the user has exceeded the maximum number of re-opens within a 24-hour window, their reply is still posted but the ticket status does **not** change and the user sees a message explaining the limit.

3.6. **Public vs private** — Public tickets are visible to any logged-in user. If public access for unauthenticated visitors is enabled by the admin (see 16.10), public tickets are also visible to unauthenticated visitors (useful for SEO indexing). Private tickets are visible only to the owner, teammates, and agents/admins.

3.7. **Search tickets** — A search field on the tickets list page lets the user search their own tickets (and team tickets, if applicable) by title or original post content (partial match). Public tickets are also searchable. Search uses URL search params so results are bookmarkable. A "Clear" link removes the search filter. Search results are paginated with the same page size as the user ticket list (see 16.11).

3.8. **Filter by status** — Toggle buttons on the tickets list page let the user filter by "All", "Active" (open + pending), or "Closed".

3.9. **SEO-friendly ticket URLs** — Each ticket has a permanent, human-readable URL in the format `/tickets/{id}/{slug}`, where `{id}` is the immutable numeric ticket ID and `{slug}` is a URL-safe, lowercase, hyphenated version of the ticket title (e.g., `/tickets/42/password-reset-not-working`). The `{id}` is the authoritative identifier — if the slug in the URL doesn't match the current title, the server redirects to the correct URL. This ensures stable, shareable links even if the title changes.

3.10. **Customer satisfaction (CSAT)** — The ticket owner can mark an agent's post as **"Solved"**, indicating that it resolved their issue. Only one post per ticket can be marked as solved at a time; marking a different post moves the solved mark. Once a post is marked as solved, a 1–5 star rating widget appears on the ticket detail page (in the ticket metadata area, not in the timeline). The user may optionally add a text comment along with the rating. The CSAT rating, comment, and the solved post reference are stored as ticket metadata — not as a post in the timeline. The agent who authored the solved post receives a notification about the rating and comment. The rating is displayed in the ticket header/sidebar alongside other metadata (status, severity, etc.), and the solved post is highlighted in the timeline. A user can change the rating (and comment) at any time while the solved mark remains. If the user removes the solved mark, the rating is also removed.

3.11. **Follow a ticket** — A logged-in user can follow any ticket they have access to but did not create. A "Follow" / "Unfollow" toggle is shown on the ticket detail page. Followers receive the same email notifications as the ticket owner (new posts, status changes, agent assignment) but cannot rate the ticket. The ticket owner automatically follows their own ticket and cannot unfollow it.

#### 4. Teams

4.1. **Teams** — Users can belong to a team. A user can belong to at most one team.

4.2. **Team tickets view** — If a user is on a team, the home page shows toggle buttons: "My Tickets" and "Team Tickets". The toggle uses URL search params (e.g., `?view=team`) so the selected view is bookmarkable. "My Tickets" is the default. The "Team Tickets" view lists all tickets created by any member of the same team, sorted by last-updated. Each entry shows the same information as in "My Tickets" (title, last-updated date, status badge) plus the submitter's email so the user can see which teammate created the ticket. If the user is not on a team, the toggle is not shown. The team tickets view is paginated with the same page size as the user ticket list (see 16.11).

4.3. **Teammate visibility** — Team members can see and comment on each other's private tickets. On a teammate's private ticket, the team member can add posts and comments but cannot change the ticket's status, type, category, severity, or privacy (those remain restricted to the owner and agents/admins).

4.4. **Team indicator** — On the ticket detail page, if the ticket belongs to a teammate, a label shows the team name (e.g., "Alice's Team") next to the submitter email. This helps agents and teammates identify the team context.

4.5. **No team management UI needed** — Teams are set up via the database / seed data. No UI for creating or managing teams is required in this version.

#### 5. Ticket Types

5.1. **Ticket types** — Every ticket has a type. The system comes with three pre-defined types: **"Question"** (default), **"Issue"**, and **"Suggestion"**. One type is marked as the default and is pre-selected when creating a new ticket. Once a ticket is created, only an agent or admin can change its type.

5.2. **Manage ticket types** — Admins can create, rename, and delete ticket types. Admins can also change which type is the default. Deleting a type that is in use by existing tickets is not allowed.

#### 6. Ticket Categories

6.1. **Ticket categories** — A ticket has an optional category field. The list of available categories is managed by the admin. There are no default categories. If the categories list is empty, the category field is not shown in the ticket creation form or ticket detail page. The category can be set or changed by the ticket owner or an agent/admin.

6.2. **Manage categories** — Admins can create, rename, and delete categories. Deleting a category that is in use by existing tickets is not allowed.

#### 7. Tags / Labels

7.1. **Tags activation** — Tags become available throughout the application automatically once the admin has created at least **one** tag. When no tags are defined, tag-related UI is hidden throughout the application. There is no separate toggle to enable or disable tags.

7.2. **Tags on tickets** — When at least one tag is defined, a ticket can have zero or more tags. Tags are displayed as colored pills on the ticket detail page and in ticket lists. Users and agents can add or remove tags on tickets they have access to.

7.3. **Manage tags** — Admins create and manage the list of available tags. Each tag has a name and a color (selected from a predefined palette or custom hex value). Admins can rename, change the color of, or delete tags. Deleting a tag removes it from all tickets that use it.

#### 8. Agent Dashboard

8.1. **Agent dashboard access** — Agents and admins see an "Agent Dashboard" link in the navigation bar. Regular users do not see it, and are redirected away if they try to access it directly.

8.2. **View all tickets** — The dashboard shows ALL tickets in the system (both private and public), with the submitter's email, last-updated date, post count, severity badge, and status badge. The list is paginated; the page size is configured separately for the agent dashboard by the admin (see 16.11); the default is 20.

8.3. **Filter by status** — Toggle buttons let the agent filter by "All", "Active" (open + pending), or "Closed".

8.4. **Sort** — Toggle buttons let the agent sort by "Last Modified" (default) or "Created" date.

8.5. **Filter by user** — A text field lets the agent search tickets by submitter email (partial match). A "Clear" link removes the filter.

8.6. **Filter by severity** — A dropdown lets the agent filter tickets by severity level (Low, Medium, High, Critical). Selecting "All" removes the filter.

8.7. **Filter by category** — A dropdown lets the agent filter tickets by category. Only shows if categories exist. Selecting "All" removes the filter.

8.8. **Filter by type** — A dropdown lets the agent filter tickets by ticket type (Question, Issue, Suggestion, or any custom types). Selecting "All" removes the filter.

8.9. **Filter by assigned agent** — A dropdown lets the agent filter tickets by assigned agent. Options include "All", "Unassigned", and each agent's email. This lets agents quickly find their own assigned tickets or unassigned tickets that need attention.

8.10. **Result count** — The dashboard shows "N ticket(s) found" above the list.

8.11. **All filters are URL-based** — Filters use URL search params so the page is bookmarkable and shareable.

#### 9. Agent Actions on Tickets

9.1. **Change status** — On a ticket detail page, an agent sees status action buttons depending on the current state: "Mark Pending" (sets to pending), "Close Ticket" (sets to closed), and "Re-open Ticket" / "Mark Open" (sets to open). The available buttons adapt to the ticket's current status so the agent can transition between any of the three states. Regular users do not see these buttons. Status transition rules are defined in section 2.

9.2. **Reply as agent** — Agents can add a post, comment, or note to any ticket at any time, regardless of the ticket's status (open, pending, or closed). Adding a post or comment to a closed or pending ticket does **not** automatically change its status — the agent must explicitly change the status if desired.

9.3. **Assign / unassign agent** — A ticket can be assigned to an agent, indicating that this agent is responsible for working on it. Only agents and admins can assign, reassign, or unassign an agent. A ticket can have at most one assigned agent at a time. An "Unassign" action (e.g., a clear/remove button next to the assigned agent) removes the current agent without assigning a replacement, leaving the ticket unassigned.

9.4. **Mark as duplicate** — Only an agent or admin can mark a ticket as a duplicate of another ticket by linking it to the original. When a ticket is marked as duplicate, it is automatically closed and a system-generated post is added to the ticket with a Markdown message containing a link to the original ticket. The Markdown template for the duplicate message is configurable by the admin; there is a default template (e.g., *"This ticket has been closed as a duplicate of [#{{ticketId}}](link)."*). An agent or admin can also remove the duplicate link; removing the link does not change the ticket's status.

9.5. **Escalate ticket** — An agent or admin can escalate a ticket to a different agent or admin. Escalation is distinct from simple reassignment: it records an escalation event in the activity log, changes the ticket status to **open** (if not already), and sends a dedicated escalation notification to the target agent/admin. The escalating agent must provide a reason (free-text) which is stored as an internal note visible only to agents and admins. A ticket can be escalated multiple times. The escalation history (who escalated, to whom, when, and why) is visible in the activity log for agents and admins.

9.6. **Delete ticket** — Only an admin can delete a ticket. A "Delete" button with a confirmation prompt is shown on the ticket detail page for admins only. A ticket that has other tickets linked to it as duplicates (i.e., it is the original in a duplicate relationship) cannot be deleted until all duplicate links pointing to it are removed.

#### 10. Canned Responses (Reply Templates)

10.1. **Canned responses** — Agents and admins can create pre-written reply templates (canned responses) to speed up common replies. A canned response has a title, a body (Markdown text), and a visibility setting: **public** (visible to all agents and admins) or **private** (visible only to the agent who created it).

10.2. **Using canned responses** — When composing a post or comment, an agent can pick a canned response from a dropdown or searchable list. Selecting a canned response inserts its body into the text area. The agent can edit the inserted text before submitting.

10.3. **Managing canned responses** — An agent can create, edit, and delete their own private canned responses. Public canned responses can be created by any agent but can only be edited or deleted by the agent who created them or by an admin.

#### 11. Posts, Comments & Notes

A **post** is the primary unit of content within a ticket. Every post belongs to a ticket (foreign key) and stores: creation date, author (user / agent / admin), body (Markdown text), and optional file attachments.

There are three post types:

11.1. **Post (root post)** — A top-level entry in a ticket's timeline. Every ticket has at least one post — the **original post**, which is created together with the ticket and contains its initial description. After that, any user or agent can add more posts. A post cannot reference another post; it always sits at the root level.

11.2. **Comment** — A reply attached to a specific post (foreign key to that post). Comments provide threaded discussion under a post. A comment **cannot** be made on another comment — only on a post.

11.3. **Note** — An internal post visible **only to agents and admins**. Notes are used for internal discussion and are never shown to regular users, regardless of ticket visibility.

11.4. **File attachments** — Any post, comment, or note can include one or more file attachments. Files are uploaded to Supabase Storage. Allowed file types: images (PNG, JPG, GIF, WebP), documents (PDF, DOC, DOCX, XLS, XLSX, TXT, CSV), and archives (ZIP). Maximum file size: 10 MB per file. Attachments are displayed below the post body — images show an inline thumbnail preview; other file types show the file name, size, and a download link. Attachments inherit the visibility of the post they belong to (private post attachments are not accessible to unauthorized users). File access is enforced via Supabase Storage RLS policies.

11.5. **Editing posts, comments, and notes** — The author of a post, comment, or note can edit its body text at any time. Agents and admins can also edit any post, comment, or note regardless of authorship. An edited post shows a small "(edited)" indicator with a timestamp of the last edit. The original content is not preserved (no edit history). Editing a post does **not** trigger email notifications or create an activity log entry.

11.6. **Editing ticket title** — The ticket owner, agents, and admins can edit the ticket title after creation. Editing the title updates the URL slug (the old URL with the stale slug redirects to the new one, per 3.9). Title changes are recorded in the activity log.

#### 12. Post Visibility & Privacy

12.1. **Private posts / comments** — Any post or comment can be marked as **private**, except the original post that is created together with the ticket. When a post or comment is private, it is visible only to the ticket owner, their team members, and agents/admins — even if the ticket itself is public.

12.2. **Notes are always internal** — Notes are implicitly restricted to agents and admins and are never visible to regular users.

12.3. **Draft posts** — Any post (post, comment, or note) created by an agent can be saved as a **draft**. A draft post is visible only to agents and admins — regular users cannot see it regardless of ticket or post visibility settings. The draft state indicates that the agent is working on a response but it is not ready to be shared yet. When the agent is satisfied with the content, they publish the draft, which turns it into a regular post visible according to normal visibility rules. Publishing a draft triggers the same events as creating a new post: email notifications are sent to the relevant users/followers, and an activity log entry is recorded.

#### 13. Activity / Audit Log

13.1. **Ticket activity log** — Every ticket maintains a chronological activity log that records all significant events. Activity entries are displayed inline in the ticket timeline alongside posts and comments, styled as compact system messages (e.g., gray text, no background card). Each entry records the actor (who performed the action), the timestamp, and a description of the change.

13.2. **Tracked events** — The following events are logged: status changes (open → pending, pending → closed, closed → open, etc.), agent assignment, unassignment, and reassignment, ticket title changes, ticket type changes, category changes, severity changes, tag additions and removals, marking as duplicate (with link to original), removing duplicate link, draft published, privacy changes on posts/comments, escalation events (who escalated, to whom, and reason), marking a post as solved, removing the solved mark, and CSAT rating submissions.

13.3. **Activity log visibility** — Activity log entries follow the same visibility rules as the ticket itself. All users who can view the ticket can see its activity log. Internal details (e.g., note-related activity) are visible only to agents and admins.

#### 14. Email Notifications

14.1. **Email notifications for users** — Users receive email notifications when: a new post or comment is added to their ticket (by an agent or teammate), the ticket status changes, or an agent is assigned to their ticket. Followers of a ticket receive the same notifications as the ticket owner (see 3.11). Private notes and draft posts do not trigger notifications to users or followers.

14.2. **Email notifications for agents** — Agents receive email notifications when: a user replies to a ticket assigned to them, a ticket is assigned to them, a user replies to a closed ticket (auto-transitions to open), a ticket is escalated to them, or a user marks their post as solved / submits or changes a CSAT rating on their solved post. An agent does not receive notifications for their own actions. Note: new ticket creation does **not** trigger a notification to all agents — agents see new unassigned tickets via the Agent Dashboard.

14.3. **Notification templates** — The admin configures separate email templates for each notification event (e.g., "New reply on your ticket", "Ticket assigned to you"). Templates support Markdown and placeholders such as `{{ticketTitle}}`, `{{ticketId}}`, `{{authorName}}`, `{{postBody}}`, and `{{ticketUrl}}`. Each template has a subject line and a body. A "Reset to default" button restores the built-in template.

14.4. **Email configuration** — The admin configures outbound email settings (SMTP host, port, username, password, sender address, and sender display name). A "Send test email" button lets the admin verify the configuration. Email sending is disabled until the configuration is saved and verified.

#### 15. Inbound Email (Email-to-Ticket)

15.1. **Inbound email configuration** — The admin configures a reply-to address (e.g., `support@example.com`) used as the sender/reply address in outbound notifications. When a user replies to a notification email, the system processes the incoming email.

15.2. **Create ticket by email** — An incoming email from a known user that does not match an existing ticket thread creates a new ticket. The email subject becomes the ticket title and the email body becomes the original post. The ticket is created with the same defaults as a ticket created from the UI: the admin-configured default privacy setting, the system default ticket type, severity set to **Medium**, no category, and no tags.

15.3. **Reply by email** — An incoming email that matches an existing ticket thread (identified by a ticket reference in the email subject, e.g., `[Ticket #123]`) creates a new post on that ticket. If the ticket was closed or pending, the reply transitions it to open (same as 3.5 / section 2); email-based re-opens are subject to the same rate limit as UI re-opens (see 16.12) — if the limit is exceeded, the reply is still added as a post but the status remains unchanged. If the ticket is marked as a duplicate, the email reply is **rejected** and the system sends an auto-reply informing the sender that the ticket is closed as a duplicate and directing them to the original ticket. Only emails from users who have permission to view the ticket are processed; others are ignored.

15.4. **Unknown sender** — If an incoming email is from an address that does not match any registered user, the system does **not** create a ticket. Instead, it sends an automatic reply informing the sender that they are not registered and providing a link to the registration page. The auto-reply email template is configurable by the admin with a "Reset to default" option (see 16.8).

#### 16. Admin Setup Page

16.1. **Admin setup access** — Only admins can access the Admin Setup page. Admins see a "Setup" link in the navigation bar. Non-admin users do not see it and are redirected away if they try to access the URL directly.

16.2. **Ticket types management** — A section to manage ticket types: add new types, rename existing ones, delete unused types, and set which type is the default. (See 5.1, 5.2.)

16.3. **Categories management** — A section to manage ticket categories: add new categories, rename existing ones, and delete unused categories. (See 6.1, 6.2.)

16.4. **Tags management** — A section to create, rename, change the color of, and delete tags. Tags become active throughout the application automatically once at least one tag is defined; no separate toggle is needed. (See 7.1, 7.2, 7.3.)

16.5. **Duplicate ticket template** — A section to edit the Markdown template used for the system-generated post when a ticket is marked as duplicate. The template supports a `{{ticketId}}` placeholder. A "Reset to default" button restores the built-in template. (See 9.4.)

16.6. **Agent management** — A section that shows the list of current agents. The admin can search for a user by email and promote them to the agent role. The admin can also revoke agent rights, turning an agent back into a regular user.

16.7. **Email configuration** — A section to configure outbound SMTP settings and verify them with a test email. (See 14.4.)

16.8. **Notification templates** — A section to view and edit all email notification templates for users and agents, including the unknown-sender auto-reply template, with per-template subject and body fields and a reset-to-default option. (See 14.3, 15.4.)

16.9. **Inbound email configuration** — A section to configure the reply-to address and enable/disable inbound email processing. (See 15.1.)

16.10. **Ticket privacy settings** — A section with three settings: (1) **Default ticket privacy** — whether new tickets are private or public by default (private by default). (2) **Allow users to change privacy** — a toggle that controls whether users see the "Private" checkbox on the ticket creation form. When disabled, all tickets are created with the admin-configured default and users cannot change privacy. Agents and admins can always change ticket privacy regardless of this setting. (3) **Allow public access for unauthenticated visitors** — a toggle that controls whether unauthenticated visitors can view public tickets (disabled by default). When enabled, public tickets are accessible without login, making them indexable by search engines. When disabled, all ticket pages require authentication.

16.11. **Pagination settings** — A section to configure page sizes for different lists. Each setting has a numeric input with a default of **20**: (1) **User ticket list page size** — applies to "My Tickets", "Team Tickets", and user search results. (2) **Agent dashboard page size** — applies to the Agent Dashboard ticket list. (3) **Other lists page size** — applies to all other paginated lists (e.g., agent management, canned responses, activity log on ticket detail). Minimum page size is 5, maximum is 100.

16.12. **Re-open rate limit** — A numeric setting that controls how many times a user can re-open closed tickets within a 24-hour sliding window. The default is **3**. Setting it to **0** disables the limit (unlimited re-opens). When a user exceeds the limit, their reply to a closed ticket is still posted but the ticket status remains **closed**, and the user sees an informational message. Agents and admins are not subject to this limit.

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
