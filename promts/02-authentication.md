# Phase 2 — Authentication

## Context

You are building authentication for a **HelpDesk** application. Read `docs/requirements.md` sections 1.1–1.5 and `docs/architecture.md` constraints 1–4.

Phase 0 (project init) and Phase 1 (database schema) are complete. Supabase local dev is running with all core tables and RLS policies.

This phase implements **built-in mode only** (email/password). External OAuth/SSO is Phase 21.

## Tasks

### 1. Supabase Client Helpers

Implement the client helpers created as stubs in Phase 0:

**`src/lib/supabase/server.ts`**:
- `createServerClient()` — creates a Supabase client for Server Components and Server Actions using `@supabase/ssr` with `cookies()` from `next/headers`
- **Critical:** The `setAll` callback MUST be wrapped in a try-catch. In Server Components, cookies are read-only and `cookieStore.set()` throws. The middleware handles session refresh, so silently catching the error is safe.
- Uses `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `createServiceRoleClient()` — creates a Supabase client that bypasses RLS, for use in login rate-limiting and other admin operations
- Uses `NEXT_PUBLIC_SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` (server-only, non-public env var)
- Add `SUPABASE_SERVICE_ROLE_KEY` to `.env.local` / `.env.test`

**`src/lib/supabase/client.ts`**:
- `createBrowserClient()` — creates a Supabase client for client-side Realtime subscriptions only
- Uses `@supabase/ssr` `createBrowserClient`

**`src/lib/supabase/middleware.ts`**:
- `updateSession(request)` — refreshes the auth session using `@supabase/ssr` and returns the updated response with refreshed cookies
- **Also handles auth redirects:** After calling `getUser()`, redirect authenticated users away from auth pages (`/login`, `/signup`, `/forgot-password`) to `/`. This is more reliable than doing it in the `(auth)` layout because middleware has full cookie read-write access and won't crash on token refresh.

**`src/middleware.ts`**:
- Calls `updateSession` on every request
- Applies to all routes except static files and `_next`

### 2. Auth Utility Functions

**`src/lib/supabase/auth.ts`**:
- `getUser()` — returns the current authenticated user or null (calls `supabase.auth.getUser()`)
- `getProfile()` — returns the current user's profile from the `profiles` table
- `requireAuth()` — returns user or redirects to `/login`
- `requireAgent()` — returns user (must be agent/admin) or redirects to `/`
- `requireAdmin()` — returns user (must be admin) or redirects to `/`

### 3. Auth Pages

**`src/app/(auth)/layout.tsx`**:
- Centered layout for auth pages
- White card container with padding, rounded corners
- No nav bar (minimal layout)
- Auth redirect for authenticated users is handled in middleware (see Task 1), NOT in this layout — `getUser()` in a Server Component can trigger a token refresh that fails because cookies are read-only outside Server Actions/Route Handlers

**`src/app/(auth)/login/page.tsx`**:
- Email + password form
- "Forgot password?" link
- "Don't have an account? Sign up" link
- Server Action for login:
  1. Check `login_attempts` table for lockout (5 fails = 15 min lockout)
  2. If locked, show remaining time
  3. Attempt `supabase.auth.signInWithPassword()`
  4. On failure: increment `login_attempts` counter
  5. On success: reset `login_attempts` counter, redirect to `/`
- Show validation errors inline

> **Note:** Do NOT display password requirements on the login page — that would leak policy info to attackers. Password format rules are only shown on signup and reset-password pages.

**`src/app/(auth)/signup/page.tsx`**:
- Email + password + confirm password form
- Password validation (8+ chars, 1 upper, 1 lower, 1 digit)
- Server Action: `supabase.auth.signUp()`
- **Auto-confirm behavior:** When `enable_confirmations = false` in `config.toml` (local dev default), `signUp()` returns a session immediately. In that case, redirect to `/` instead of showing a confirmation message. Only show "Check your email for confirmation" when no session is returned (i.e., email confirmation is enabled).
- "Already have an account? Log in" link

**`src/app/(auth)/forgot-password/page.tsx`**:
- Email input form
- Server Action: `supabase.auth.resetPasswordForEmail()`
- Show success message regardless (prevent email enumeration)
- **Phase 21 note:** When social OAuth is added, social-only users should see a specific message directing them to sign in with their provider instead of the generic success. Keep the implementation flexible for this change.

**`src/app/(auth)/reset-password/page.tsx`**:
- New password + confirm form
- Password validation (8+ chars, 1 upper, 1 lower, 1 digit)
- This page relies on the auth callback route (see below) having already exchanged the reset code for an active session
- Server Action: `supabase.auth.updateUser({ password })`
- Redirect to `/login` on success

**`src/app/auth/callback/route.ts`** — Auth callback handler:
- GET route handler that handles Supabase Auth email links (signup confirmation, password reset)
- Reads the `code` query parameter from the URL
- Calls `supabase.auth.exchangeCodeForSession(code)` to establish a session
- On signup confirmation: redirect to `/`
- On password reset: redirect to `/reset-password`
- On error: redirect to `/login` with an error message

### 4. Sign Out

**`src/lib/actions/auth.ts`**:
- `signOut()` Server Action — calls `supabase.auth.signOut({ scope: 'local' })` and redirects to `/login`
- **Important:** Use `scope: 'local'` to only invalidate the current browser session. The default `'global'` scope revokes ALL sessions for the user, which breaks concurrent sessions and parallel E2E tests.

### 5. Navigation Bar

**`src/components/layout/NavBar.tsx`**:
- Server Component
- Left: "HelpDesk" logo link using `<Link>` from `next/link` (links to `/`, will become configurable in Phase 7). Use `next/link` for internal navigation to satisfy the `@next/next/no-html-link-for-pages` lint rule. Add a "My Tickets" link pointing to `/tickets` (visible only to regular users — agents/admins get this link in their user menu dropdown instead). Role-conditional links (Agent Dashboard) added in their respective phases.
- Right (authenticated):
  - Notification bell placeholder icon (Phase 10 adds interactive client component)
  - **User menu dropdown** using HTML `<details>`/`<summary>` (no client-side JavaScript needed, no `"use client"`):
    - Summary shows: Display name (or email fallback) + role badge pill: "Admin" (red/orange) for admins, "Agent" (blue) for agents, no badge for regular users
    - Dropdown contains role-based links followed by common links, with "Sign out" always last:
      - **Admin only:** "Setup" link (first item, added in Phase 7)
      - **Agents/admins only:** "My Tickets", "Reports" (Phase 14), "Canned Responses" (Phase 16)
      - **All users:** "Profile" link, "Notification Settings" link
      - **All users:** "Sign out" button (always last item, uses `<form>` with server action)
- Right (unauthenticated): "Log in" link. (Phase 3 may add "Browse Tickets" link if public access is enabled per req 1.5/16.10.)
- Structure the NavBar markup so it can be converted to a hamburger menu on small screens in Phase 22 (no mobile behavior needed now, but the DOM structure should be collapsible)
- Fetch user profile server-side to show display name and role

### 6. Main Layout

**`src/app/(main)/layout.tsx`**:
- Wraps all authenticated pages
- Includes NavBar
- Redirects to `/login` if not authenticated
- Gray background, centered content

**`src/app/(main)/page.tsx`**:
- Home page — for Phase 2, show "Welcome, {displayName}" message
- Phase 3 will change this to redirect to `/tickets`
- Remove or replace the placeholder `src/app/page.tsx` from Phase 0 — the `(main)` route group now handles `/`

### 7. Seed Data Script

Create `supabase/seed.sql` with the user accounts from `docs/seed-data.md`:
- Use a PL/pgSQL `DO` block to loop over a JSON array and insert into `auth.users` with `crypt('Password123', gen_salt('bf'))` for `encrypted_password`
- Required `auth.users` columns: `id` (known UUID), `instance_id` (use `'00000000-0000-0000-0000-000000000000'`), `aud` (`'authenticated'`), `role` (`'authenticated'`), `email`, `encrypted_password`, `email_confirmed_at` (set to `now()` so accounts are active), `created_at`, `updated_at`
- **GoTrue compatibility — additional required columns:** GoTrue's Go code cannot scan NULL into string fields. The following columns MUST be set to empty strings: `confirmation_token`, `recovery_token`, `email_change_token_new`, `email_change_token_current`, `email_change`, `reauthentication_token`. Set `email_change_confirm_status` to `0` (integer). Do NOT insert `confirmed_at` — it is a `GENERATED ALWAYS` column computed from `LEAST(email_confirmed_at, phone_confirmed_at)`. Do NOT set `phone` to an empty string — it has a UNIQUE constraint; leave it as NULL.
- After inserting users, also insert identity records into `auth.identities` by selecting from `auth.users` — GoTrue requires these for login to work
- The `handle_new_user` trigger (Phase 1) will auto-create `profiles` rows — do NOT insert directly into `profiles`
- After user creation, UPDATE the `profiles` table to set roles and team assignments
- Create the team "Alice's Team" and assign Alice, Bob, Carol
- Phase 2 seeds **only** users and teams. Ticket types already exist from Phase 1 migration. All other seed data (categories, tags, tickets, etc.) added in later phases per the build-plan seed schedule.

**Important:** The seed file will be extended in Phase 3 to add 9 tickets with posts/comments/notes. Structure the seed SQL so it can be appended to.

### 7a. Profile Creation Validation

The `handle_new_user` trigger was created in Phase 1 (migration 001). Phase 2 adds a validation check.

Create migration **`supabase/migrations/002_auth.sql`**:
- `CREATE OR REPLACE FUNCTION handle_new_user()` that includes the original Phase 1 logic plus a guard rejecting display names starting with `"Deleted User #"` (raise exception if the COALESCE result starts with that prefix)
- `ALTER TABLE profiles ADD CONSTRAINT chk_display_name_not_reserved CHECK (display_name NOT LIKE 'Deleted User #%');`

### 8. Tests

**`tests/db/002-auth.test.ts`**:
- Test login_attempts table: increment, lockout after 5 failures, reset on success
- Test rate-limit boundary: 4 failures still allow login, 5th triggers lockout
- Test lockout expiry (use DB time manipulation to simulate 15 min passing)
- Test profile auto-creation trigger (insert into auth.users → profile exists with correct display_name)
- Test `handle_new_user` with `raw_user_meta_data` containing only `name` (not `display_name`)
- Test `handle_new_user` with NULL `raw_user_meta_data` → falls back to email prefix
- Test that blocked users still have profiles
- Test "Deleted User #" CHECK constraint: INSERT/UPDATE with that prefix is rejected
- Test seed data: verify 8 users exist with correct roles (1 admin, 2 agents, 5 users), verify "Alice's Team" exists with Alice/Bob/Carol as members

**`tests/e2e/auth.spec.ts`**:

> **Email handling:** Supabase local dev includes Inbucket (email capture at `http://localhost:54324`). For signup and reset tests, either (a) query Inbucket API to retrieve confirmation/reset links and complete the flow, or (b) configure Supabase local to auto-confirm users in `config.toml`. Document the chosen approach.

- Test signup flow: valid credentials → with auto-confirm enabled (local dev default), user is logged in and redirected to `/`; with confirmations enabled, shows "check your email" message
- Test signup validation: password missing uppercase/digit/length → inline error
- Test login flow: correct credentials → redirects to `/`
- Test login: wrong password → error message
- Test login lockout: 5 failures → shows lockout message with remaining time
- Test sign out: clears session, redirects to `/login`
- Test forgot password: submit email → success message shown (regardless of email validity)
- Test full reset-password flow: submit email → retrieve reset email from Inbucket → follow link → auth callback exchanges code → enter new password → verify login with new password
- Test unauthenticated redirect: visiting `/` redirects to `/login`
- Test authenticated redirect: visiting `/login` redirects to `/`
- Test nav bar: shows display name + role badge when logged in
- Test nav bar: shows "Log in" link when not logged in
- Test nav bar dropdown: `<details>` opens/closes, contains Profile and Notification Settings links, and Sign out as last item
- Test sign out: is inside user dropdown as a menuitem, clicking signs out

## Implementation Notes

- **Visual design:** Follow `docs/design.md` — gray-50 page background, white cards with subtle borders, blue primary buttons, Geist font (sans + mono), max-width ~5xl centered content. All forms must have proper labels and be keyboard-navigable (WCAG 2.1 AA).
- Enforce content-length limits from architecture constraint 9 on all form inputs (e.g., display_name max 100 chars, email max 320 chars). Validate both client-side (for UX, using `maxLength` attributes) and server-side (in Server Actions).
- All auth mutations happen via Server Actions (architecture constraint 1)
- The NavBar dropdown uses `<details>`/`<summary>` (no JS, no `"use client"`). The dropdown contains role-specific links, common links (Profile, Notification Settings), and Sign out as the last item using a `<form>` with server action. However, the auth form pages (`login`, `signup`, `forgot-password`, `reset-password`) require `"use client"` because they use React's `useActionState` hook for Server Action form state management.
- Login rate limiting is in the Server Action, not client-side
- The login_attempts check uses a service-role client (bypasses RLS) since unauthenticated users can't have RLS context

## Verification Checklist

- [ ] Sign up creates account (auto-confirms in local dev and redirects to home, or shows confirmation message if email confirmation is enabled)
- [ ] Login works with correct credentials
- [ ] Login fails with wrong credentials and shows error
- [ ] Login locks after 5 failed attempts for 15 minutes
- [ ] Sign out clears session and redirects
- [ ] Forgot password sends reset email
- [ ] Unauthenticated users are redirected to `/login`
- [ ] NavBar shows user info when logged in
- [ ] Seed data creates all test users with correct roles
- [ ] `npm run typecheck` passes with no errors
- [ ] `npm run lint` passes with no errors
- [ ] `npm run test:db` passes auth-related tests
- [ ] `npm run test:e2e` passes auth e2e tests
