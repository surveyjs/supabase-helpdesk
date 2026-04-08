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
- Agent actions: change status, assign/unassign
- Write Playwright tests: dashboard access (agent vs user), filters, assign
- Write DB tests: agent_tickets VIEW, agent RLS policies

### Phase 5 — Teams, Types, Categories, Tags
**Prompt**: `promts/05-teams-types-categories-tags.md`
- Teams: DB tables, team tickets view, teammate visibility
- Ticket types: management CRUD, default type
- Categories: management CRUD, optional category on tickets
- Tags: management CRUD, colored pills, tag filter
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
- Admin setup page with sidebar navigation
- Ticket types management section
- Categories management section
- Tags management section
- Agent/admin management (promote/demote)
- Ticket privacy settings
- Pagination settings
- Ticket creation rate limit setting
- Admin audit log
- Write Playwright tests: admin access, CRUD operations, audit log
- Write DB tests: admin-only RLS policies

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
- SMTP configuration (admin section)
- Notification templates (admin section)
- Email sending via Server Actions
- User notification preferences
- Notification coalescing queue + cron job
- Write tests for template rendering, preference overrides

### Phase 10 — In-App Notifications
**Prompt**: `promts/10-in-app-notifications.md`
- Notifications table + RLS
- Bell icon with unread count (Realtime subscription)
- Notification dropdown panel
- Notifications page (paginated)
- Mark as read/unread
- Notification cleanup cron job
- Write Playwright tests: bell badge, dropdown, mark-as-read

### Phase 11 — Real-Time Updates
**Prompt**: `promts/11-realtime.md`
- Supabase Realtime subscriptions on ticket detail
- Realtime on agent dashboard
- Thin client-side wrappers triggering server refresh
- Write tests verifying real-time update delivery

### Phase 12 — CSAT (Customer Satisfaction)
**Prompt**: `promts/12-csat.md`
- CSAT rating page (token-based, no login required)
- Token generation, expiration, single-use + reissue
- Rating display on ticket detail
- CSAT survey email scheduling (pg_cron)
- Admin CSAT settings section
- Write tests for token flow, rating submission, survey scheduling

### Phase 13 — SLA Policies
**Prompt**: `promts/13-sla.md`
- SLA tables: policies, severity mapping, timers, notifications_sent
- Business hours configuration
- SLA timer tracking (start, pause, resume, stop)
- SLA indicators on ticket detail & dashboard
- SLA breach/approaching notifications (pg_cron)
- SLA sort on agent dashboard
- Admin SLA configuration section
- Write tests for timer logic, breach detection, notifications

### Phase 14 — Knowledge Base
**Prompt**: `promts/14-knowledge-base.md`
- KB articles table (draft/published/archived)
- Help center public page with search
- Article detail page with SEO URLs
- Article management page (agents)
- KB categories (admin)
- Article feedback (helpful/not helpful)
- Suggested articles on ticket creation
- "Create ticket from article" flow
- Admin KB visibility toggle
- Write tests for article CRUD, search, visibility states

### Phase 15 — Reporting & Analytics
**Prompt**: `promts/15-reporting.md`
- Reporting dashboard page
- Ticket volume chart
- Resolution metrics
- Agent performance table
- CSAT summary chart
- SLA compliance stats
- Backlog overview
- CSV export
- Agent-scoped vs admin-scoped access
- Write tests for data accuracy, access control

### Phase 16 — User Profile & Account Management
**Prompt**: `promts/16-user-profile.md`
- Profile page (view/edit display name, change password)
- Account deletion (anonymization)
- Agent-viewable user profile
- User notes (CRUD, visibility)
- User notes tab on ticket detail
- Profile links on display names (agent view)
- Admin user management (block/unblock/delete)
- Write tests for profile editing, deletion, user notes RLS

### Phase 17 — Advanced Ticket Operations
**Prompt**: `promts/17-advanced-tickets.md`
- Mark as duplicate (with configurable template)
- Merge tickets (timeline consolidation, stub page)
- Bulk actions (close, assign, status, tags, severity, delete)
- Follow/unfollow tickets
- Canned responses (CRUD, insert into reply)
- Custom fields on tickets
- Write tests for duplicate, merge, bulk, follow, canned responses

### Phase 18 — Inbound Email
**Prompt**: `promts/18-inbound-email.md`
- Create ticket by email
- Reply by email
- Unknown sender handling
- Email signature stripping
- Auto-reply rate limiting
- Blocked user email rejection
- Write tests for email parsing, ticket creation, rate limits

### Phase 19 — AI Features
**Prompt**: `promts/19-ai-features.md`
- AI provider configuration (admin)
- Auto-categorization on ticket creation
- Duplicate ticket detection (semantic)
- Suggested reply for agents
- Ticket summary (agent-only)
- Generate KB article from ticket
- AI rate limiting & timeout handling
- Write tests for feature toggles, timeout fallbacks, rate limits

### Phase 20 — Subscription Tiers
**Prompt**: `promts/20-subscription-tiers.md`
- Tier definitions (admin CRUD)
- Tier assignment (admin + external API)
- Capability overrides (RLS integration)
- Per-tier limits
- Tier display (pills throughout UI)
- Tier filter on agent dashboard
- Tier dimension on reports
- Write tests for capability overrides, expiration, external API

### Phase 21 — Authentication Modes (External SSO)
**Prompt**: `promts/21-auth-external.md`
- External OAuth/OIDC configuration (admin)
- Auto-redirect toggle
- Social OAuth providers (Google, GitHub, etc.)
- Mode switching with confirmation
- Write tests for external auth flow, mode switching

### Phase 22 — Polish & Accessibility
**Prompt**: `promts/22-polish.md`
- Mobile responsive design
- WCAG 2.1 AA compliance
- Error pages (404, 403, 500, CSAT token)
- Logo/URL configuration
- Content-length validation
- Final Playwright accessibility audit

---

## Testing Strategy

| Layer | Tool | What it tests | Runs in CI |
|---|---|---|---|
| Database | Vitest + Supabase JS | RLS policies, triggers, views, functions | Yes (supabase start) |
| Server Actions | Vitest | Business logic, validation | Yes |
| E2E | Playwright | Full user flows, UI, accessibility | Yes (supabase start + next dev) |
| Lint/Types | ESLint + tsc | Code quality, type safety | Yes |

## Seed Data

After Phase 2, create `supabase/seed.sql` per `docs/seed-data.md`. Update it progressively as features are added.
