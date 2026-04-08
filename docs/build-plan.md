# HelpDesk — Build Plan

## Principles

- **Small steps**: Each phase is a self-contained unit that can be built and tested independently.
- **Prompt-driven**: Each phase has a corresponding prompt file in `/promts/` that you feed to an AI agent.
- **Test-first mindset**: Every phase includes test specifications. Database tests run against Supabase, UI tests use Playwright, all wired into CI.
- **Modular architecture**: Feature code is organized into isolated modules under `src/` — shared utilities, per-feature folders, and clear boundaries.

## Folder Structure (Target)

```
├── .github/workflows/       # CI pipelines
├── docs/                     # Specifications
├── promts/                   # AI prompts for each phase
├── supabase/
│   ├── migrations/           # SQL migrations (one per phase)
│   ├── seed.sql              # Seed data
│   └── config.toml           # Supabase local config
├── src/
│   ├── app/                  # Next.js App Router pages
│   │   ├── (auth)/           # Auth pages (login, signup, forgot-password)
│   │   ├── (main)/           # Authenticated layout
│   │   │   ├── tickets/      # Ticket pages
│   │   │   ├── admin/        # Admin setup pages
│   │   │   ├── agent/        # Agent dashboard
│   │   │   ├── kb/           # Knowledge base management
│   │   │   ├── help/         # Public help center
│   │   │   ├── reports/      # Reporting dashboard
│   │   │   ├── notifications/# Notifications page
│   │   │   └── profile/      # User profile
│   │   ├── api/              # API routes (if needed for webhooks)
│   │   ├── layout.tsx
│   │   └── page.tsx
│   ├── lib/
│   │   ├── supabase/         # Supabase client helpers (server, client, middleware)
│   │   ├── actions/          # Server Actions organized by feature
│   │   ├── utils/            # Shared utilities (markdown, slugify, validation)
│   │   └── types/            # TypeScript types (generated from DB + manual)
│   ├── components/
│   │   ├── ui/               # Reusable UI primitives (Badge, Button, Card, etc.)
│   │   ├── layout/           # NavBar, Sidebar, Footer
│   │   └── features/         # Feature-specific components
│   └── middleware.ts          # Auth session refresh
├── tests/
│   ├── db/                   # Database/RLS tests (vitest + supabase-js)
│   ├── e2e/                  # Playwright end-to-end tests
│   └── helpers/              # Test utilities and fixtures
├── playwright.config.ts
├── vitest.config.ts
└── package.json
```

---

## Phases

### Phase 0 — Project Initialization & CI
**Prompt**: `promts/00-project-init.md`
- Initialize Next.js 15 (App Router) with TypeScript & Tailwind CSS
- Initialize Supabase local project (`supabase init`)
- Install dependencies: `@supabase/supabase-js`, `@supabase/ssr`, `vitest`, `@playwright/test`
- Configure Geist font
- Create base layout with placeholder nav bar
- Set up CI pipeline (GitHub Actions): lint, type-check, db tests, e2e tests
- Set up Supabase local dev environment for tests
- Verify: `npm run dev` works, `supabase start` works, CI runs green

### Phase 1 — Database Schema (Core Tables)
**Prompt**: `promts/01-database-core.md`
- Create migration: profiles, tickets, posts, comments, notes tables
- Create helper functions: `get_user_role()`, `is_agent()`, `is_admin()`, `is_teammate()`
- Enable RLS on all tables with basic policies
- Create `agent_tickets` VIEW
- Write database tests for: table creation, RLS policies (user/agent/admin access)
- **No UI in this phase** — purely database + tests

### Phase 2 — Authentication
**Prompt**: `promts/02-authentication.md`
- Supabase middleware for session refresh (`@supabase/ssr`)
- Sign up page (email/password, built-in mode)
- Login page (email/password, built-in mode)
- Sign out action
- Forgot password flow
- Profile trigger: auto-create profile on auth.users insert
- Login rate limiting (login_attempts table + Server Action check)
- Protected route handling (redirect unauthenticated users)
- Write Playwright tests: signup, login, logout, forgot password, rate limiting
- Write DB tests: login_attempts table, profile trigger

### Phase 3 — Ticket CRUD (User Side)
**Prompt**: `promts/03-tickets-user.md`
- Create ticket form (title, body, urgency, type, privacy)
- My Tickets list (paginated, status filter, search)
- Ticket detail page (title, status badges, metadata, posts timeline)
- Reply to ticket (new post)
- SEO-friendly URLs with slug redirect
- Empty state for no tickets
- Write Playwright tests: create ticket, view list, view detail, reply, search
- Write DB tests: ticket RLS (user sees own, agent sees all, etc.)

### Phase 4 — Agent Dashboard (Basic)
**Prompt**: `promts/04-agent-dashboard.md`
- Agent dashboard page (all tickets, paginated)
- Status/urgency/severity filter toggles
- Search by title/content, filter by submitter
- Sort by last-modified / created
- Agent actions: change status, assign/unassign/reassign (with reason note)
- Saved views (8.13): save/load/rename/delete named filter combos
- Agent personal stats panel (8.16): "My Stats" collapsible panel (assigned, resolved, avg response/resolution time, CSAT, SLA compliance for last 30 days)
- Write Playwright tests: dashboard access (agent vs user), filters, assign, saved views
- Write DB tests: agent_tickets VIEW, agent RLS policies
- **Note:** Later phases extend this dashboard: tag filter (Phase 5), SLA sort (Phase 13), bulk actions (Phase 17), tier filter (Phase 20)

### Phase 5 — Teams, Types, Categories, Tags
**Prompt**: `promts/05-teams-types-categories-tags.md`
- Teams: DB tables, team tickets view, teammate visibility
- Team management admin UI (16.21): create/rename/delete teams, add/remove members by email search
- Ticket types: management CRUD, default type
- Categories: management CRUD, optional category on tickets
- Tags: management CRUD, colored pills, tag filter on agent dashboard
- **Seed data**: 3 categories, 5 tags per `docs/seed-data.md`
- Write tests for each sub-feature

### Phase 6 — Posts, Comments & Notes
**Prompt**: `promts/06-posts-comments-notes.md`
- Comments on posts (2-level nesting)
- Internal notes (agent-only)
- Post editing with "(edited)" indicator
- Ticket title editing with slug update
- Markdown rendering & sanitization (server-side)
- Markdown preview tab (client-side)
- Draft posts (agent-only, publish flow)
- Post/comment deletion rules
- Collapsible timeline (older posts/comments)
- Write tests for comment nesting, note visibility, drafts, markdown sanitization

### Phase 7 — Admin Setup (Core)
**Prompt**: `promts/07-admin-setup.md`
- Admin setup page with sidebar navigation (extensible — later phases add sections)
- Ticket types management section (16.2)
- Categories management section (16.3)
- Tags management section (16.4)
- Team management section (16.21, admin UI from Phase 5 moves into sidebar layout)
- Agent/admin management (16.6, promote/demote with last-admin guard)
- Ticket privacy settings (16.10)
- Pagination settings (16.11)
- Ticket creation rate limit setting (16.12)
- Custom fields management (16.14): define text/number/dropdown/checkbox/date fields with defaults
- User settings defaults (16.26): display name uniqueness toggle + default notification preferences
- Duplicate ticket template (16.5)
- Error page templates (16.23): configurable 404, 403, 500, CSAT token error templates with placeholders
- Logo and URL configuration (16.27)
- Admin audit log (16.24)
- Write Playwright tests: admin access, CRUD operations, audit log
- Write DB tests: admin-only RLS policies
- **Note:** Later phases add admin sections: file upload (Phase 8), email/notifications (Phase 9), CSAT (Phase 12), SLA (Phase 13), KB categories (Phase 14), auth modes (Phase 21), tiers (Phase 20), AI config (Phase 19), notification coalescing delay (Phase 9)

### Phase 8 — File Attachments
**Prompt**: `promts/08-file-attachments.md`
- Supabase Storage bucket setup
- Upload UI on posts/comments/notes
- File type/size validation (client + server)
- Image thumbnail preview, download links
- Storage RLS policies
- SVG sanitization
- Admin file upload settings section
- Write tests for upload, type validation, RLS

### Phase 9 — Email Notifications
**Prompt**: `promts/09-email-notifications.md`
- SMTP configuration (admin section 16.7)
- Notification templates (admin section 16.8) — only for events that exist at this point (new post, status change, assignment); later phases add their own templates (CSAT, SLA, merge, bulk, consolidated)
- Email sending via Server Actions
- User notification preferences (14.5) with admin-configurable defaults (16.26 part 2)
- Notification coalescing queue + cron job (14.6, 16.29)
- Notification coalescing delay admin setting (16.29)
- Write tests for template rendering, preference overrides
- **Note:** Each subsequent phase that introduces new notification events (12, 13, 17, 18) must add its own templates and triggers

### Phase 10 — Real-Time & In-App Notifications
**Prompt**: `promts/10-realtime-and-notifications.md`
- Supabase Realtime infrastructure: thin client-side wrappers triggering server refresh (architecture constraint 2/7)
- Realtime subscriptions on ticket detail page (live post/status updates)
- Realtime on agent dashboard (new tickets, status changes, assignments)
- Notifications table + RLS
- Bell icon with unread count badge (Realtime subscription for live updates — 14a.1, 14a.5)
- Notification dropdown panel (14a.2)
- Notifications page `/notifications` (paginated — 14a.3)
- Mark as read/unread, bulk "Mark all as read"
- Nav bar user dropdown menu (design doc): username dropdown with "Profile" and "Notification Settings" links
- Notification cleanup cron job (14a.6: read >30 days, all >90 days)
- Write Playwright tests: bell badge, dropdown, mark-as-read, real-time post appearance
- **Note:** Phase 11 number is now freed — phases after this are renumbered

### Phase 11 — CSAT (Customer Satisfaction)
**Prompt**: `promts/11-csat.md`
- CSAT rating page (token-based, no login required)
- Token generation, expiration, single-use + reissue
- Rating display on ticket detail + "Rate this ticket" / "Update rating" links
- CSAT survey email scheduling (pg_cron)
- Admin CSAT settings section (16.19)
- CSAT survey email template (added to admin notification templates)
- Write tests for token flow, rating submission, survey scheduling

### Phase 12 — SLA Policies
**Prompt**: `promts/12-sla.md`
- SLA tables: policies, severity mapping, timers, notifications_sent
- Business hours configuration
- SLA timer tracking (start, pause, resume, stop)
- SLA indicators on ticket detail & dashboard
- SLA breach/approaching notifications (pg_cron)
- SLA sort on agent dashboard (extending Phase 4)
- Admin SLA configuration section (16.15) + approaching threshold setting
- SLA notification templates (added to admin notification templates)
- **Seed data**: 1 SLA policy per `docs/seed-data.md`, override severity on 3 tickets
- Write tests for timer logic, breach detection, notifications

### Phase 13 — Knowledge Base
**Prompt**: `promts/13-knowledge-base.md`
- KB articles table (draft/published/archived)
- Help center public page with search
- Article detail page with SEO URLs
- Article management page (agents)
- KB categories management (admin section 16.18)
- Article feedback (helpful/not helpful)
- Suggested articles on ticket creation (19.6)
- "Create ticket from article" flow (19.8) with source_article_id
- Admin KB visibility toggle (19.5)
- Nav bar: "Help Center" link (conditional on KB enabled), "Manage Articles" link (agents)
- **Seed data**: 3 KB articles, 2 KB categories per `docs/seed-data.md`
- Write tests for article CRUD, search, visibility states

### Phase 14 — Reporting & Analytics
**Prompt**: `promts/14-reporting.md`
- Reporting dashboard page (client-side charts — architecture constraint 2c)
- Ticket volume chart (18.2) with status/severity/type/category filters
- Resolution metrics (18.3) with per-severity breakdown
- Agent performance table (18.4)
- CSAT summary chart (18.5)
- SLA compliance stats (18.6) with breached tickets list
- Backlog overview (18.7) with trend chart
- CSV export (18.8)
- Agent-scoped vs admin-scoped access (18.1)
- Nav bar: "Reports" link (agents/admins)
- Write tests for data accuracy, access control
- **Note:** Phase 20 (Tiers) adds tier as a filter dimension

### Phase 15 — User Profile & Account Management
**Prompt**: `promts/15-user-profile.md`
- Profile page (view/edit display name, change password)
- Display name uniqueness enforcement (when enabled in admin settings from Phase 7)
- Reserved display name prefix "Deleted User #" validation
- Account deletion (anonymization per 20.4)
- Agent-viewable user profile at `/admin/users/{userId}` (20.5)
- User notes (CRUD, visibility — 24.1–24.6)
- User notes tab on ticket detail (24.4)
- Profile links on display names for agents (24.5)
- Admin user management section (16.16): list users, filter by role/status, block/unblock/delete
- Block indicator on agent dashboard and ticket detail (22.3)
- Write tests for profile editing, deletion, user notes RLS, blocking

### Phase 16 — Canned Responses & Follow
**Prompt**: `promts/16-canned-responses-follow.md`
- Canned responses (10.1–10.3): CRUD, public/private visibility, searchable list page, insert into reply
- Nav bar: "Canned Responses" link (agents)
- Follow/unfollow tickets (3.11): toggle on detail page, followers list (agents), auto-follow on create
- Custom fields on tickets (3.13): display on detail page, editable by owner/agents, values in creation form
- **Seed data**: 2 canned responses, 1 custom field per `docs/seed-data.md`
- Write tests for canned responses CRUD, follow/unfollow, custom field display

### Phase 17 — Advanced Ticket Operations
**Prompt**: `promts/17-advanced-tickets.md`
- Mark as duplicate (9.4, with configurable template from Phase 7)
- Merge tickets (9.6, timeline consolidation, stub page, merge template from Phase 7)
- Merge/duplicate notification templates (added to admin notification templates)
- Bulk actions (8.15): close, assign, unassign, status, add/remove tags, severity, delete (admin-only)
- Bulk action notification templates
- Delete ticket (9.5, admin only, closed-ticket guard, dependency guards)
- Write tests for duplicate, merge, bulk actions, delete constraints

### Phase 18 — Inbound Email
**Prompt**: `promts/18-inbound-email.md`
- Inbound email configuration (admin section 16.9)
- Create ticket by email (15.2) with attachment handling
- Reply by email (15.3) with thread matching
- Unknown sender handling (15.4) with auto-reply
- Email signature stripping (15.6)
- Auto-reply rate limiting (15.5, 3 per recipient per hour)
- Blocked user email rejection
- Duplicate ticket email rejection
- Auto-reply templates (unknown sender, blocked user, duplicate, rate limit)
- Write tests for email parsing, ticket creation, rate limits, signature stripping

### Phase 19 — AI Features
**Prompt**: `promts/19-ai-features.md`
- AI provider configuration admin section (16.20): provider dropdown, API key (Supabase Vault), model selection, request timeout, feature toggles, usage counter
- Auto-categorization on ticket creation (23.1) with min body length + re-suggest
- Duplicate ticket detection (23.2, semantic similarity with configurable threshold)
- Suggested reply for agents (23.3) with context window setting + rate limit
- Ticket summary (23.4, agent-only, cached, refresh button)
- Generate KB article from ticket (23.5, PII stripping, draft status)
- All AI calls server-side via Server Actions, timeout handling per feature
- Write tests for feature toggles, timeout fallbacks, rate limits

### Phase 20 — Subscription Tiers
**Prompt**: `promts/20-subscription-tiers.md`
- Tier definitions admin section (16.28, 25.1, 25.6): key, display name, color, icon, capability overrides, limit overrides
- Tier assignment (25.5): admin UI on user profile + user management
- External tier assignment API (25.7): Server Action with shared secret (Supabase Vault)
- Capability overrides (25.2): `user_has_tier_capability()` Postgres function, RLS policy extensions
- Per-tier limits (25.3): rate limit, file size, files per post
- Tier display pills throughout UI (25.4): ticket detail, dashboard, profile
- Tier filter on agent dashboard (25.9, extending Phase 4)
- Tier dimension on reporting charts (25.10, extending Phase 14)
- Update `agent_tickets` VIEW to join tier data (architecture constraint 5)
- **Seed data**: 3 tiers + assignments per `docs/seed-data.md`
- Write tests for capability overrides, expiration, external API, RLS integration

### Phase 21 — Authentication Modes (External SSO)
**Prompt**: `promts/21-auth-external.md`
- Authentication configuration admin section (16.13)
- Built-in mode: social OAuth providers (Google, GitHub, Microsoft, GitLab) with enable/disable toggles and credentials
- External mode: OAuth/OIDC provider config (provider name, client ID/secret, issuer URL, scopes, redirect URI)
- Auto-redirect toggle for external mode
- Mode switching with confirmation prompt
- Hide/show password change section based on auth mode
- Write tests for external auth flow, mode switching, social provider buttons

### Phase 22 — Polish & Accessibility
**Prompt**: `promts/22-polish.md`
- Mobile responsive design (hamburger nav, compact layouts, 44×44px touch targets)
- WCAG 2.1 AA compliance (keyboard nav, focus indicators, ARIA attributes, alt text, color+text labels)
- Error pages (404, 403, 500, CSAT token) rendered from admin-configurable templates (Phase 7)
- Content-length validation at application level (matching DB CHECK constraints)
- Final Playwright accessibility audit (axe-core)
- Cross-browser smoke tests

---

## Testing Strategy

| Layer | Tool | What it tests | Runs in CI |
|---|---|---|---|
| Database | Vitest + Supabase JS | RLS policies, triggers, views, functions | Yes (supabase start) |
| Server Actions | Vitest | Business logic, validation | Yes |
| E2E | Playwright | Full user flows, UI, accessibility | Yes (supabase start + next dev) |
| Lint/Types | ESLint + tsc | Code quality, type safety | Yes |

## Seed Data — Progressive Schedule

The seed file `supabase/seed.sql` is created in Phase 2 and **updated incrementally** as features are added:

| Phase | Seed additions |
|---|---|
| 2 | Users (8 accounts), teams ("Alice's Team" + assignments) |
| 3 | 9 tickets with original posts, additional posts/comments/notes |
| 5 | 3 categories, 5 tags (with colors), tag assignments on tickets |
| 7 | 1 custom field ("Browser" dropdown), values on 3 tickets |
| 12 | 1 SLA policy, severity overrides on 3 tickets |
| 13 | 3 KB articles, 2 KB categories |
| 16 | 2 canned responses |
| 20 | 3 subscription tiers + user assignments (Alice→Enterprise, Bob→Licensed, Dave→Licensed-expired) |
