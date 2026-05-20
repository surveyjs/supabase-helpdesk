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
| Edit any post/comment | — | ✓ | ✓ |
| Edit ticket title | ✓ (owner) | ✓ | ✓ |
| Change ticket type | — | ✓ | ✓ |
| Set/change ticket urgency | ✓ (owner) | ✓ | ✓ |
| Set/change ticket severity | — | ✓ | ✓ |
| Set/change ticket category | ✓ (owner) | ✓ | ✓ |
| Change ticket status (open / pending / closed) | — | ✓ | ✓ |
| Change ticket privacy | — | ✓ | ✓ |
| Change post privacy | — | ✓ | ✓ |
| Assign agent to a ticket | — | ✓ | ✓ |
| Unassign agent from a ticket | — | ✓ | ✓ |
| Mark ticket as duplicate | — | ✓ | ✓ |
| Delete tickets | — | — | ✓ |
| Delete posts/comments | — | ✓ | ✓ |
| Merge tickets | — | ✓ | ✓ |
| Bulk close / assign / change status / tags / severity | — | ✓ | ✓ |
| Bulk delete tickets | — | — | ✓ |
| Block / unblock users | — | — | ✓ |
| Access the Agent Dashboard | — | ✓ | ✓ |
| Manage ticket types | — | — | ✓ |
| Manage ticket categories | — | — | ✓ |
| Add/remove tags on tickets | — | ✓ | ✓ |
| Manage tags (create/edit/delete) | — | — | ✓ |
| Manage custom fields | — | — | ✓ |
| Manage knowledge base articles | — | ✓ | ✓ |
| Manage knowledge base categories | — | — | ✓ |
| Manage SLA policies | — | — | ✓ |
| Access reporting dashboard | — | ✓ (own data) | ✓ |
| View own agent stats | — | ✓ | ✓ |
| Use AI suggested reply | — | ✓ | ✓ |
| Generate KB article from ticket | — | ✓ | ✓ |
| Configure AI settings | — | — | ✓ |
| Manage agents (promote/revoke) | — | — | ✓ |
| Promote/demote admins | — | — | ✓ |
| Manage teams | — | — | ✓ |
| Manage email configuration | — | — | ✓ |
| Manage notification templates | — | — | ✓ |
| Manage inbound email settings | — | — | ✓ |
| Create canned responses | — | ✓ | ✓ |
| Edit/delete own canned responses | — | ✓ | ✓ |
| Edit/delete any public canned response | — | — | ✓ |
| Set/change custom field values | ✓ (owner) | ✓ | ✓ |
| Delete notes | — | ✓ (own) | ✓ |
| View ticket followers list | — | ✓ | ✓ |
| Submit CSAT rating | ✓ (owner) | — | — |
| View admin audit log | — | — | ✓ |
| Manage file upload settings | — | — | ✓ |
| Access the Admin Setup page | — | — | ✓ |
| Add user notes | — | ✓ | ✓ |
| Edit/delete own user notes | — | ✓ | ✓ |
| Delete any user note | — | — | ✓ |
| View user notes | — | ✓ | ✓ |
| Change ticket visibility (own, with tier override) | — | ✓ | ✓ |
| Set/change severity (own, with tier override) | — | ✓ | ✓ |
| Change ticket status (own, with tier override) | — | ✓ | ✓ |
| Change ticket type (own, with tier override) | — | ✓ | ✓ |
| Add/remove tags (own, with tier override) | — | ✓ | ✓ |
| Manage subscription tiers | — | — | ✓ |
| Assign/remove user tiers | — | — | ✓ |

Capabilities marked "with tier override" are available to regular users only when the user has an active (non-expired) subscription tier with the corresponding override enabled (see section 25). Without a tier, these capabilities remain restricted to agents.

**Role inheritance:** The Admin role inherits all Agent capabilities. Throughout this document, when a capability is described as available to "agents," it is implicitly available to admins as well. Capabilities exclusive to admins are explicitly stated as "admin-only" or "admins." This avoids repeating "agents and admins" throughout the spec.

All permission checks must be enforced **at the database level** using Postgres Row-Level Security — the frontend should not be the only line of defense.

---

### User Stories

#### 1. Authentication

The system supports exactly one of two mutually exclusive authentication modes, configured by the admin (see 16.13):

| Mode | Description |
|---|---|
| **Built-in** | Email/password sign-up and login managed by Supabase Auth, with optional social OAuth providers (Google, GitHub, etc.) configured via Supabase Auth's built-in social provider support. This is the default. |
| **External** | Authentication is fully delegated to a single external OAuth/OIDC identity provider (e.g., corporate SSO). Sign-up, login, password reset, and password change are all handled by the external provider — the HelpDesk UI shows only a **"Sign in with {ProviderName}"** button. Useful for company-internal helpdesks where all users authenticate through the organization's identity provider. |

The two modes are **mutually exclusive** — only one can be active at a time. Switching modes is an admin operation (see 16.13) and requires confirmation since it affects how all users authenticate.

1.1. **Sign up (built-in mode)** — A visitor can create an account with email and password. Passwords must be at least **8 characters** long and contain at least one uppercase letter, one lowercase letter, and one digit. If the password does not meet these requirements, the form shows a validation error. After signing up they are told to check their email for confirmation. If social OAuth providers are enabled (see 16.13), the sign-up page also shows **"Sign up with {Provider}"** buttons (e.g., "Sign up with Google", "Sign up with GitHub"). Clicking a social button initiates the OAuth flow via Supabase Auth; on first use, a HelpDesk account is automatically created using the `email` and `name` claims from the provider. If the provider does not supply a display name, the local part of the email is used.

1.1a. **Sign up (external mode)** — No dedicated sign-up page. When a user authenticates via the external provider for the first time, a HelpDesk user profile is automatically provisioned using the `email` and `display_name` (or `name`) claims from the OAuth/OIDC token. If the provider does not supply a display name, the local part of the email is used. The user is assigned the **User** role by default. Subsequent logins match on the provider's `sub` (subject) claim via Supabase Auth's identity linking.

1.2. **Log in (built-in mode)** — A user can log in with email and password. Invalid credentials show an error message on the same page. If social OAuth providers are enabled, the login page also shows **"Sign in with {Provider}"** buttons below the email/password form. To prevent brute-force attacks on the email/password form, the system enforces login rate limiting: after **5 consecutive failed login attempts** for the same email, the account is temporarily locked for **15 minutes**. During the lockout period, further login attempts are rejected with a message indicating the remaining lockout time. The lockout counter resets after a successful login. Login rate limiting is enforced in the Next.js Server Action that handles sign-in: before forwarding the credentials to Supabase Auth, the Server Action checks a `login_attempts` table (via a Supabase service-role client) for the failure count and lockout timestamp. On failed login, the counter is incremented; on successful login, it is reset. This approach requires no custom API server, keeps the logic server-side, and is consistent with the architecture constraint that all mutations happen through Server Actions. Rate limiting does **not** apply to social OAuth logins since credential validation is handled by the social provider.

1.2a. **Log in (external mode)** — By default, the login page shows only a **"Sign in with {ProviderName}"** button (where `{ProviderName}` is the display name configured by the admin — see 16.13). No email/password form is shown. Clicking the button initiates the OAuth/OIDC authorization code flow via Supabase Auth. On successful callback, the user is redirected to the home page. The brute-force rate limiting (`login_attempts` table) does **not** apply since credential validation is handled entirely by the external provider. If the admin has enabled **auto-redirect** (see 16.13), unauthenticated users accessing any protected page are immediately redirected to the external provider's login page — no interstitial HelpDesk login page is shown. The HelpDesk login page remains accessible at `/login?no_redirect=true` as a fallback for troubleshooting. Auto-redirect does not apply to public pages accessible by unauthenticated visitors (see 1.5).

1.3. **Sign out** — A logged-in user can sign out from the navigation bar. This works identically for both authentication modes — Supabase Auth handles session invalidation regardless of the original provider.

1.4. **Forgot password (built-in mode)** — The login page has a "Forgot password?" link. Clicking it shows a form where the user enters their email. If the email matches a registered account that uses email/password authentication, a password reset email is sent with a one-time link. The link opens a page where the user sets a new password. Users who signed up via a social OAuth provider do not have a password — if they enter their email, they see a message directing them to sign in with their social provider instead. In **external mode**, the "Forgot password?" link is hidden entirely (password management is handled by the external provider).

1.5. **Unauthenticated visitors** — If the admin has enabled public access for unauthenticated visitors (see 16.10), unauthenticated visitors can view public tickets. This includes access to the "Browse Public Tickets" page (`/tickets/public`, see 3.7) with its search and filter functionality, as well as individual public ticket detail pages via direct URL. They can't create or make any modification to any ticket. If public access is disabled, unauthenticated visitors see only the login page and cannot view any tickets.

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
- When a user (non-agent) replies to a **closed** ticket, it automatically transitions to **open** (re-open).
- Regular users cannot reply to a ticket that is marked as a duplicate. Agents can still add posts, comments, and notes to duplicate tickets.
- Marking a ticket as duplicate automatically sets it to **closed**.
- Removing a duplicate link does **not** change the ticket's status — it stays in its current state (typically closed).
- Closing a ticket does **not** remove the assigned agent. The agent remains assigned for tracking and reporting purposes.

Every ticket has two priority fields: **urgency** (set by the ticket owner) and **severity** (set by agents).

**Urgency** reflects how important the issue is to the user. The ticket owner selects an urgency level when creating a ticket; agents can also change it.

| Urgency | Color | Meaning |
|---|---|---|
| **Low** | Blue | Minor inconvenience, no rush. |
| **Medium** | Teal | Noticeable impact, but can wait. This is the default. |
| **High** | Orange | Significantly affects work, needs attention soon. |
| **Critical** | Red | Completely blocked, needs immediate help. |

**Severity** reflects the operational or technical impact as assessed by a support agent. Only agents can set or change severity. Severity defaults to **Medium** on new tickets.

| Severity | Color | Meaning |
|---|---|---|
| **Low** | Blue | Minor issue, no significant impact. Cosmetic bugs, general questions. |
| **Medium** | Teal | Moderate impact, workaround available. Non-critical functionality affected. |
| **High** | Orange | Major impact, limited or degraded functionality. No easy workaround. |
| **Critical** | Red | System down or completely unusable. Business-stopping, needs immediate attention. |

A new ticket defaults to **Medium** urgency and **Medium** severity. SLA policies are based on severity (see 17.2) — if no SLA policy is mapped to the ticket's severity level, no SLA targets apply.

#### 3. Tickets (End-User Perspective)

3.1. **Create a ticket** — A logged-in user can create a support ticket with a title (required), a type (selected from available ticket types, defaults to the system default type), an urgency level (selected from the four urgency levels, defaults to **Medium**), a category (optional, selected from available categories; only shown if categories exist), an original post body (required, Markdown text), and a "Private" checkbox. The default state of the checkbox (checked or unchecked) is configured by the admin (see 16.10). If the admin has disabled user control over privacy, the checkbox is hidden and all tickets are created with the admin-configured default. Private tickets are only visible to the owner, their teammates, and agents. The original post is created automatically together with the ticket.

3.2. **View my tickets** — The home page shows a paginated list of the current user's tickets sorted by last-updated. Each entry shows the title, last-updated date, and a color-coded status badge (green = open, yellow = pending, gray = closed). Clicking a ticket opens the detail page. The page size is configured by the admin (see 16.11); the default is 20. Pagination controls (previous/next and page numbers) appear at the bottom of the list. The current page is stored in URL search params.

3.3. **Empty state** — If a user has no tickets, show a friendly message with a link to create one.

3.4. **Ticket detail** — Uses full viewport width (exception to the standard max-w-5xl constraint). Two-column layout: main content area (left, flex-1) with editable title, posts timeline with tabs (Posts / Notes for agents), and reply form; sidebar (right, w-80/w-96) with compact ticket metadata and agent controls. The sidebar is a single sticky scrollable container (`sticky top-4`, `max-h-[calc(100vh-2rem)]`, `overflow-y-auto`). Shows the ticket title, type, status, urgency, severity, category (if categories exist and one is set), tags (if at least one tag is defined), assigned agent (if any, shown by display name), submitter display name with subscription tier pill (if tiers are defined and the submitter has an active tier — see 25.4), creation date with relative time (e.g., "4/18/2026 (2 d ago)"), custom fields (if any, see 3.13), and a chronological list of posts. The ticket number (`#123`) is shown in the sidebar, not in the main content area. When the viewer is an agent, fields that are editable in the Agent Controls panel (Type, Category, Urgency, Severity, Assignment, Privacy) are hidden from the Ticket Information section to avoid duplication. Email addresses are never shown on the ticket detail page or ticket lists for any user — only display names are visible. If the ticket is marked as a duplicate, a banner shows the link to the original ticket. The original post appears first as the ticket's description. Each post can have its own chronological list of comments displayed beneath it; comments can themselves have nested replies (up to 2 levels, see 11.2) shown indented beneath the parent comment. The current user's own posts/comments have a blue-tinted background; others have a white background. For agents, the submitter's display name is rendered as a clickable link to the user's profile page (see 20.5, 24.5); the same applies to author display names on posts and comments. If the ticket submitter has user notes (see 24.4), a "User Notes" section is shown in the sidebar, visible to agents only. No back-links ("← My Tickets", "← Agent Dashboard") are shown — these destinations are accessible from the navigation bar.

3.4.1. **Collapsible timeline** — To keep the ticket detail page fast and readable on long-lived tickets, the timeline uses progressive disclosure:

- The **original post** is always visible at the top.
- The most recent **N** posts (with their comments, notes, and inline activity entries) are shown in full, where **N** is the **visible posts threshold** configured by the admin (see 16.11); the default is **10**. Standalone activity entries (status changes, tag changes, etc. — those not tied to a specific post) that fall within or after the date range of the visible posts are also shown. Standalone activity entries older than the oldest visible post are collapsed together with the older posts.
- If the ticket has more than N posts, the older posts and their associated standalone activity entries are collapsed behind a clickable **"Show N older posts and M activity entries"** link between the original post and the visible recent posts. Clicking the link expands the hidden posts in place (no page reload). Once expanded, a **"Collapse older posts"** link allows re-collapsing them.
- For **comment threads** on a post: the most recent **M** comments are shown, where **M** is the **visible comments threshold** configured by the admin (see 16.11); the default is **3**. If a post has more than M comments, the older comments are collapsed behind a **"Show N older comments"** link at the top of the thread. Clicking it expands the hidden comments in place.
- Activity log entries (see 13.1) are grouped with the posts they relate to chronologically. Activity entries that are tied to a specific post (e.g., "draft published") are grouped with that post and appear when their parent post is visible.

3.5. **Reply to a ticket** — Below the post list there is a text area and a "Reply" button to add a new post. Users can reply even if the ticket is closed or pending — doing so automatically transitions the ticket to **open** (see section 2). Regular users cannot reply to a ticket that is marked as a duplicate; agents can still add posts, comments, and notes to duplicate tickets (see section 2).

3.6. **Public vs private** — Public tickets are visible to any logged-in user. If public access for unauthenticated visitors is enabled by the admin (see 16.10), public tickets are also visible to unauthenticated visitors (useful for SEO indexing). Private tickets are visible only to the owner, teammates, and agents.

3.7. **Search tickets** — A search field on the tickets list page lets the user search their own tickets (and team tickets, if applicable) by title or original post content (partial match). Search uses URL search params so results are bookmarkable. A "Clear" link removes the search filter. Search results are paginated with the same page size as the user ticket list (see 16.11). A separate **"Browse Public Tickets"** page (e.g., `/tickets/public`) allows searching and browsing all public tickets by title or original post content (same scope as user search — original post only, not all posts). This page has its own search field, status filter, and pagination. It is accessible via a link on the tickets list page. Public ticket search results are never mixed into the "My Tickets" or "Team Tickets" lists.

3.8. **Filter by status** — Toggle buttons on the tickets list page let the user filter by "All", "Active" (open + pending), or "Closed".

3.9. **SEO-friendly ticket URLs** — Each ticket has a permanent, human-readable URL in the format `/tickets/{id}/{slug}`, where `{id}` is the immutable numeric ticket ID and `{slug}` is a URL-safe, lowercase, hyphenated version of the ticket title (e.g., `/tickets/42/password-reset-not-working`). The `{id}` is the authoritative identifier — if the slug in the URL doesn't match the current title, the server issues a **307 Temporary Redirect** to the correct URL (temporary because the title may change again). This ensures stable, shareable links even if the title changes.

3.10. **Customer satisfaction (CSAT)** — When an agent closes a ticket, the system automatically sends a CSAT survey email to the ticket owner after a configurable delay (see 16.19). The email contains a unique, token-based link that does not require login. CSAT tokens are cryptographically random (at least 32 bytes of entropy), expire **30 days** after issuance, and are single-use — once a rating is submitted the token is invalidated and a new token is issued. The confirmation page displayed after submission includes a persistent link with the new token, allowing the user to bookmark it and update their rating later without needing another email. Expired or invalid tokens show a friendly error page (see 16.23). The link opens a lightweight page where the user selects a satisfaction rating from **1 to 5 stars** and optionally adds a text comment. Agents and admins cannot submit CSAT ratings, even on tickets they own — CSAT is exclusively for regular users. One rating per ticket — submitting a new rating overwrites the previous one. The CSAT rating, comment, and submission timestamp are stored as ticket metadata. The assigned agent receives a notification when a rating is submitted. The rating is displayed in the ticket header/sidebar alongside other metadata (status, urgency, severity, etc.). When the ticket owner views the ticket detail page and has already submitted a rating, an "Update rating" link is displayed next to the CSAT rating. Clicking the link opens the same CSAT rating page using a freshly issued token, allowing the owner to update their rating without needing the original email. If the ticket is closed and the owner has **not yet submitted a rating**, a **"Rate this ticket"** link is displayed in the ticket header/sidebar instead. Clicking it issues a fresh CSAT token and opens the same rating page, allowing the owner to submit an initial rating directly from the UI without relying on the survey email. Once a rating is submitted, the link changes to "Update rating" as described above. If the ticket is re-opened after a rating is submitted, the rating is preserved. If CSAT surveys are disabled by the admin, no survey email is sent. The in-UI "Rate this ticket" and "Update rating" links on the ticket detail page remain functional regardless of the CSAT survey email toggle — disabling surveys only suppresses automatic survey emails, not the ability to rate via the UI.

3.11. **Follow a ticket** — A logged-in user can follow any ticket they have access to but did not create. A "Follow" / "Unfollow" toggle is shown on the ticket detail page. Followers receive the same email notifications as the ticket owner (new posts, status changes, agent assignment) but cannot rate the ticket. The ticket owner automatically follows their own ticket and cannot unfollow it. Agents can view the list of followers on any ticket they have access to — a "Followers" section in the ticket metadata area shows the count and, when expanded, the list of follower display names.

3.12. **Markdown editor** — All text areas for composing posts, comments, and notes use a rich Markdown editor (`react-markdown-editor-lite` via a `MarkdownEditor` abstraction component) with live preview, toolbar (bold, italic, headings, links, images, code blocks, lists, tables), and native image upload (drag-and-drop, paste, toolbar). The user can choose between three view modes: **both** (editor + preview side-by-side), **preview** (preview only), or **editor** (editor only). The preferred view mode is stored as `editor_view_mode` on the user's `profiles` row (default: `both`) and persists across sessions. Users can toggle the mode in-editor; changes are saved to their profile. The editor renders the same Markdown subset used in the final display.

3.13. **Custom fields** — Tickets can have additional custom fields defined by the admin (see 16.14). Custom fields are stored as a JSON object on the ticket. On the ticket creation form, custom fields are displayed after the standard fields. On the ticket detail page, custom fields are displayed in the metadata area. The ticket owner and agents can set and edit custom field values.

3.13a. **Source article reference** — When a ticket is created from a knowledge base article (see 19.8), the source article ID is stored as a dedicated metadata field (`source_article_id`) on the ticket. This field is displayed in the ticket detail sidebar as a clickable link to the article, visible only to agents. It is a system-managed field (not a custom field) and cannot be edited by users.

3.14. **Ticket creation rate limit** — To prevent spam, the system limits how many tickets a user can create within a 24-hour sliding window. The limit is configured by the admin (see 16.12); the default is **10**. When the limit is reached, the user sees an error message and cannot create new tickets until the window expires. Agents are not subject to this limit. The rate limit is enforced in the Next.js Server Action that creates tickets: before inserting the ticket, the action queries the `tickets` table for the count of tickets created by the current user within the last 24 hours. For email-created tickets (see 15.2), the same check is performed in the inbound email processing logic. As a defense-in-depth measure, a Postgres `BEFORE INSERT` trigger on the `tickets` table also enforces the limit, rejecting inserts that would exceed the configured threshold (except for users with the agent role).

#### 4. Teams

4.1. **Teams** — Users can belong to a team. A user can belong to at most one team.

4.2. **Team tickets view** — If a user is on a team, the home page shows toggle buttons: "My Tickets" and "Team Tickets". The toggle uses URL search params (e.g., `?view=team`) so the selected view is bookmarkable. "My Tickets" is the default. The "Team Tickets" view lists all tickets created by any member of the same team, sorted by last-updated. Each entry shows the same information as in "My Tickets" (title, last-updated date, status badge) plus the submitter's display name so the user can see which teammate created the ticket. If the user is not on a team, the toggle is not shown. The team tickets view is paginated with the same page size as the user ticket list (see 16.11).

4.3. **Teammate visibility** — Team members can see and comment on each other's private tickets. On a teammate's private ticket, the team member can add posts and comments but cannot change the ticket's status, type, category, urgency, severity, tags, or privacy (those remain restricted to the owner and agents).

4.4. **Team indicator** — On the ticket detail page, if the ticket belongs to a teammate, a label shows the team name (e.g., "Alice's Team") next to the submitter's display name. This helps agents and teammates identify the team context.

4.5. **Team management (admin)** — Admins can manage teams from the Admin Setup page (see 16.21). The team management section allows admins to: create new teams (with a name), rename existing teams, delete teams (only if they have no members), add users to a team (by searching by email), and remove users from a team. A user can belong to at most one team; assigning a user to a new team removes them from their previous team. Team membership changes take effect immediately.

#### 5. Ticket Types

5.1. **Ticket types** — Every ticket has a type. The system comes with three pre-defined types: **"Question"** (default), **"Issue"**, and **"Suggestion"**. One type is marked as the default and is pre-selected when creating a new ticket. Once a ticket is created, only an agent can change its type.

5.2. **Manage ticket types** — Admins can create, rename, and delete ticket types. Admins can also change which type is the default. Deleting a type that is in use by existing tickets is not allowed.

#### 6. Ticket Categories

6.1. **Ticket categories** — A ticket has an optional category field. The list of available categories is managed by the admin. There are no default categories. If the categories list is empty, the category field is not shown in the ticket creation form or ticket detail page. The category can be set or changed by the ticket owner or an agent.

6.2. **Manage categories** — Admins can create, rename, and delete categories. Deleting a category that is in use by existing tickets is not allowed.

#### 7. Tags / Labels

7.1. **Tags activation** — Tags become available throughout the application automatically once the admin has created at least **one** tag. When no tags are defined, tag-related UI is hidden throughout the application. There is no separate toggle to enable or disable tags.

7.2. **Tags on tickets** — When at least one tag is defined, a ticket can have zero or more tags. Tags are displayed as colored pills on the ticket detail page and in ticket lists. Agents can add or remove tags on tickets they have access to.

7.3. **Manage tags** — Admins create and manage the list of available tags. Each tag has a name and a color (selected from a predefined palette or custom hex value). Admins can rename, change the color of, or delete tags. Deleting a tag removes it from all tickets that use it.

#### 8. Agent Dashboard

8.1. **Agent dashboard access** — Agents see an "Agent Dashboard" link in the navigation bar. Regular users do not see it, and are redirected away if they try to access it directly.

8.2. **View all tickets** — The dashboard shows ALL tickets in the system (both private and public), with the submitter's display name, subscription tier pill (if tiers are defined and the user has an active tier — see 25.9), last-updated date, post count, urgency badge, severity badge, and status badge. The submitter's display name is a clickable link to the user's profile page (see 20.5). Email addresses are not shown in the agent dashboard ticket list — only display names are visible, consistent with the rest of the application (see 20.3). Agents can view a user's email on their profile page (see 20.5). The list is paginated; the page size is configured separately for the agent dashboard by the admin (see 16.11); the default is 20.

8.3. **Filter by status** — Toggle buttons let the agent filter by "All", "Active" (open + pending), or "Closed".

8.4. **Sort** — Toggle buttons let the agent sort by "Last Modified" (default), "Created" date, or "SLA Risk" (most at-risk tickets first, based on SLA indicators — see 17.4).

8.5. **Filter by user** — A text field lets the agent search tickets by submitter email (partial match). A "Clear" link removes the filter.

8.6. **Filter by urgency / severity** — Separate dropdowns let the agent filter tickets by urgency level and/or severity level (Low, Medium, High, Critical, or "All").

8.7. **Filter by category** — A dropdown lets the agent filter tickets by category. Only shows if categories exist. Selecting "All" removes the filter.

8.8. **Filter by type** — A dropdown lets the agent filter tickets by ticket type (Question, Issue, Suggestion, or any custom types). Selecting "All" removes the filter.

8.9. **Filter by assigned agent** — A dropdown lets the agent filter tickets by assigned agent. Options include "All", "Unassigned", and each agent's display name (with email shown parenthetically for disambiguation). This lets agents quickly find their own assigned tickets or unassigned tickets that need attention.

8.10. **Filter by team** — A dropdown lets the agent filter tickets by team. Only shown if at least one team exists. Options include "All", "No team", and each team's name. This lets agents filter tickets submitted by members of a specific team.

8.10a. **Filter by tag** — A multi-select dropdown lets the agent filter tickets by one or more tags. Only shown if at least one tag is defined. The agent can select multiple tags; tickets matching **any** of the selected tags are shown (OR logic). A "Clear" option removes the tag filter. This filter is URL-based and combines with all other filters.

8.10b. **Filter by tier** — A dropdown lets the agent filter tickets by the submitter's subscription tier. Only shown if at least one tier is defined (see 25.9). Options include "All", "No tier", and each defined tier's display name. This filter is URL-based and combines with all other filters.

8.11. **Result count** — The dashboard shows "N ticket(s) found" above the list.

8.12. **All filters are URL-based** — Filters use URL search params so the page is bookmarkable and shareable.

8.13. **Saved views** — Agents can save the current combination of filters and sort order as a named view (e.g., "My open Critical tickets", "Unassigned this week"). Saved views appear as quick-access links above the filter controls. Each agent manages their own saved views — saved views are private to the agent who created them. An agent can rename or delete their saved views. Clicking a saved view applies all its filters and sort to the dashboard URL. Each saved view is stored as a `TicketFilterDefinition` (`{ type: 'json' \| 'ai', data, sql }`) so that the same shape carries today's JSON-driven filters and tomorrow's AI-generated ones; see `promts/changes/agent-dashboard-surveyjs-filtering.md` for the implementation contract.

8.14. **Search by title/content** — A text field lets the agent search tickets by title or post content — including all posts, not just the original post (partial match). This provides deeper search than the user-facing search (3.7), which only searches the title and original post content. This is separate from the submitter email filter (8.5). A "Clear" link removes the search. The search filter is URL-based and combines with all other filters.

8.15. **Bulk actions** — The agent dashboard supports bulk operations on multiple tickets. Agents can select tickets using checkboxes (individual selection + "Select all on this page"). A bulk action toolbar appears when at least one ticket is selected, offering the following actions: (1) **Bulk close** — close all selected tickets; tickets already closed are skipped. (2) **Bulk assign** — assign all selected tickets to a chosen agent via a single agent picker. (3) **Bulk unassign** — remove the assigned agent from all selected tickets. (4) **Bulk change status** — set all selected tickets to a chosen status (open, pending, or closed). (5) **Bulk add tags** — add one or more tags to all selected tickets (only shown if tags are defined). (6) **Bulk remove tags** — remove one or more tags from all selected tickets. (7) **Bulk set severity** — set severity on all selected tickets to a chosen level. (8) **Bulk delete** — (admin only) delete all selected tickets, with a confirmation prompt showing the count; closed tickets, tickets that are originals in duplicate relationships, and tickets that are targets of merge operations (i.e., source ticket stubs link to them) are skipped with a warning (same constraints as single delete, see 9.5). Each bulk action shows a confirmation summary ("Apply to N tickets?") before executing. Bulk actions generate individual activity log entries for each affected ticket. Bulk actions are processed server-side in a single Server Action call. Status transition side effects apply normally (e.g., bulk-closing tickets triggers CSAT survey scheduling per 16.19), except for tickets marked as duplicate — the duplicate flag overrides normal side effects (no CSAT scheduling, no status-change notifications, and no SLA alerts), consistent with single-ticket duplicate behavior (see 9.4). Email notifications are sent per normal rules but are batched to avoid flooding — at most one notification email per recipient per bulk operation, summarizing the affected tickets. In-app notifications for bulk actions are also batched: at most one in-app notification per recipient per bulk operation, summarizing the count and type of changes (e.g., "50 tickets were closed by Agent Smith").

8.16. **Agent personal stats** — The agent dashboard includes a collapsible "My Stats" panel at the top showing the current agent's personal metrics for the last 30 days: number of tickets assigned, number of tickets resolved (closed), average response time, average resolution time, average CSAT rating, and SLA compliance rate (percentage of assigned tickets that met SLA targets). Metrics are read-only and calculated from the same data used in the admin reporting dashboard (section 18). Agents can only see their own stats — not other agents' metrics.

#### 9. Agent Actions on Tickets

9.1. **Change status** — On a ticket detail page, an agent sees status action buttons depending on the current state: "Mark Pending" (sets to pending), "Close Ticket" (sets to closed), and "Re-open Ticket" / "Mark Open" (sets to open). The available buttons adapt to the ticket's current status so the agent can transition between any of the three states. Regular users do not see these buttons. Status transition rules are defined in section 2.

9.2. **Reply as agent** — Agents can add a post, comment, or note to any ticket at any time, regardless of the ticket's status (open, pending, closed, or marked as duplicate). Adding a post or comment to a closed, pending, or duplicate ticket does **not** automatically change its status — the agent must explicitly change the status if desired.

9.3. **Assign / reassign / unassign agent** — A ticket can be assigned to an agent, indicating that this agent is responsible for working on it. Only agents can assign, reassign, or unassign an agent. A ticket can have at most one assigned agent at a time. If the ticket is currently unassigned, agents see an **"Assign to me"** button on the ticket detail page that assigns the ticket to themselves in a single click, without requiring an agent picker. This is the primary way agents claim unassigned tickets. The full agent picker dropdown is also available for assigning to a different agent. When reassigning a ticket to a different agent, the reassigning agent can optionally provide a reason or note (free-text). If provided, the reason is stored as an internal note visible only to agents, and the activity log records the reassignment along with the reason. The target agent receives a notification that includes the reason. An "Unassign" action (e.g., a clear/remove button next to the assigned agent) removes the current agent without assigning a replacement, leaving the ticket unassigned.

9.4. **Mark as duplicate** — Only an agent can mark a ticket as a duplicate of another ticket by linking it to the original. When a ticket is marked as duplicate, it is automatically closed and a system-generated post is added to the ticket with a Markdown message containing a link to the original ticket. The Markdown template for the duplicate message is configurable by the admin (see 16.5); there is a default template (e.g., *"This ticket has been closed as a duplicate of [#{{ticketId}}](link)."*). The automatic closure caused by marking as duplicate does **not** trigger any notifications — no status-change email or in-app notifications to users or followers, no CSAT survey email scheduling, and no SLA breach/approaching alerts. Notifications resume when an agent performs a subsequent action on the ticket that normally triggers them. An agent can also remove the duplicate link; removing the link does not change the ticket's status.

9.5. **Delete ticket** — Only an admin can delete a ticket. A "Delete" button with a confirmation prompt is shown on the ticket detail page for admins only. **Closed (resolved) tickets cannot be deleted** — the admin must first re-open the ticket before deleting it. This preserves reporting data integrity (resolution metrics, CSAT ratings, SLA compliance) that depends on closed tickets. When an admin attempts to delete a closed ticket, an error message is shown: *"Closed tickets cannot be deleted. Re-open the ticket first if deletion is necessary."* Additionally, a ticket that has other tickets linked to it as duplicates (i.e., it is the original in a duplicate relationship) cannot be deleted until all duplicate links pointing to it are removed. Similarly, a ticket that is the **target** of one or more merge operations (i.e., source ticket stubs link to it) cannot be deleted until all merged source stubs pointing to it are deleted first. This prevents broken links on read-only merge stub pages. In the case of merge chains (e.g., A merged into B, B merged into C), deletion must proceed from the outermost source inward: A must be deleted before B can be deleted, and B before C. The confirmation prompt warns the admin if the ticket is blocked by downstream dependencies and lists the blocking ticket IDs.

9.6. **Merge tickets** — An agent can merge two tickets into one. A ticket that is marked as a duplicate cannot be merged (the duplicate link must be removed first). Merging moves all posts, comments, notes, attachments, activity log entries, and followers from the source ticket into the target ticket. Followers are de-duplicated: if a user already follows the target ticket, the duplicate follow from the source is discarded (union semantics). Followers of the source ticket do **not** receive a merge notification — they are silently transferred to the target ticket and will receive notifications for future activity on the target ticket only. The owner of the source ticket becomes a regular follower of the target ticket (they can unfollow it, unlike their own tickets). As a follower, the source ticket's owner cannot rate the target ticket — only the target ticket's owner can submit a CSAT rating. CSAT ratings are **not** transferred: the source ticket's CSAT rating is discarded; the target ticket's existing rating (if any) is preserved. Any pending CSAT survey email scheduled for the source ticket is cancelled on merge. The source ticket is then closed and marked with a system-generated post linking to the target ticket (using the configurable merge template, see 16.17). Unlike duplicate, merging physically consolidates the timelines — the source ticket becomes a read-only stub. The source ticket remains accessible at its original URL as a read-only page showing a merge banner (using the configurable merge banner template, see 16.22) and a link to the target ticket. It does **not** HTTP-redirect. The reply form is hidden on merged tickets. The merged posts retain their original timestamps and authors so the combined timeline stays chronological. Tags from both tickets are combined (union). The target ticket's type is preserved (the source's type is discarded). The target ticket's category is preserved (the source's category is discarded). The target ticket's urgency is preserved (the source's urgency is discarded). Custom field values from the source are **not** copied to the target (the target's values are preserved). If the source ticket's severity is higher than the target's, the target's severity is upgraded to match and the target's SLA is recalculated accordingly. If the target's severity is equal to or higher than the source's, no severity change occurs. When tickets are merged, the target ticket's SLA timers are preserved — elapsed time from the source ticket's timers is **not** added to the target's. If the merge causes the target's severity to change (due to severity inheritance), the SLA targets are recalculated against the target's existing elapsed time. The source ticket's SLA timers are frozen at their current values for historical reporting purposes but are no longer actively tracked. Merge is irreversible.

#### 10. Canned Responses (Reply Templates)

10.1. **Canned responses** — Agents can create pre-written reply templates (canned responses) to speed up common replies. A canned response has a title, a body (Markdown text), and a visibility setting: **public** (visible to all agents) or **private** (visible only to the agent who created it).

10.2. **Using canned responses** — When composing a post or comment, an agent can pick a canned response from a dropdown or searchable list. Selecting a canned response inserts its body into the text area. The agent can edit the inserted text before submitting.

10.3. **Managing canned responses** — An agent can create, edit, and delete their own private canned responses. Public canned responses can be created by any agent but can only be edited or deleted by the agent who created them or by an admin. Canned response management is done from a dedicated **Canned Responses** page (e.g., `/canned-responses`), accessible to agents via a "Canned Responses" link in the navigation bar (visible only to agents). The page lists all canned responses the agent has access to (their own private responses and all public responses), with search and pagination. Each entry shows the title, visibility (public/private), author, and a preview of the body. The agent can create, edit, and delete responses from this page.

#### 11. Posts, Comments & Notes

A **post** is the primary unit of content within a ticket. Every post belongs to a ticket (foreign key) and stores: creation date, author (user / agent / admin), body (Markdown text), and optional file attachments.

There are three post types:

11.1. **Post (root post)** — A top-level entry in a ticket's timeline. Every ticket has at least one post — the **original post**, which is created together with the ticket and contains its initial description. After that, any user or agent can add more posts. A post cannot reference another post; it always sits at the root level.

11.2. **Comment** — A reply attached to a specific post or another comment. Comments support up to **two levels** of nesting: a comment can be made on a post (level 1), and a reply can be made on a comment (level 2). Replies to level-2 comments are not allowed — the "Reply" action is hidden on second-level comments. This provides focused threaded discussion without deeply nested threads.

11.3. **Note** — An internal post visible **only to agents**. Notes are used for internal discussion and are never shown to regular users, regardless of ticket visibility.

11.4. **File attachments** — Any post, comment, or note can include one or more file attachments. The maximum number of files per post, allowed file types, and maximum file size per file are configured by the admin (see 16.25). Files are uploaded to Supabase Storage. Attachments are displayed below the post body — images show an inline thumbnail preview; other file types show the file name, size, and a download link. The author of a post (or an agent) can delete individual attachments from an existing post. Deleting an attachment removes the file from Supabase Storage permanently. Attachments inherit the visibility of the post they belong to (private post attachments are not accessible to unauthorized users). File access is enforced via Supabase Storage RLS policies.

11.5. **Editing posts, comments, and notes** — The author of a post, comment, or note can edit its body text at any time. This includes the **original post** (the ticket's initial description), which can be edited by the ticket creator (its author) and by any agent. Agents can also edit any non-original post or comment regardless of authorship. However, agents can only edit their **own** notes — they cannot edit notes created by other agents. An edited post shows a small "(edited)" indicator with a timestamp of the last edit. The original content is not preserved (no edit history). Editing a post does **not** trigger email notifications or create an activity log entry. Editing the original post updates the ticket's full-text search vector (see 3.7).

11.6. **Editing ticket title** — The ticket owner and agents can edit the ticket title after creation. Editing the title updates the URL slug (the old URL with the stale slug redirects to the new one, per 3.9). Title changes are recorded in the activity log.

11.7. **Post deletion** — Regular users cannot delete their own posts, comments, or replies. This ensures the integrity of the ticket conversation history for audit and support purposes. Agents can delete any individual post or comment (except the original post, which cannot be deleted), but can only delete their **own** notes — they cannot delete notes created by other agents. Admins can delete any note regardless of authorship. Deleting a post also deletes all its comments and file attachments. Admins can delete an entire ticket (see 9.5). Agents can also delete individual file attachments from posts (see 11.4).

#### 12. Post Visibility & Privacy

12.1. **Private posts** — An agent can mark any post as **private**, except the original post (the first post created together with the ticket, whose visibility is determined by the ticket's privacy setting). A private post is visible only to the ticket owner, their team members, and agents — even if the ticket itself is public. Only agents can change a post's privacy (mark it private or make it public again). Users cannot mark posts as private. When a previously public post is made private, all existing comments on that post (including those written by non-team users) retroactively become private — those comments are no longer visible to users who lack access to the private post. This is by design: the post and its full comment thread are treated as a unit for privacy purposes. All comments on a private post are automatically private — comment privacy is inherited from the root post the thread belongs to (regardless of nesting depth) and cannot be set independently. This allows agents to initiate a private conversation thread within a public ticket (e.g., to request sensitive information from the user), and the user's replies (comments) are automatically protected.

12.2. **Notes are always internal** — Notes are implicitly restricted to agents and are never visible to regular users.

12.3. **Draft posts** — Any post (post, comment, or note) created by an agent can be saved as a **draft**. A draft post is visible only to agents — regular users cannot see it regardless of ticket or post visibility settings. From the user's perspective, a draft does not exist: users cannot see draft posts or comments, cannot reply to them, and the thread structure renders as if the draft were never created. Other agents can see draft posts but cannot comment on or reply to them. Draft posts and comments do not accept any comments or replies — the comment/reply actions are hidden on all drafts regardless of authorship. The draft state indicates that the agent is working on a response but it is not ready to be shared yet. When the agent is satisfied with the content, they publish the draft, which turns it into a regular post visible according to normal visibility rules. Publishing a draft triggers the same events as creating a new post: email notifications are sent to the relevant users/followers, an activity log entry is recorded, and a Supabase Realtime event is emitted so that other users viewing the ticket see the new post appear in real time (see 21.1).

12.4. **Draft privacy** — A draft post can be marked or unmarked as **private** at any time while it is still a draft, just like any other post (except the original post). When the draft is published, its current privacy setting takes effect according to normal visibility rules (see 12.1). Agents can change the privacy of any post (except the original post) at any time, whether the post is a draft or published.

#### 13. Activity / Audit Log

13.1. **Ticket activity log** — Every ticket maintains a chronological activity log that records all significant events. Activity entries are displayed inline in the ticket timeline alongside posts and comments, styled as compact system messages (e.g., gray text, no background card). Each entry records the actor (who performed the action), the timestamp, and a description of the change.

13.2. **Tracked events** — The following events are logged: status changes (open → pending, pending → closed, closed → open, etc.), agent assignment, unassignment, and reassignment (with reason, if provided), ticket title changes, ticket type changes, category changes, urgency changes, severity changes, tag additions and removals, marking as duplicate (with link to original), removing duplicate link, ticket merge (on both the source and target tickets — the source records "merged into #X" and the target records "merged from #Y"), draft published, privacy changes on posts, CSAT rating submissions, custom field value changes (recording the field name, old value, and new value), file attachment uploads (recording the file name and post), file attachment deletions (recording the file name and post), and user note creation, editing, and deletion (recorded in the admin audit log, see 16.24).

13.3. **Activity log visibility** — Activity log entries follow the same visibility rules as the ticket itself. All users who can view the ticket can see its activity log. Internal details (e.g., note-related activity) are visible only to agents.

#### 14. Email Notifications

14.1. **Email notifications for users** — Users receive email notifications when: a new post or comment is added to their ticket (by an agent or teammate), the ticket status changes, an agent is assigned to their ticket, or their ticket is merged into another ticket (the notification includes a link to the target ticket). Followers of a ticket receive the same notifications as the ticket owner (see 3.11), except for merge notifications — when a ticket is merged, only the ticket owner receives the merge notification; followers of the source ticket are silently transferred to the target ticket and do not receive a separate merge notification (see 9.6). Private notes and draft posts do not trigger notifications to users or followers. When an **agent creates a ticket** (i.e., the agent is the ticket owner), the agent receives all user-side notifications for that ticket exactly as a regular user would — status changes, new posts by other agents, assignment changes, and merge notifications.

14.2. **Email notifications for agents** — Agents receive email notifications when: a user replies to a ticket assigned to them, a ticket is assigned to them (with reason, if provided), a user replies to a closed ticket (auto-transitions to open), a user submits or changes a CSAT rating on a ticket assigned to them, an SLA target on a ticket assigned to them is approaching the threshold, an SLA target on a ticket assigned to them is breached, or another agent adds a note to a ticket assigned to them. Admins additionally receive SLA approaching and breach notifications for all tickets, not just those assigned to them (see 17.5). An agent does not receive notifications for their own actions (e.g., if an admin closes a ticket assigned to themselves, they do not receive the closure notification). If a ticket is **unassigned**, agent-side notifications that would normally be sent to the assigned agent (replies, CSAT ratings, notes) are **not sent to anyone** — there is no fallback recipient. SLA approaching and breach notifications for unassigned tickets are still sent to all admins (see 17.5). Note: new ticket creation does **not** trigger a notification to all agents — agents see new unassigned tickets via the Agent Dashboard.

14.3. **Notification templates** — The admin configures separate email templates for each notification event (e.g., "New reply on your ticket", "Ticket assigned to you"). Templates support Markdown and placeholders such as `{{ticketTitle}}`, `{{ticketId}}`, `{{authorName}}`, `{{postBody}}`, and `{{ticketUrl}}`. Each template has a subject line and a body. A "Reset to default" button restores the built-in template.

14.4. **Email configuration** — The admin configures outbound email settings (SMTP host, port, username, password, sender address, and sender display name) for application notification emails (ticket updates, CSAT surveys, SLA alerts, etc.). A "Send test email" button lets the admin verify the configuration. Email sending is disabled until the configuration is saved and verified. **Authentication emails** (signup confirmation, password reset, magic links) are sent via **Supabase’s built-in Custom SMTP** feature, configured separately in the Supabase Dashboard under Auth → SMTP Settings. This separation ensures that auth emails continue to work even if the application’s notification SMTP is misconfigured.

14.5. **Notification preferences** — Each user (including agents) can manage their own notification preferences from a "Notification Settings" page accessible via a link in the navigation bar user menu. The page lists all notification event types the user can receive and provides two toggles for each event type: one for **email** notifications and one for **in-app** notifications. New user accounts inherit the system-wide default notification preferences configured by the admin (see 16.26). Users can override any preference individually. Disabling a notification type suppresses that delivery channel but does not affect other channels or in-app behavior (e.g., activity log entries are always recorded regardless of notification preferences).

14.6. **Agent action notification coalescing** — When an agent modifies a ticket (adds a post or comment, changes status, assigns/unassigns an agent, changes severity, urgency, tags, category, type, or privacy, or publishes a draft), the outgoing **email** notifications to the ticket owner and followers are not sent immediately. Instead, they are placed in a **notification coalescing queue** with a configurable delay (see 16.29). If any agent makes another change to the **same ticket** before the delay expires, the timer resets to the full delay duration from the time of the last change. Once the delay expires with no further agent actions on that ticket, a **single consolidated email notification** is sent to each recipient, summarizing all changes that occurred during the coalescing window.

The consolidated notification uses a dedicated **"Consolidated update"** email template (see 16.8) that lists all changes in chronological order (e.g., "Agent Smith replied · Status changed to Pending · Severity changed to High"). If only one change occurred during the window (the timer expired without additional actions), the notification is sent using the standard single-event template as usual — the consolidated template is only used when two or more events were coalesced.

**Post/comment edit coalescing:** When an agent adds a post or comment and then edits that same post or comment during the coalescing window, the two events are merged into a **single "new post/comment" event** in the consolidated notification — using the final content. The recipient never sees a separate "edited" event for content that was just created. Similarly, if an agent edits a post or comment multiple times during the window, only **one "post/comment edited" event** is included, reflecting the final version. In both cases, the notification links to the post or comment in its final state. This prevents recipients from seeing noise like "Agent replied → Agent edited their reply" when the agent was simply refining their response.

The coalescing delay applies only to **agent-triggered email notifications sent to users and followers** (the events listed in 14.1). It does **not** apply to: agent-to-agent notifications (14.2), SLA notifications (17.5), CSAT survey emails (3.10 / 16.19), bulk action notifications (8.15 — these are already batched), or in-app notifications (14a — these are delivered in real time without delay for immediate visibility, since they don't cause inbox pressure).

**Implementation:** A `notification_coalescing_queue` table stores pending notifications with: ticket ID, recipient user ID, an event list (JSON array of event type, event details, and timestamp), triggering agent ID, and a `send_after` timestamp. When an agent action triggers an email notification, the Server Action either inserts a new queue entry with `send_after = now() + delay` or, if a pending entry for the same ticket + recipient already exists, updates `send_after` to `now() + delay` and appends the new event to the entry's event list (applying post/comment edit coalescing — replacing a "created" + "edited" pair for the same post/comment with a single "created" event using the latest content). A scheduled cron job (every **1 minute**, see Architecture Constraint 11) processes queue entries where `send_after <= now()`, renders and sends the email(s), and deletes the processed entries.

#### 14a. In-App Notifications

14a.1. **Notification bell** — A bell icon is displayed in the navigation bar (right side, next to the user menu) for all logged-in users. The bell shows an **unread count badge** (e.g., a red circle with the number) when there are unread notifications. The badge is hidden when the count is zero.

14a.2. **Notification dropdown** — Clicking the bell icon opens a dropdown panel showing the **10 most recent notifications**. Each notification entry shows: an icon indicating the event type, a short description (e.g., "Agent Smith replied to your ticket #42"), a relative timestamp (e.g., "5 minutes ago"), and a link to the relevant ticket. Unread notifications have a highlighted background; read notifications have a plain background. A **"Mark all as read"** action appears at the top of the dropdown. A **"View all"** link at the bottom opens the full notifications page.

14a.3. **Notifications page** — A dedicated page (`/notifications`) showing all notifications for the current user, paginated (using the "Other lists" page size, see 16.11). Each entry shows the same information as the dropdown plus the full timestamp. Notifications can be individually marked as read/unread by clicking them. A bulk "Mark all as read" button is provided.

14a.4. **Notification events** — In-app notifications are generated for the same events as email notifications (see 14.1, 14.2). Private notes and draft posts do not generate in-app notifications for regular users. Each notification is stored in a `notifications` table with: recipient user ID, event type, reference ticket ID, message text, read/unread status, and creation timestamp.

14a.5. **Real-time delivery** — In-app notifications are delivered in real time via Supabase Realtime. When a new notification is created, the bell badge updates immediately without page refresh. This uses a dedicated Realtime subscription (see architecture constraint 2).

14a.6. **Notification retention** — Notifications older than **90 days** are automatically deleted by a scheduled cleanup. Read notifications older than **30 days** are also eligible for cleanup.

#### 15. Inbound Email (Email-to-Ticket)

15.1. **Inbound email configuration** — The admin configures a reply-to address (e.g., `support@example.com`) used as the sender/reply address in outbound notifications. When a user replies to a notification email, the system processes the incoming email.

15.2. **Create ticket by email** — An incoming email from a known user that does not match an existing ticket thread creates a new ticket. The email subject becomes the ticket title and the email body becomes the original post. The ticket is created with the same defaults as a ticket created from the UI: the admin-configured default privacy setting, the system default ticket type, urgency set to **Medium**, severity set to **Medium**, no category, and no tags. Custom fields are populated with their admin-configured default values for email-created tickets. Required custom fields always use their predefined default value (see 16.14), ensuring every ticket has valid required field values regardless of creation method. If the incoming email includes file attachments, each attachment is saved as a file attachment on the original post, subject to the same file type, file size, and files-per-post limits configured by the admin (see 16.25). Attachments that exceed the maximum file size, use a disallowed file type, or exceed the per-post limit are **not included** as file attachments. Instead, a note is appended to the bottom of the original post body listing the names of the excluded files and the reason for exclusion (e.g., *"The following attachments were not included: screenshot.bmp (disallowed file type), video.mp4 (exceeds 10 MB size limit), report.pdf (maximum 5 files per post reached)."*). This ensures the ticket owner and agents are aware that attachments were dropped. SVG attachments are sanitized following the same rules as UI uploads. The remaining valid attachments are uploaded to Supabase Storage with the same RLS policies as UI-uploaded files. If the sender is a blocked user (see section 22), the email is rejected and the system sends an auto-reply informing them that their account is restricted. Email-created tickets are subject to the same creation rate limit as UI-created tickets (see 3.14 / 16.12); if the user has exceeded the limit, the email is rejected and the system sends an auto-reply informing them of the limit. AI features (auto-categorization and duplicate detection) are not applied to email-created tickets in this version. Email-created tickets use static defaults; agents can manually adjust type, category, urgency, and tags from the ticket detail page.

15.3. **Reply by email** — An incoming email that matches an existing ticket thread (identified by a ticket reference in the email subject, e.g., `[Ticket #123]`) creates a new post on that ticket. If the ticket was closed or pending and the sender is not an agent, the reply transitions it to open (same as 3.5 / section 2). Agent email replies do not auto-transition the ticket status, consistent with 9.2. If the ticket is marked as a duplicate and the sender is not an agent, the email reply is **rejected** and the system sends an auto-reply informing the sender that the ticket is closed as a duplicate and directing them to the original ticket. Agent email replies to duplicate tickets are processed normally, consistent with 9.2. If the sender is a blocked user (see section 22), the email is rejected and the system sends an auto-reply informing them that their account is restricted. Only emails from users who have permission to view the ticket are processed; others are ignored.

15.4. **Unknown sender** — If an incoming email is from an address that does not match any registered user, the system does **not** create a ticket. Instead, it sends an automatic reply informing the sender that they are not registered and providing a link to the registration page. The auto-reply email template is configurable by the admin with a "Reset to default" option (see 16.8).

15.5. **Outbound auto-reply rate limiting** — To prevent the system from being abused as an email relay (e.g., via spoofed sender addresses), outbound auto-reply emails (unknown sender replies, blocked user replies, duplicate ticket replies, and rate-limit rejection replies) are rate-limited to **3 auto-replies per recipient address per hour**. Once the limit is reached, further auto-replies to that address are silently discarded. This limit applies globally across all auto-reply types. Auto-reply counts are tracked in an `auto_reply_log` table with columns: recipient email address, sent timestamp, and reply type. The rate limit check queries this table for rows matching the recipient address within the last hour. Rows older than **24 hours** are cleaned up by the daily scheduled task (see Architecture Constraint 11).

15.6. **Email signature stripping** — When processing inbound emails, the system strips common email signatures, quoted reply text, and forwarded-message headers before creating a post. The system detects standard signature delimiters (e.g., `-- `, `___`, "Sent from my iPhone") and quoted blocks (lines starting with `>`). Only the new content above the signature/quote is used as the post body. If stripping results in an empty body, the full email body is used as a fallback. If the full email body is also empty (or contains only whitespace), the email is discarded and no ticket or post is created — this prevents creating tickets that violate the required body constraint (see 3.1).

#### 16. Admin Setup Page

16.1. **Admin setup access** — Only admins can access the Admin Setup page. Admins see a "Setup" link in the navigation bar. Non-admin users do not see it and are redirected away if they try to access the URL directly. The Admin Setup page uses a **sidebar navigation** layout: a fixed left sidebar lists all configuration sections (Ticket Types, Categories, Tags, Subscription Tiers, Agent Management, Email, etc.) and the right content area displays the selected section. Only one section is shown at a time. The URL reflects the active section (e.g., `/admin/tags`, `/admin/tiers`, `/admin/email`) so direct linking and browser back/forward work correctly.

16.2. **Ticket types management** — A section to manage ticket types: add new types, rename existing ones, delete unused types, and set which type is the default. (See 5.1, 5.2.)

16.3. **Categories management** — A section to manage ticket categories: add new categories, rename existing ones, and delete unused categories. (See 6.1, 6.2.)

16.4. **Tags management** — A section to create, rename, change the color of, and delete tags. Tags become active throughout the application automatically once at least one tag is defined; no separate toggle is needed. (See 7.1, 7.2, 7.3.)

16.5. **Duplicate ticket template** — A section to edit the Markdown template used for the system-generated post when a ticket is marked as duplicate. The template supports a `{{ticketId}}` placeholder. A "Reset to default" button restores the built-in template. (See 9.4.)

16.6. **Agent and admin management** — A section that shows the list of current agents and admins. The admin can search for a user by email and promote them to the **agent** role or the **admin** role. The admin can also demote an admin back to agent, or revoke agent rights entirely, turning them back into a regular user. The system prevents revoking or demoting the **last remaining admin** — the action is rejected with an error message (*"Cannot remove the last admin. Promote another user to admin first."*) to avoid an irrecoverable lockout. Admin promotions, demotions, agent promotions, and agent revocations are recorded in the admin audit log (see 16.24).

16.7. **Email configuration** — A section to configure outbound SMTP settings and verify them with a test email. (See 14.4.)

16.8. **Notification templates** — A section to view and edit all email notification templates for users and agents, including the unknown-sender auto-reply template, the **blocked-user auto-reply template**, the **duplicate-ticket rejection auto-reply template**, the **rate-limit rejection auto-reply template**, the **CSAT survey email template** (with placeholders `{{ticketTitle}}`, `{{ticketId}}`, `{{csatUrl}}`, and `{{ownerName}}`), the **bulk action summary template**, and the **consolidated update template**, with per-template subject and body fields and a reset-to-default option. The bulk action summary template is used when a bulk operation (see 8.15) triggers batched notifications; it supports placeholders `{{actionType}}` (e.g., "closed", "assigned"), `{{ticketCount}}`, `{{actorName}}`, and `{{ticketList}}` (a formatted list of affected ticket titles and IDs). The consolidated update template is used when the notification coalescing delay (see 14.6, 16.29) groups multiple agent actions into a single email; it supports placeholders `{{ticketTitle}}`, `{{ticketId}}`, `{{ticketUrl}}`, `{{changeList}}` (a formatted chronological list of all coalesced changes), `{{agentName}}` (or multiple agent names if different agents made changes during the window), and `{{ownerName}}`. (See 14.3, 15.4.)

16.9. **Inbound email configuration** — A section to configure the reply-to address and enable/disable inbound email processing. (See 15.1.)

16.10. **Ticket privacy settings** — A section with three settings: (1) **Default ticket privacy** — whether new tickets are private or public by default (private by default). (2) **Allow users to change privacy** — a toggle that controls whether users see the "Private" checkbox on the ticket creation form. When disabled, all tickets are created with the admin-configured default and users cannot change privacy. Agents can always change ticket privacy regardless of this setting. (3) **Allow public access for unauthenticated visitors** — a toggle that controls whether unauthenticated visitors can view public tickets (disabled by default). When enabled, public tickets are accessible without login, making them indexable by search engines. When disabled, all ticket pages require authentication.

16.11. **Pagination settings** — A section to configure page sizes for different lists. Each setting has a numeric input with a default of **20**: (1) **User ticket list page size** — applies to "My Tickets", "Team Tickets", and user search results. (2) **Agent dashboard page size** — applies to the Agent Dashboard ticket list. (3) **Other lists page size** — applies to all other paginated lists (e.g., agent management, canned responses, activity log on ticket detail). Minimum page size is 5, maximum is 100. (4) **Visible posts threshold** — the number of most recent posts shown before collapsing older ones on the ticket detail page (see 3.4.1). Default: **10**. Minimum: 3, maximum: 50. (5) **Visible comments threshold** — the number of most recent comments shown per post before collapsing older ones (see 3.4.1). Default: **3**. Minimum: 1, maximum: 20.

16.12. **Ticket creation rate limit** — A numeric setting that controls how many tickets a user can create within a 24-hour sliding window. The default is **10**. Setting it to **0** disables the limit (unlimited creation). When the limit is reached, the user sees an error message and cannot create new tickets until the window expires. Agents are not subject to this limit. (See 3.14.)

16.13. **Authentication configuration** — A section to configure the active authentication mode (see section 1). The admin selects exactly one of two mutually exclusive modes via a radio button:

- **Built-in** (default): Email/password authentication is always available. Additionally, the admin can enable one or more **social OAuth providers** supported by Supabase Auth. Each social provider has an enable/disable toggle and requires provider-specific credentials:
  - **Google** — Client ID, Client secret.
  - **GitHub** — Client ID, Client secret.
  - **Microsoft / Azure AD** — Client ID, Client secret, Tenant ID.
  - **GitLab** — Client ID, Client secret, optional self-hosted instance URL.

  Enabled social providers appear as **"Sign in with {Provider}"** buttons on the login and sign-up pages alongside the email/password form. Credentials are stored encrypted; displayed as masked after saving. A **"Test Connection"** button is available per provider to verify the configuration.

- **External (OAuth/OIDC)**: All authentication is delegated to a single external identity provider. The admin configures:
  - **Provider name** — a display name shown on the login button (e.g., "SurveyJS SSO", "Corporate Login").
  - **Client ID** — the OAuth2 client identifier.
  - **Client secret** — the OAuth2 client secret (stored encrypted; displayed as masked after saving).
  - **Issuer URL** — the OIDC discovery URL (e.g., `https://auth.example.com/.well-known/openid-configuration`). The system uses this to auto-discover authorization, token, and userinfo endpoints.
  - **Scopes** — space-separated list of OAuth scopes (default: `openid email profile`).
  - **Redirect URI** — read-only, auto-generated (shown for copying into the external provider's configuration).

  These values are stored encrypted and applied to the Supabase Auth provider configuration via a Server Action. At most one external provider can be configured. A **"Test Connection"** button allows the admin to verify the configuration before saving.
  - **Auto-redirect to external provider** — a toggle (disabled by default). When enabled, unauthenticated users are automatically redirected to the external provider's login page without seeing the HelpDesk login page. This provides a seamless single-sign-on experience for corporate environments. The HelpDesk login page is still accessible at `/login?no_redirect=true` for troubleshooting (e.g., if the external provider is misconfigured or down). Auto-redirect does not affect public pages accessible by unauthenticated visitors (see 1.5).

**Switching modes** requires confirmation ("Switching authentication mode will affect how all users sign in. Continue?"). When switching from built-in to external, existing email/password users can still access their accounts if their email matches the external provider's identity. When switching from external to built-in, existing external users will need to use the "Forgot password?" flow to set a local password (or use a social provider if enabled).

In **external mode**, the "Change password" section on the user profile page (20.2) is hidden. In **built-in mode**, it is hidden for users who authenticated via a social OAuth provider. Display name editing (20.3) remains available regardless of authentication mode, since it is a HelpDesk-specific field.

16.14. **Custom fields management** — A section to define custom fields for tickets. Each custom field has: a name (unique, displayed as the label), a type (text, number, dropdown, checkbox, or date), an optional "required" flag, and a **default value**. For dropdown fields, the admin defines the list of allowed values. Required custom fields **must** have a predefined default value configured by the admin; this ensures that tickets created via email (see 15.2) or other automated means always have valid values for required fields. Custom fields are stored as a JSON object on each ticket. The admin can reorder, rename, and delete custom fields. Deleting a custom field removes its values from all tickets. (See 3.13.)

16.15. **SLA configuration** — A section to define SLA policies (see section 17 for details). In addition to SLA policy definitions, this section includes a global **SLA approaching threshold** setting — a percentage value that determines when a ticket is considered "approaching" its SLA target. Default: **75%**. Minimum: 50%, maximum: 95%. This threshold is used for both the visual SLA indicator (17.4) and approaching-breach notifications (17.5).

16.16. **User management** — A section to view and manage all users in the system. The section shows a paginated list of all registered users. The admin can filter users by role (User, Agent, Admin), by status (active, blocked, deleted), and search by email or display name (partial match). From the user list, the admin can: **block** a user (see section 22), **unblock** a previously blocked user, and **delete** a user’s account (with a confirmation prompt; the same anonymization rules as self-deletion in 20.4 apply). Clicking a user row shows their details (email, display name, role, team, account creation date, block status). The admin can also navigate to the ticket list filtered by that user.

16.17. **Merge ticket template** — A section to edit the Markdown template used for the system-generated post when a ticket is merged into another. The template supports a `{{ticketId}}` placeholder. A "Reset to default" button restores the built-in template. The default template is: *"This ticket has been merged into [#{{ticketId}}](link)."* (See 9.6.)

16.18. **Knowledge base categories** — A section to manage knowledge base categories: create, rename, reorder, and delete categories. Article management is **not** in the Admin Setup page — it is in the dedicated Knowledge Base Management page accessible to agents (see 19.5). (See 19.3.)

16.19. **CSAT settings** — A section to configure customer satisfaction surveys: (1) **Enable CSAT surveys** — a toggle to enable or disable automatic CSAT survey emails (disabled by default). The toggle is disabled with a warning message until outbound email is configured and verified (see 14.4 / 16.7). (2) **Survey delay** — how long after ticket closure the survey email is sent (default: 1 hour; options: immediately, 1 hour, 4 hours, 24 hours). If a closed ticket is re-opened before the delay elapses, the survey email is cancelled. If a ticket is closed again after being re-opened, a new CSAT survey email is sent **only if no rating has been submitted yet** for this ticket; if the user has already rated the ticket, no additional survey email is sent (the existing rating is preserved and editable via the token reissue mechanism, see 3.10). The rating scale is always 1–5 stars. (See 3.10.)

16.20. **AI configuration** — A section to configure AI features. The section has two parts:
**Connection settings:**
- **AI Provider** — a dropdown to select the AI provider: OpenAI, Anthropic, or Custom (OpenAI-compatible endpoint). Default: none (unconfigured).
- **API Key** — a password field for the provider's API key. Stored encrypted at rest using **Supabase Vault** (pgsodium Transparent Column Encryption). The decrypted value is accessible only to server-side code via Supabase's `vault.decrypted_secrets` view and is never exposed to the client. A "Test connection" button verifies the key and shows a success/error message.
- **Custom endpoint URL** — a text field shown only when "Custom" is selected as the provider.
- **Model** — a dropdown populated with available models from the selected provider (auto-fetched after the API key is verified). The admin selects one model used by all AI features. If the model list cannot be auto-fetched (e.g., the custom endpoint does not support model listing), the dropdown is replaced with a freeform text field where the admin enters the model name manually.
- **Request timeout** — the maximum time in seconds to wait for an AI response. Default: **60**. Minimum: 10, maximum: 300. Applies to all AI features.

**Feature toggles** (each feature can be independently enabled/disabled; all default to off; toggles are disabled until a valid API key is saved):
- **Auto-categorize tickets** — enables AI-suggested type, category, urgency, and tags on ticket creation. Includes a **"Minimum body length"** numeric setting (default: **20**, minimum: 10) that controls the minimum number of characters required in the ticket body before auto-categorization triggers. (See 23.1.)
- **Duplicate ticket detection** — enables similar-ticket suggestions on ticket creation. Includes a similarity threshold setting: Low, Medium (default), or High. (See 23.2.)
- **Suggested reply for agents** — enables the "Suggest reply" button on ticket detail pages. Includes a **"Context window"** numeric setting (default: **20**, minimum: 5, maximum: 50) that controls the maximum number of recent posts included in the AI prompt. (See 23.3.)
- **Ticket summary** — enables AI-generated summaries on long tickets. Includes a "Minimum post count" numeric setting (default: 10, minimum: 5). (See 23.4.)
- **Generate KB article from ticket** — enables the "Generate KB Article" button on closed tickets. (See 23.5.)

**AI rate limiting:**
- **Suggested reply rate limit** — Maximum number of "Suggest reply" requests per agent per hour. Default: **20**. Setting to **0** disables the limit. (See 23.3.)

**Usage counter** (read-only): shows total AI API calls and estimated token usage for the current calendar month, so the admin can monitor costs. No billing integration.

16.21. **Team management** — A section to manage teams. Admins can: create new teams (with a name), rename existing teams, delete teams (only if the team has no members), add users to a team by searching by email, and remove users from a team. A user can belong to at most one team; assigning a user to a different team removes them from their current team. The section shows a list of all teams with their member count, and clicking a team shows its members. (See 4.5.)

16.22. **Merge stub banner template** — A section to edit the Markdown template used for the banner displayed on merged (stub) tickets. The template supports a `{{ticketId}}` placeholder for the target ticket ID. A "Reset to default" button restores the built-in template. The default template is: *"This ticket has been merged into [#{{ticketId}}](link). Please continue the conversation there."* This is separate from the merge post template (16.17) — the post template is used for the system-generated post in the timeline, while the banner template is used for the prominent banner at the top of the stub page. (See 9.6.)

16.23. **Error page templates** — A section to configure the content displayed on error pages (404 Not Found, 403 Forbidden, 500 Internal Server Error, and CSAT Token Error). Each error page template has a Markdown body that supports the following placeholders: `{{statusCode}}` (the HTTP status code), `{{errorMessage}}` (a human-readable error description), `{{requestedUrl}}` (the URL the user attempted to access), `{{userDisplayName}}` (the current user's display name, if authenticated), and `{{supportEmail}}` (the configured reply-to address from inbound email settings, see 16.9). The CSAT Token Error template additionally supports `{{ticketId}}` (the ticket ID associated with the expired/invalid token, if available). All placeholder values — including `{{requestedUrl}}` — are sanitized before rendering. URLs are escaped to prevent injection attacks. The same Markdown sanitization pipeline used for user-supplied content (see Architecture Constraint 8) is applied to the rendered error page templates. Each template has a "Reset to default" button. Default templates include: a friendly message and a link to the home page (all pages); a search bar for tickets and knowledge base articles (404 page); a clear reason and link to the home page (403 page); a retry suggestion and contact support link (500 page); and a message such as *"This survey link has expired or has already been used"* with a link to the ticket if the user is authenticated (CSAT Token Error page). Error pages are server-rendered and respect the current authentication state — unauthenticated visitors see a minimal layout while authenticated users see the full navigation bar.

16.24. **Admin audit log** — The Admin Setup page includes an "Audit Log" section that records all administrative actions performed in the system. Each entry records: the admin who performed the action, the timestamp, the action type, and a description of the change (including old and new values where applicable). The following actions are logged: agent promotion and revocation (16.6), team creation, rename, deletion, and membership changes (16.21), ticket type creation, rename, deletion, and default changes (16.2), category creation, rename, and deletion (16.3), tag creation, rename, color change, and deletion (16.4), custom field creation, rename, reorder, and deletion (16.14), SLA policy creation, modification, deletion, and severity mapping changes (16.15), template edits and resets for duplicate, merge, merge banner, error page, and notification templates (16.5, 16.8, 16.17, 16.22, 16.23), ticket privacy settings changes (16.10), pagination settings changes (16.11), ticket creation rate limit changes (16.12), authentication provider configuration changes (16.13), email configuration changes (16.7, 16.9) — API keys and passwords are logged as "changed" without recording the actual values, CSAT settings changes (16.19), AI configuration changes (16.20) — API keys are logged as "changed" without recording the actual values, user management actions including blocking, unblocking, and account deletion (16.16 / 22.4), knowledge base category creation, rename, reorder, and deletion (16.18), knowledge base visibility changes (19.5), file upload settings changes (16.25), user settings defaults changes (16.26), logo and URL configuration changes (16.27), subscription tier definition creation, editing, deletion, tier assignment, tier removal, and external API shared secret changes (16.28 / 25.5 / 25.7), and notification coalescing delay changes (16.29). For external API tier assignments, the actor is recorded as "API" rather than an admin user. The audit log is displayed as a paginated, chronologically sorted list (newest first). It can be filtered by action type, admin, and date range. The audit log is read-only — entries cannot be edited or deleted. Audit log entries are retained indefinitely.

16.25. **File upload settings** — A section to configure file attachment rules: (1) **Allowed file types** — a list of allowed file extensions, editable by the admin. Each entry specifies the extension (e.g., `.png`) and the MIME type group it belongs to (image, document, or archive — for display purposes only). The admin can add or remove extensions. The default set includes: **Images**: PNG, JPG, JPEG, GIF, WebP, SVG; **Documents**: PDF, DOC, DOCX, XLS, XLSX, TXT, CSV, MD; **Archives**: ZIP, RAR, 7Z, TAR.GZ. A "Reset to defaults" button restores the built-in list. (2) **Maximum file size** — the maximum size per file in MB. Default: **10 MB**. Minimum: 1 MB, maximum: 50 MB. (3) **Maximum files per post** — the maximum number of file attachments per post/comment/note. Default: **5**. Minimum: 1, maximum: 20. File type validation is enforced both client-side (for immediate feedback) and server-side (in the Server Action and Supabase Storage policies). The server-side check validates both the file extension and the MIME type header to prevent extension spoofing. SVG files are sanitized on upload to strip embedded scripts and event handlers before storage.

16.26. **User settings defaults** — A section with system-wide user settings: (1) **Enforce display name uniqueness** — a toggle that controls whether display names must be unique across all users (disabled by default). When enabled, users attempting to set a display name that is already taken see a validation error. When disabled, duplicate display names are allowed. Display names remain identified internally by user ID regardless of this setting. (2) **Default notification preferences** — a table listing all notification event types with two toggle columns (email and in-app). The admin sets the system-wide default state (enabled/disabled) for each event type and channel. New user accounts inherit these defaults. Existing users are not affected when the admin changes the defaults — only new registrations use the updated values. Both channels default to enabled for all event types on initial system setup.

16.27. **Logo and URL configuration** — A section to configure the application logo and its link URL displayed in the navigation bar. The section has two settings: (1) **Logo image** — an image upload field that accepts PNG, JPG, JPEG, SVG, or WebP files. Maximum file size: **2 MB**. Maximum dimensions: **200×60 pixels** (images exceeding this are rejected with a validation error). The uploaded logo is stored in Supabase Storage. A preview of the current logo is displayed. A "Reset to default" button restores the built-in Help Desk logo. By default, a custom Help Desk logo is used. (2) **Logo link URL** — a URL field that specifies where the logo links to when clicked. Default: `/` (root website). The URL must be a valid absolute URL (starting with `http://` or `https://`) or a root-relative path (starting with `/`). Invalid URLs are rejected with a validation error. SVG logo files are sanitized on upload using the same pipeline as file attachments (see 16.25) to strip embedded scripts and event handlers.

16.28. **Subscription tiers management** — A section to manage subscription tier definitions and the external assignment API. The section has two parts: (1) **Tier definitions** — a list of all defined tiers showing key, display name, color, icon, capability overrides, and limit overrides. Admins can create, edit, reorder, and delete tiers from this list. The key is set at creation and displayed as read-only on the edit form. (See 25.1, 25.6.) (2) **External API settings** — a **shared secret** password field for authenticating external tier assignment requests. The secret is stored encrypted using Supabase Vault (same approach as AI API keys, see 16.20). A "Regenerate" button creates a new secret (with confirmation, since this invalidates the previous one). The current secret is shown masked with a "Copy" button. When no secret is configured, external tier assignment is unavailable. Changes to the shared secret are recorded in the admin audit log as "changed" without recording the actual value. (See 25.7.)

16.29. **Notification coalescing delay** — A numeric setting that controls how long (in minutes) the system waits after an agent action on a ticket before sending email notifications to the ticket owner and followers. During the delay, additional agent actions on the same ticket reset the timer, and all changes are consolidated into a single email. Default: **2**. Minimum: **0** (disabled — notifications sent immediately, preserving legacy behavior). Maximum: **15**. Changes are recorded in the admin audit log. (See 14.6.)

#### 17. SLA (Service Level Agreements)

17.1. **SLA policies** — The admin can define SLA policies that set time-based targets for ticket response and resolution. Each SLA policy has a name and defines two targets: **first response time** (how quickly an agent must first reply) and **resolution time** (how quickly the ticket must be closed). Both targets are specified in business hours. Business hours are configured by the admin as part of SLA configuration (see 16.15): a weekly schedule specifying working days and working hours (e.g., Monday–Friday, 9:00–17:00), and a timezone. Hours outside this schedule do not count toward SLA targets. There is no holiday calendar in this version.

17.2. **SLA assignment** — SLA policies are assigned based on ticket severity. The admin maps each severity level to an SLA policy (e.g., Critical → 1h response / 4h resolution, Low → 24h response / 72h resolution). A ticket's SLA is determined by its current severity level and updates automatically if the severity changes. Since severity defaults to **Medium**, all new tickets are immediately evaluated against the SLA policy mapped to Medium (if one exists). If no SLA policy is mapped to a severity level, no SLA targets apply to tickets with that severity.

17.3. **SLA timers** — The system tracks elapsed time against SLA targets. The first-response timer starts when the ticket is created. Since severity defaults to Medium, SLA tracking begins immediately for tickets whose severity level has a mapped SLA policy. If an agent later changes the severity, the new SLA targets apply retroactively against the already-elapsed time, incentivizing fast triage. The resolution timer starts when the ticket enters **open** status. Both timers **pause** when the ticket is in **pending** status (waiting on customer) and resume when it returns to **open**. The first-response timer stops when the first agent reply is posted; the resolution timer stops when the ticket is closed. When a closed ticket is re-opened, the resolution timer **resumes** from its previously accumulated elapsed time — it does not reset. This prevents gaming SLA metrics by closing and re-opening tickets.

17.4. **SLA indicators** — On the ticket detail page and agent dashboard, SLA status is shown as a visual indicator: **on track** (green), **approaching** (yellow, elapsed time has reached the configured approaching threshold — see 16.15; default 75% — of the target), or **breached** (red, target exceeded). The agent dashboard can be sorted by SLA risk so the most at-risk tickets appear first.

17.5. **SLA breach notifications** — When an SLA target is breached, a notification is sent to the assigned agent (if any) and to all admins. When an SLA target is approaching (i.e., elapsed time has reached the configured approaching threshold — see 16.15; default 75%), a warning notification is sent to the assigned agent (if any) and to all admins. This ensures admins have early warning on all tickets — including unassigned ones — before a breach occurs. These notifications use configurable templates (see 16.8).

#### 18. Reporting & Analytics

18.1. **Reporting dashboard access** — Admins and agents see a "Reports" link in the navigation bar. Agents have **read-only** access to the reporting dashboard, filtered to their own data: they can view their own performance metrics (tickets assigned, resolved, response times, CSAT ratings, SLA compliance) across all time periods and with trend charts, but cannot see other agents' individual metrics or system-wide aggregates. Admins have full access to all reports and all agents' data. Regular users do not see the link and are redirected away if they try to access the URL directly.

18.2. **Ticket volume** — A chart showing the number of tickets created over time (daily, weekly, or monthly, selectable). Filterable by status, severity, type, and category.

18.3. **Resolution metrics** — Average time to first response, average time to resolution, and median resolution time. Displayed for a selected time period with comparison to the previous period. Broken down by severity level.

18.4. **Agent performance** — A table showing per-agent metrics: number of tickets assigned, number of tickets resolved (closed), average response time, average resolution time, and average CSAT rating. Sortable by any column. Filterable by time period.

18.5. **CSAT summary** — Average CSAT rating and distribution (bar chart of 1–5 star ratings) for a selected time period. Trend chart showing CSAT over time.

18.6. **SLA compliance** — Percentage of tickets that met SLA targets (first response and resolution) for a selected time period, broken down by severity. A list of breached tickets with links.

18.7. **Backlog overview** — Current count of open and pending tickets, broken down by severity and assigned/unassigned. Trend chart showing backlog size over time.

18.8. **Export** — All report data can be exported as CSV for external analysis.

#### 19. Knowledge Base / FAQ

19.1. **Knowledge base access** — The knowledge base is a public-facing section accessible from the navigation bar via a "Help Center" link. It is accessible to all visitors (both authenticated and unauthenticated), regardless of the ticket public access setting (16.10), **only when the knowledge base is enabled** (see 19.5). When disabled, the "Help Center" link is hidden from the navigation bar and direct URL access to `/help` returns 404. The knowledge base is separate from the ticket system.

19.2. **Articles** — The knowledge base consists of articles organized into categories. Each article has a title, a body (Markdown text), a category, an original author (the agent who created it), a last editor (the agent who last modified it), a last-edited timestamp, and one of three statuses:

| Status | Visible in Help Center listings & search | Accessible via direct URL | Indexed by search engines | Appears in suggested articles (19.6) |
|---|:---:|:---:|:---:|:---:|
| **Draft** | No | No (agents only) | No | No |
| **Published** | Yes | Yes | Yes | Yes |
| **Archived** | No | Yes (with an "This article may be outdated" banner) | Yes | No |

New articles start as **Draft**. Agents can transition between all three statuses in any direction. Archived articles are hidden from category listings, help center search, and suggested articles, but remain accessible via their direct URL so existing links, bookmarks, and search engine results continue to work.

Article edits overwrite the previous content. No edit history or version tracking is maintained in this version. The last-edited timestamp and last editor are recorded for reference.

Articles have SEO-friendly URLs in the format `/help/{id}/{category-slug}/{article-slug}`, where `{id}` is the immutable numeric article ID and is the authoritative identifier. If the category slug or article slug in the URL doesn't match the current values (e.g., after a rename or re-categorization), the server issues a **307 Temporary Redirect** to the correct URL (temporary because the title or category may change again). This ensures stable, shareable links even if the article title or category changes. The help center article page displays "Last updated on {date}" below the article body. The article management page (19.5) shows both the original author and last editor in the article list.

19.3. **Article categories** — Knowledge base categories are separate from ticket categories. Each category has a name and a display order. The help center landing page lists all categories with their published article count.

19.4. **Search** — A search field on the help center page lets users search articles by title and body content (partial match). Search results are paginated.

19.5. **Article management** — Agents can create, edit, change status (draft / published / archived), and delete knowledge base articles. Only admins can manage knowledge base categories (create, rename, reorder, delete) from the Admin Setup page (see 16.18). Article management is done from a dedicated **Knowledge Base Management** page (e.g., `/kb/manage`), accessible to agents via a "Manage Articles" link in the navigation bar (visible only to agents). This page is separate from the Admin Setup page and does not require admin privileges. The page includes a **"Knowledge base visible to public"** checkbox at the top. The checkbox is **visible to all agents** but **editable only by admins** — agents see the current state as a read-only indicator. When disabled (default), the help center is hidden from the navigation bar and inaccessible to end users; agents can still access the management page to prepare articles. When enabled, the "Help Center" link appears in the navigation bar for everyone (see 19.1). Changes to this setting are recorded in the admin audit log (see 16.24).

19.6. **Suggested articles and similar tickets** — When a user starts typing a ticket title in the creation form, the system searches published knowledge base articles and displays up to 5 matching article links below the title field. Draft and archived articles are excluded from suggestions. If AI-powered duplicate detection is enabled (see 23.2), up to 3 similar open/pending tickets are also displayed in a separate "Similar open tickets" section below the KB suggestions. This encourages self-service and reduces duplicate submissions.

19.7. **Article feedback** — Each published article displays a **"Was this helpful?"** prompt at the bottom with thumbs-up and thumbs-down buttons. Authenticated users can vote once per article; clicking the opposite button changes the vote. Unauthenticated visitors cannot vote. The vote counts (helpful / not helpful) are stored per article and displayed to agents on the article management page (19.5) as a sortable "Helpfulness" column, helping them identify articles that need improvement. Vote counts are not shown publicly to end users.

19.8. **Create a ticket from an article** — Below the feedback prompt, a **"Still need help? Create a ticket"** link is displayed for authenticated users only. Unauthenticated visitors do not see this link. Clicking it navigates to the ticket creation form with the title pre-filled as "Question about: {article title}" and the source article ID stored as ticket metadata (visible to agents in the ticket detail sidebar as a clickable link to the article). The user can edit the pre-filled title and body before submitting. This ensures every question about an article is tracked through the standard ticket workflow.

#### 20. User Profile

20.1. **Profile page** — Each logged-in user can access their profile page via a link in the navigation bar user menu. The profile page shows the user's email, role, team (if any), subscription tier (if any, with display name and expiration date — see 25.4), and account creation date.

20.2. **Change password** — The profile page includes a "Change password" form with fields for current password and new password (with confirmation). This form is shown only for users who authenticated via email/password in built-in mode. In **external mode**, the section is hidden entirely. In **built-in mode**, users who signed up via a social OAuth provider (Google, GitHub, etc.) see a message instead: *"Your account uses {Provider} sign-in. To set a password, use the 'Forgot password?' flow on the login page."*

20.3. **Display name** — Users can set an optional display name on their profile. If the admin has enabled display name uniqueness enforcement (see 16.26), display names must be unique across all users; attempting to set a display name that is already taken shows a validation error (e.g., "This display name is already in use. Please choose a different one."). When uniqueness is not enforced, duplicate display names are allowed. The display name is shown instead of the email address throughout the application: in posts, comments, ticket lists, activity log entries, and ticket detail pages. The display name pattern "Deleted User #" is reserved by the system (see 20.4) — users cannot set a display name that starts with this prefix, regardless of whether uniqueness enforcement is enabled. If no display name is set, a placeholder (e.g., "User #123" or a truncated email hash) is shown — other users' raw email addresses are never displayed in ticket-facing UI. A user can always see their own email address in the navigation bar and on their profile page. Email addresses are shown only on profile pages (see 20.1, 20.5) for identification purposes.

20.4. **Delete account** — The profile page includes a "Delete my account" button. Clicking it shows a confirmation prompt warning that the action is irreversible. Upon confirmation, the user's account is deactivated: their email and display name are anonymized (replaced with "Deleted User #ID"), their password and auth credentials are invalidated (they can no longer log in), and their notification preferences and team membership are removed. The user's existing tickets, posts, comments, activity log entries, and user notes about them are preserved with the anonymized display name for audit and support continuity. Ticket ownership is not transferred. Agents and admins cannot delete their own accounts — they must first be demoted to a regular user by another admin. This prevents the last admin from accidentally locking out the system (see also 16.6). An admin can also initiate account deletion for any regular user from the Admin Setup page (see 16.16, User management). Account deletion events are recorded in the admin audit log.

20.5. **Agent-viewable user profile** — Agents can view any user's profile page at `/admin/users/{userId}`. The page shows the user's display name, email, role, team (if any), subscription tier (if any, with display name, key, and expiration date — see 25.4), account creation date, block status, ticket count, and the "User Notes" section (see 24.3). Admins also see a tier assignment form (tier dropdown + expiration date picker) allowing them to assign or change the user's tier directly from this page (see 25.5). A link to this page is available from the user's display name in tickets, posts, comments, and the agent dashboard (see 24.5). Regular users cannot access other users' profile pages — they are redirected away if they try to access the URL directly.

#### 21. Real-Time Updates

21.1. **Live ticket updates** — The ticket detail page subscribes to Supabase Realtime channels for the current ticket. When another user adds a post, comment, or note, changes the ticket status, or modifies ticket metadata, the page updates automatically without requiring a manual refresh. New posts appear at the bottom of the timeline with a subtle animation. Real-time updates are available only to authenticated users. Unauthenticated visitors (when public access is enabled, see 16.10) see a static server-rendered page without real-time updates.

21.2. **Live dashboard updates** — The agent dashboard subscribes to Supabase Realtime for ticket changes. New tickets, status changes, and assignment changes are reflected in the list in real time. The result count updates accordingly.

21.3. **Optimistic updates are not required** — Given the server-rendered architecture, real-time updates are delivered via Supabase Realtime subscriptions in a minimal client-side listener that triggers a page data refresh. See architecture constraint 2 for the full list of permitted `"use client"` components.

#### 22. User Blocking

22.1. **Block a user** — An admin can block a user from the Admin Setup page (see 16.16, User management) or from the ticket detail page (via a "Block user" action in the submitter info area). Blocking a user prevents them from creating new tickets, posting replies, commenting, and editing existing posts or comments. Existing tickets and posts by the blocked user remain visible. The blocked user can still log in and view their existing tickets but sees a banner explaining their account is restricted. Blocked users retain their existing ticket follows but do not receive email or in-app notifications for followed tickets while blocked. They cannot follow or unfollow tickets while blocked. When unblocked, notifications resume for all existing follows.

22.2. **Unblock a user** — An admin can unblock a previously blocked user, restoring their full capabilities.

22.3. **Block indicator** — In the agent dashboard and ticket detail pages, blocked users are marked with a visual indicator (e.g., a red "Blocked" badge next to their display name). This helps agents identify restricted accounts.

22.4. **Block log** — Blocking and unblocking events are recorded in the admin audit log (see 16.24). The log shows who was blocked/unblocked, by which admin, and when.

#### 23. AI Features

All AI features require a configured AI provider and API key (see 16.20). Each feature can be individually enabled or disabled by the admin. When AI is not configured or a feature is disabled, the corresponding UI elements are hidden. All AI calls are executed server-side via Server Actions — no client-side AI SDK is used. All AI API calls are subject to a configurable timeout (see 16.20; default: **60 seconds**). If the AI provider does not respond within the timeout, the request is aborted. Each feature handles timeouts gracefully: auto-categorization (23.1) silently falls back to default values; duplicate detection (23.2) shows no suggestions; suggested reply (23.3) shows an error message with a retry option; ticket summary (23.4) shows a "Summary unavailable" message with a retry button; KB article generation (23.5) shows an error message with a retry option.

23.1. **Auto-categorization** — When a user submits a ticket, the system analyzes the title and body using the configured AI model and suggests values for type, urgency, tags, and category (category is included only if at least one category is defined; otherwise the category suggestion is skipped). Suggestions are shown as pre-filled values on the ticket creation form after the user fills in the title and body. AI suggestions only pre-fill fields that are still at their default or unset values — if the user has already manually changed a field (e.g., selected a specific type or urgency), the AI does not override that choice. The user can accept, change, or ignore any suggestion before submitting. Auto-categorization runs automatically once when the user moves focus out of the body field, provided the body contains at least the configured minimum number of characters (default: **20**, configurable in 16.20). If the body is shorter than the minimum, auto-categorization does not trigger. A **"Re-suggest"** button is displayed next to the AI-suggested fields, allowing the user to manually re-trigger auto-categorization after editing the title or body (the minimum character requirement also applies to re-suggest). Clicking "Re-suggest" replaces the current suggestions with fresh ones from the AI model. If the AI call fails or times out, the form uses the standard defaults silently.

23.2. **Duplicate ticket detection** — When a user types a ticket title in the creation form, the system searches existing open and pending tickets for potential duplicates using AI-powered semantic similarity. Up to 3 similar tickets are displayed as "Similar open tickets" links below the title field, alongside the KB article suggestions (see 19.6). Each link shows the ticket title, status, and creation date. This reduces duplicate ticket volume before it reaches agents. The similarity threshold is configurable by the admin (see 16.20). If no similar tickets are found or AI is unavailable, nothing is shown.

23.3. **Suggested reply** — On the ticket detail page, agents see a "Suggest reply" button next to the reply text area. Clicking it sends the ticket context (title, posts, comments, and any related KB articles) to the AI model, which generates a draft response. The suggested text is inserted into the reply text area — the agent can review, edit, and post it. The AI never sends a reply automatically. If the ticket has a long history, only the most recent posts (up to the configured context window, see 16.20) are included in the prompt. The button shows a loading indicator while the AI processes. If the AI call fails, the agent sees an error message and can retry or write a manual reply. To control costs, AI suggested reply usage is rate-limited to **20 requests per agent per hour**. When the limit is reached, the "Suggest reply" button is disabled with a message indicating when it will be available again. The rate limit is configurable by the admin (see 16.20).

23.4. **Ticket summary** — For tickets with 10 or more posts (configurable, see 16.20), a collapsible AI-generated summary is shown at the top of the ticket detail page, below the ticket metadata and above the timeline. The summary provides a concise overview of the problem, key discussion points, and current status. It is generated on demand when the ticket detail page is loaded and the post threshold is met. The summary is cached and refreshed when new posts are added. It is visible to agents only. A "Refresh summary" button lets the agent regenerate the summary.

23.5. **Generate KB article from ticket** — On closed tickets, agents see a "Generate KB Article" button in the ticket actions area. Clicking it sends the full ticket thread (all posts and comments) to the AI model, which generates: a suggested article title, a suggested KB category (from existing categories, or "Uncategorized" if none fits), and an article body in Markdown summarizing the problem and solution. Any personally identifiable information (names, emails, account numbers) is stripped from the generated body. A reference link to the source ticket is stored as article metadata (visible to agents on the article management page and the article editing page, not shown in the public article). The article is created in **draft** status with the current agent as the author. After creation, the agent is redirected to the article editing page where they can review, edit, assign a category, and publish.

#### 24. User Notes

24.1. **User notes** — Agents can attach internal notes to any user account. User notes are visible only to agents and are used to record persistent context about a customer that spans across tickets (e.g., "VIP customer", "requires follow-up on billing", "prefers email communication"). Each note stores: author (the agent who created it), creation date, last-edited date, and body (Markdown text). User notes are not tied to any specific ticket — they live on the user's profile.

24.2. **CRUD rules** — Any agent can add a note to any user. An agent can edit and delete only their own user notes. Admins can delete any user note. Editing a user note updates the last-edited timestamp and shows an "(edited)" indicator. User notes support the same Markdown preview as ticket posts (see 3.12). User notes do not trigger any notifications to the user they are about — they are strictly internal agent tools. User note creation, editing, and deletion are recorded in the admin audit log (see 16.24).

24.3. **User notes on the user profile** — When an agent views a user's profile page (see 20.5), a "User Notes" section is displayed below the standard profile information. The section lists all notes on that user in reverse chronological order, with the author's display name and timestamp. An "Add note" button allows the agent to create a new note inline. Each note the agent authored shows "Edit" and "Delete" actions. Notes authored by other agents show the author's display name but no edit/delete actions (except for admins, who see "Delete" on all notes).

24.4. **User notes tab on ticket detail** — On the ticket detail page, if the ticket's submitter has at least one user note, an additional **"User Notes"** tab is shown in the ticket metadata/sidebar area, visible only to agents. The tab shows a badge with the note count. Clicking it displays all user notes for that user in reverse chronological order (read-only in this view). An "Open profile" link at the top navigates to the user's profile page (see 20.5) for adding or editing notes. If the submitter has no user notes, the tab is hidden.

24.5. **Profile link on display names** — For agents, user display names throughout the application — including the submitter name on the ticket detail page, the author name on posts, comments, and the submitter column in the agent dashboard — are rendered as clickable links to that user's profile page (`/admin/users/{userId}`, see 20.5). For non-agent users, display names remain plain text. This gives agents one-click access to user context and notes from any ticket interaction.

24.6. **Account deletion** — When a user's account is deleted (see 20.4), their user notes are preserved with the anonymized display name ("Deleted User #ID") for audit continuity. The notes remain visible to agents on the anonymized profile.

#### 25. Subscription Tiers

25.1. **Subscription tiers** — Users can be assigned a **subscription tier** that reflects their product or license status (e.g., "Licensed", "Pro", "Enterprise", "License Expired"). Each tier has two names: a **key** (immutable internal identifier) and a **display name** (public label shown in the UI). The tier also has a **color** and an optional **icon** (emoji). The key is set once at creation time and cannot be changed afterward; it is used in RLS policies, the external assignment API (25.7), and the admin audit log. The display name can be renamed freely by the admin without affecting integrations or historical records. The system ships with no default tiers. When no tiers are defined, all tier-related UI is hidden throughout the application (same pattern as tags, see 7.1). A user has at most **one** active tier at a time. Each tier assignment has an optional **expiration date** (`expires_at`). If set, the tier automatically becomes inactive when the date passes; the user is then treated as having no tier. If empty, the tier does not expire. Tier expiration is evaluated at query time — no cron job is needed.

**Key validation rules:** must be unique; 1–50 characters; lowercase letters, digits, and hyphens only (`^[a-z0-9](-?[a-z0-9])*$`); set by the admin at creation time (not auto-generated from the display name).

25.2. **Tier capability overrides** — Each tier defines a set of **capability overrides**: permissions that are normally restricted to agents but are selectively granted to users with that tier on **their own tickets only**. The admin configures which overrides are enabled per tier. The available capability overrides are:

| Override | What it unlocks (own tickets only) | Default restriction (section) |
|---|---|---|
| **Change ticket visibility** | Owner can toggle their ticket between public and private | Agents only (3.6) |
| **Set/change severity** | Owner can set severity on their own tickets | Agents only (2) |
| **Change ticket status** | Owner can manually set open / pending / closed on their own tickets | Agents only (9.1) |
| **Change ticket type** | Owner can change the type after creation | Agents only (5.1) |
| **Add/remove tags** | Owner can manage tags on their own tickets | Agents only (7.2) |

Capability overrides **never** grant agent-dashboard access, bulk actions, admin functions, or any ability to modify other users' tickets. They are strictly a scoped expansion of what a user can do on tickets they own. Agents and admins retain full capabilities regardless of their tier.

25.3. **Per-tier limits** — In addition to capability overrides, each tier can define custom values for the following system limits. When set, the tier value overrides the global default for users with that tier. When not set (null), the global default applies.

| Limit | Global default | Override per tier |
|---|---|---|
| Ticket creation rate limit (24h window) | 10 (see 16.12) | Custom value |
| Max file size per attachment | 10 MB (see 16.25) | Custom value (within the global max of 50 MB) |
| Max files per post | 5 (see 16.25) | Custom value (within the global max of 20) |

25.4. **Tier display** — The user's active tier is displayed as a **colored pill** (similar to status badges) next to their display name in the following locations: ticket detail page (submitter name and post/comment author names), agent dashboard (submitter column), and user profile page (20.1, 20.5). If the tier has an icon, it is shown inside the pill before the display name. Expired tiers are not displayed. On the user's own profile page (20.1), the tier display name and expiration date (if set) are shown in the profile info section. If the tier has expired, the profile shows "Expired on {date}" in a muted style. Users without a tier show no pill — the display name appears as normal.

25.5. **Tier assignment** — Admins assign a tier to a user from the user management section of the Admin Setup page (16.16) or from the agent-viewable user profile page (20.5). The assignment form has two fields: a **tier dropdown** (listing all defined tiers by display name, plus "None") and an optional **expiration date** picker. Changing a user's tier takes effect immediately. Removing a tier (setting to "None") immediately revokes all capability overrides. Tier assignment and removal are recorded in the admin audit log (16.24), using the tier key for unambiguous identification.

25.6. **Manage tiers (admin)** — A **"Subscription Tiers"** section on the Admin Setup page (sidebar navigation, same pattern as 16.1). The section allows admins to: **create** a new tier (key, display name, color, icon, capability overrides checklist, optional limit overrides), **edit** an existing tier (display name, color, icon, capability overrides, limit overrides — the key is shown as a read-only field and cannot be changed), **reorder** tiers (for display ordering in dropdowns and pills), and **delete** a tier. Deleting a tier that is currently assigned to users is allowed — affected users immediately lose that tier and revert to having no tier (the assignment is removed, not preserved with a dangling reference). A confirmation prompt warns: *"This tier is assigned to N user(s). Removing it will revoke their tier capabilities immediately."* Tier definition changes (create, edit, delete) are recorded in the admin audit log (16.24). (See also 16.28.)

25.7. **External tier assignment** — To support integration with external billing or licensing systems, tier assignment can also be performed via a **Next.js Server Action** authenticated with a configurable **shared secret** (API key). The admin configures the shared secret from the Subscription Tiers admin section (16.28). The secret is stored encrypted using Supabase Vault (same approach as AI API keys, see 16.20). The Server Action accepts: user email, tier key (or `"none"` to remove), and optional expiration date. This allows external systems (e.g., a payment provider webhook handler, a license server) to keep user tiers in sync without manual admin intervention. Invalid emails, unknown tier keys, or incorrect secrets return an error. Successful external assignments are recorded in the admin audit log with the actor shown as "API". The external API **cannot** create, edit, or delete tier definitions — it can only assign or remove existing tiers on users. Tier definitions must always be created by an admin through the Admin Setup UI.

25.8. **Interaction with existing permissions** — Tier capability overrides follow the **role inheritance** principle established in the spec: Admin > Agent > Tiered User > User. Specifically:
- RLS policies that currently check `is_agent()` for the overridden capabilities are extended to also allow the operation when the user is the ticket owner **and** has an active (non-expired) tier with the corresponding override enabled. A Postgres helper function `user_has_tier_capability(capability text)` encapsulates the check (tier assignment, expiration, and override lookup) and is used in RLS policies alongside `is_agent()`.
- If a user's tier expires while they are viewing a ticket, their next action that requires an override is rejected with a standard permission error. No special "tier expired" error message is shown — the UI simply does not render controls the user no longer has access to on the next page load.
- Blocked users (section 22) cannot exercise tier capabilities regardless of their tier — the block takes precedence.

25.9. **Tier on the agent dashboard** — When at least one tier is defined, the agent dashboard (8.2) shows the submitter's tier pill in the ticket row (next to the display name). A **"Filter by tier"** dropdown is added to the dashboard filters (same URL-based pattern as 8.10). Options include "All", "No tier", and each defined tier's display name. This lets agents prioritize tickets from high-value customers.

25.10. **Reporting** — The reporting dashboard (section 18) includes tier as an available filter dimension on ticket volume (18.2), resolution metrics (18.3), and CSAT summary (18.5) charts. This allows admins to compare support metrics across subscription tiers.

25.11. **Account deletion** — When a user's account is deleted (see 20.4), their tier assignment is removed. The admin audit log retains the historical tier assignment records using the tier key for traceability.

---
