# Phase 15 — User Profile & Account Management

## Context

You are building user profile, account management, user notes, and admin user management for a **HelpDesk** application. Read `docs/requirements.md` sections 20.1–20.5, 24.1–24.6, 16.16, 22.1–22.4, and `docs/design.md`.

Phases 0–14 are complete: project init, database schema, authentication, tickets, agent dashboard, taxonomy, posts/comments/notes, admin setup, file attachments, email notifications, real-time/in-app notifications, CSAT ratings, SLA policies, knowledge base, and reporting.

This phase adds the user profile page (view/edit), password changes, account deletion (anonymization), the agent-viewable user profile, user notes (CRUD), user management admin section, and user blocking.

## Tasks

### 1. Migration: `supabase/migrations/013_user_profile.sql`

#### User Notes Table

```sql
CREATE TABLE user_notes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  target_user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  author_id UUID NOT NULL REFERENCES profiles(id),
  body TEXT NOT NULL CHECK (char_length(body) <= 10000),
  edited_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_user_notes_target_user_id ON user_notes (target_user_id);
CREATE INDEX idx_user_notes_author_id ON user_notes (author_id);

ALTER TABLE user_notes ENABLE ROW LEVEL SECURITY;

-- Only agents can see user notes
CREATE POLICY user_notes_select ON user_notes
  FOR SELECT USING (is_agent());

-- Only agents can create user notes
CREATE POLICY user_notes_insert ON user_notes
  FOR INSERT WITH CHECK (is_agent());

-- Agent can edit own notes only
CREATE POLICY user_notes_update ON user_notes
  FOR UPDATE USING (auth.uid() = author_id AND is_agent());

-- Agent can delete own notes; admin can delete any
CREATE POLICY user_notes_delete ON user_notes
  FOR DELETE USING (
    (auth.uid() = author_id AND is_agent())
    OR is_admin()
  );
```

### 2. User Profile Page

**`src/app/(main)/profile/page.tsx`**:
- Require authenticated user
- Display: email, role, team (if any), subscription tier (placeholder — Phase 20 adds real display), account creation date
- **Display name** edit form:
  - Text input, max 100 chars
  - If uniqueness is enabled (`app_settings.display_name_unique = 'true'`, set in Phase 7): validate uniqueness on submit, show error if taken
  - Validate that display name does not start with "Deleted User #" prefix (reserved, §20.3)
  - Save button
- **Change password** form (§20.2):
  - Show only for users in **built-in** auth mode who used email/password
  - Hidden entirely in **external** auth mode
  - For social OAuth users in built-in mode: show message directing them to "Forgot password?" flow
  - Fields: current password, new password (with requirements: 8+ chars, uppercase, lowercase, digit), confirm new password
  - Submit calls Supabase Auth `updateUser({ password })`
- **Delete account** button (§20.4):
  - Show a "Delete my account" destructive button
  - Disabled for agents/admins (must be demoted first)
  - Clicking shows a confirmation modal: "This action is irreversible. Your account will be anonymized."
  - On confirm: call `deleteOwnAccount` Server Action

### 3. Server Actions for Profile

**`src/lib/actions/profile.ts`** (new file):

- `updateDisplayName(displayName: string)`:
  - Validate max 100 chars
  - Validate does not start with "Deleted User #"
  - If uniqueness enabled: check for existence (case-insensitive compare)
  - Update `profiles.display_name`
  - Revalidate

- `changePassword(currentPassword: string, newPassword: string)`:
  - Validate new password meets requirements (8+ chars, uppercase, lowercase, digit)
  - Verify current password by attempting sign-in with Supabase Auth
  - Update password via Supabase Auth `updateUser({ password: newPassword })`
  - Return success/error

- `deleteOwnAccount()`:
  - Verify the current user is a regular user (not agent/admin)
  - Anonymize: update `profiles` — set `display_name = 'Deleted User #' + id_suffix`, set `email = 'deleted-{id}@deleted.local'`
  - Remove notification preferences for this user
  - Remove team membership (`team_id = null`)
  - Remove ticket follows (but preserve tickets, posts, comments, activity log)
  - Invalidate auth session via Supabase Admin API (service-role: `auth.admin.deleteUser(userId)`)
  - Log to `admin_audit_log`
  - Redirect to login page

### 4. Agent-Viewable User Profile

**`src/app/(main)/admin/users/[userId]/page.tsx`**:
- Require agent role (agents and admins can view)
- Fetch the target user's profile
- Display: display name, email, role, team, subscription tier (placeholder), account creation date, block status, ticket count (SELECT COUNT from tickets)
- **User Notes** section (§24.3):
  - List all notes on this user, newest first
  - Each note: body (rendered Markdown), author display name, timestamp, "(edited)" if edited
  - Notes authored by the current agent: show "Edit" and "Delete" actions
  - Notes by other agents: no edit/delete (except admins see "Delete" on all)
  - "Add note" button: inline form with Markdown textarea + preview tab + submit
- **Admin actions** (visible only to admins):
  - Block/unblock button (see §22.1–22.2)
  - Delete account button (with confirmation, same anonymization as self-delete)
  - Tier assignment form (placeholder — Phase 20 adds this)

### 5. Server Actions for User Notes

Add to **`src/lib/actions/profile.ts`** (or new file `src/lib/actions/user-notes.ts`):

- `createUserNote(targetUserId, body)`:
  - Require agent role
  - Validate body (max 10,000 chars, non-empty)
  - Insert into `user_notes`
  - Log to `admin_audit_log`
  - Revalidate

- `updateUserNote(noteId, body)`:
  - Require agent role
  - Verify the note belongs to the current agent (RLS enforces this)
  - Update body, set `edited_at = now()`
  - Log to `admin_audit_log`
  - Revalidate

- `deleteUserNote(noteId)`:
  - Require agent role (own notes) or admin (any note)
  - Delete from `user_notes`
  - Log to `admin_audit_log`
  - Revalidate

### 6. User Notes Tab on Ticket Detail

Update `src/app/(main)/tickets/[id]/[slug]/page.tsx`:
- If the current user is an agent and the ticket submitter has at least one user note:
  - Show a **"User Notes"** tab in the ticket metadata/sidebar area
  - Tab label includes a badge with the note count
  - Clicking the tab shows all user notes for the submitter in reverse chronological order (read-only)
  - An "Open profile" link at the top navigates to `/admin/users/{submitterId}`
- If the submitter has no notes: the tab is hidden

### 7. Profile Links on Display Names

Update display name rendering throughout the application (§24.5):
- **For agents:** display names in the following locations become clickable links to `/admin/users/{userId}`:
  - Submitter name on ticket detail page
  - Author name on posts, comments
  - Submitter column in agent dashboard
- **For non-agent users:** display names remain plain text
- Create a reusable component: `src/components/features/users/DisplayName.tsx`
  - Props: `userId`, `displayName`, `isCurrentUserAgent`, optional `tierPill` (for Phase 20)
  - Renders a link if agent, plain text otherwise

### 8. Admin User Management Section

Add a new section to the Admin Setup sidebar: **"User Management"** (route: `/admin/users`).

**`src/app/(main)/admin/users/page.tsx`**:
- Require admin role
- Paginated list of all registered users
- Columns: display name, email, role, team, status (active/blocked/deleted), created date
- **Filters:**
  - Role: All, User, Agent, Admin
  - Status: All, Active, Blocked, Deleted
  - Search: by email or display name (partial match)
- **Actions per user row:**
  - Block / Unblock toggle button
  - Delete account button (confirmation prompt, same anonymization)
  - Click row → navigate to user detail page (`/admin/users/{userId}`)

**Server Actions** (add to `src/lib/actions/admin.ts`):

- `blockUser(userId)`:
  - Require admin
  - Set `profiles.is_blocked = true`
  - Log to `admin_audit_log`
  - Revalidate

- `unblockUser(userId)`:
  - Require admin
  - Set `profiles.is_blocked = false`
  - Log to `admin_audit_log`
  - Revalidate

- `adminDeleteUser(userId)`:
  - Require admin
  - Cannot delete agents/admins (must demote first)
  - Same anonymization logic as self-deletion (§20.4)
  - Log to `admin_audit_log`
  - Revalidate

### 9. Block Indicator

Update the agent dashboard and ticket detail pages (§22.3):
- When displaying a user who is blocked, show a red **"Blocked"** badge next to their display name
- On ticket detail: show in the submitter info area
- On agent dashboard: show in the submitter column

### 10. NavBar Updates

- Add "Profile" link to the user dropdown menu in NavBar (currently placeholder from Phase 2)
  - Points to `/profile`
- Update Admin Setup sidebar to include "User Management" link

### 11. Tests

**`tests/db/014-user-profile.test.ts`** (new file):
- User notes: agent can create notes on any user
- User notes: agent can edit/delete only own notes
- User notes: admin can delete any note
- User notes: regular users cannot see/create notes (RLS)
- User notes: CASCADE deletes when target user is deleted
- Display name uniqueness enforcement (when enabled)
- Display name "Deleted User #" prefix rejection
- Account deletion: anonymization preserves tickets/posts
- Account deletion: removes notification preferences, team membership
- Block user: sets is_blocked = true
- Blocked user: cannot create tickets (check via blocked check in Server Action)
- Unblock user: restores is_blocked = false

**`tests/e2e/user-profile.spec.ts`** (new file):
- Profile page loads with user info
- Display name edit and save
- Display name uniqueness error (when enabled)
- "Deleted User #" prefix rejected
- Change password works (built-in mode)
- Change password hidden for social OAuth users
- Delete account anonymizes and logs out
- Agent/admin cannot delete own account
- Agent-viewable profile page loads for agents
- User notes: create, edit, delete (agent)
- User notes: admin delete on any note
- User notes tab on ticket detail (visible when notes exist, hidden when none)
- Display name links to profile for agents
- Admin user management: list, filter, search
- Admin user management: block/unblock user
- Admin user management: delete user
- Blocked user: sees restriction banner
- Block indicator badge on dashboard and ticket detail

## Implementation Notes

- **Anonymization, not deletion:** Account "deletion" is anonymization (§20.4). The user's tickets, posts, and activity log entries are preserved with "Deleted User #ID" as the display name. Auth credentials are invalidated via Supabase Admin API.
- **Last admin guard:** Agents/admins cannot self-delete. An admin must demote them first. This is enforced in the Server Action, not just the UI.
- **Block indicator:** The block check should be performed in ticket and post creation Server Actions (Phases 3-4 already check `is_blocked`). The visual indicator in Phase 15 is purely UI.
- **User notes are internal:** Notes are never visible to the user they are about. No notifications are sent for user note CRUD.
- **DisplayName component:** The reusable `DisplayName` component should be used consistently across the app. It conditionally renders as a link (for agents) or plain text (for users).
- **Password change:** Uses Supabase Auth's `updateUser` API. Current password verification is done by attempting a sign-in first.

## Deferred Features (Added by Later Phases)

- Tier display on profile page — Phase 20
- Tier assignment form on agent-viewable profile — Phase 20
- Account deletion removes tier assignment — Phase 20

## Verification Checklist

- [ ] Profile page shows user info (email, role, team, created date)
- [ ] Display name edit with uniqueness validation (when enabled)
- [ ] "Deleted User #" prefix rejected
- [ ] Change password works for email/password users
- [ ] Change password hidden for social OAuth / external auth users
- [ ] Account deletion anonymizes and invalidates auth
- [ ] Agent/admin cannot self-delete
- [ ] Agent-viewable profile at `/admin/users/{userId}`
- [ ] User notes: CRUD with correct permissions
- [ ] User notes tab on ticket detail (agent-only, hidden when no notes)
- [ ] Display names link to profile for agents
- [ ] Admin user management: list, filter by role/status, search
- [ ] Block/unblock user functionality
- [ ] Blocked user sees restriction banner
- [ ] Block indicator badge visible on dashboard and ticket detail
- [ ] Admin can delete user accounts (with anonymization)
- [ ] All changes logged to admin audit log
- [ ] `npm run typecheck` passes with no errors
- [ ] `npm run lint` passes with no errors
- [ ] `npm run test:db` passes user profile tests
- [ ] `npm run test:e2e` passes user profile e2e tests
