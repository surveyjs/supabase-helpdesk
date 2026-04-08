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
- Uses `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY`

**`src/lib/supabase/client.ts`**:
- `createBrowserClient()` — creates a Supabase client for client-side Realtime subscriptions only
- Uses `@supabase/ssr` `createBrowserClient`

**`src/lib/supabase/middleware.ts`**:
- `updateSession(request)` — refreshes the auth session using `@supabase/ssr` and returns the updated response with refreshed cookies

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
- Redirect to `/` if already authenticated

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
- Password requirements: 8+ chars, 1 uppercase, 1 lowercase, 1 digit

**`src/app/(auth)/signup/page.tsx`**:
- Email + password + confirm password form
- Password validation (8+ chars, 1 upper, 1 lower, 1 digit)
- Server Action: `supabase.auth.signUp()`
- On success: show "Check your email for confirmation" message
- "Already have an account? Log in" link

**`src/app/(auth)/forgot-password/page.tsx`**:
- Email input form
- Server Action: `supabase.auth.resetPasswordForEmail()`
- Show success message regardless (prevent email enumeration)

**`src/app/(auth)/reset-password/page.tsx`**:
- New password + confirm form
- Verify token from URL
- Server Action: `supabase.auth.updateUser({ password })`
- Redirect to `/login` on success

### 4. Sign Out

**`src/lib/actions/auth.ts`**:
- `signOut()` Server Action — calls `supabase.auth.signOut()` and redirects to `/login`

### 5. Navigation Bar

**`src/components/layout/NavBar.tsx`**:
- Server Component
- Left: "HelpDesk" logo link
- Right (authenticated): display name (or email fallback), role badge, "Sign out" button
- Right (unauthenticated): "Log in" link
- Fetch user profile server-side to show display name and role

### 6. Main Layout

**`src/app/(main)/layout.tsx`**:
- Wraps all authenticated pages
- Includes NavBar
- Redirects to `/login` if not authenticated
- Gray background, centered content

**`src/app/(main)/page.tsx`**:
- Home page — redirect to `/tickets` (will be built in Phase 3)
- For now: show "Welcome, {displayName}" message

### 7. Seed Data Script

Create `supabase/seed.sql` with the user accounts from `docs/seed-data.md`:
- Use `supabase.auth.admin.createUser()` approach or raw SQL inserts into `auth.users`
- All passwords: `Password123`
- Set roles in `profiles` table after user creation
- Create the team "Alice's Team" and assign Alice, Bob, Carol

### 8. Tests

**`tests/db/002-auth.test.ts`**:
- Test login_attempts table: increment, lockout, reset
- Test profile auto-creation trigger (insert into auth.users → profile exists)
- Test that blocked users still have profiles

**`tests/e2e/auth.spec.ts`**:
- Test signup flow (valid + invalid passwords)
- Test login flow (success + wrong password + locked account)
- Test sign out
- Test forgot password page renders
- Test unauthenticated redirect to `/login`
- Test nav bar shows display name when logged in
- Test nav bar shows "Log in" when not logged in

## Implementation Notes

- All auth mutations happen via Server Actions (architecture constraint 1)
- No `"use client"` components in this phase
- Login rate limiting is in the Server Action, not client-side
- The login_attempts check uses a service-role client (bypasses RLS) since unauthenticated users can't have RLS context

## Verification Checklist

- [ ] Sign up creates account and shows confirmation message
- [ ] Login works with correct credentials
- [ ] Login fails with wrong credentials and shows error
- [ ] Login locks after 5 failed attempts for 15 minutes
- [ ] Sign out clears session and redirects
- [ ] Forgot password sends reset email
- [ ] Unauthenticated users are redirected to `/login`
- [ ] NavBar shows user info when logged in
- [ ] Seed data creates all test users with correct roles
- [ ] `npm run test:db` passes auth-related tests
- [ ] `npm run test:e2e` passes auth e2e tests
