# Phase 16 — Canned Responses, Follow & Custom Fields

## Context

You are building canned responses, ticket following UI, and custom fields display for a **HelpDesk** application. Read `docs/requirements.md` sections 10.1–10.3, 3.11, 3.13, 3.13a, and `docs/design.md`.

Phases 0–15 are complete: project init, database schema, authentication, tickets, agent dashboard, taxonomy, posts/comments/notes, admin setup, file attachments, email notifications, real-time/in-app notifications, CSAT ratings, SLA policies, knowledge base, reporting, and user profile/account management.

This phase adds canned response management and usage, the follow/unfollow UI on ticket detail, the followers list for agents, and custom fields display/editing on ticket detail and creation form.

## Tasks

### 1. Migration: `supabase/migrations/014_canned_responses.sql`

#### Canned Responses Table

```sql
CREATE TABLE canned_responses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL CHECK (char_length(title) <= 200),
  body TEXT NOT NULL CHECK (char_length(body) <= 50000),
  visibility TEXT NOT NULL DEFAULT 'private' CHECK (visibility IN ('public', 'private')),
  author_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_canned_responses_author_id ON canned_responses (author_id);
CREATE INDEX idx_canned_responses_visibility ON canned_responses (visibility);

ALTER TABLE canned_responses ENABLE ROW LEVEL SECURITY;

-- Agents can see: their own private + all public
CREATE POLICY canned_responses_select ON canned_responses
  FOR SELECT USING (
    is_agent() AND (
      visibility = 'public'
      OR author_id = auth.uid()
    )
  );

-- Agents can create
CREATE POLICY canned_responses_insert ON canned_responses
  FOR INSERT WITH CHECK (is_agent());

-- Agent can edit own; admin can edit any public
CREATE POLICY canned_responses_update ON canned_responses
  FOR UPDATE USING (
    (auth.uid() = author_id AND is_agent())
    OR (visibility = 'public' AND is_admin())
  );

-- Agent can delete own; admin can delete any public
CREATE POLICY canned_responses_delete ON canned_responses
  FOR DELETE USING (
    (auth.uid() = author_id AND is_agent())
    OR (visibility = 'public' AND is_admin())
  );
```

### 2. Canned Responses Management Page

**`src/app/(main)/canned-responses/page.tsx`**:
- Require agent role
- Paginated list of all accessible canned responses (own private + all public)
- Columns: title, visibility badge (Public/Private), author display name, body preview (truncated), updated date
- Search by title or body content
- Filter by visibility: All, Public, Private
- "New Response" button → inline form or modal
- Each row: edit button, delete button (per permission rules)

### 3. Server Actions for Canned Responses

**`src/lib/actions/canned-responses.ts`** (new file):

- `createCannedResponse(title, body, visibility)`:
  - Require agent role
  - Validate: title (max 200 chars, non-empty), body (max 50,000 chars, non-empty), visibility ('public' or 'private')
  - Insert with current user as `author_id`
  - Revalidate

- `updateCannedResponse(responseId, title, body, visibility?)`:
  - Require agent role
  - Validate ownership (own response) or admin (any public response)
  - Validate title and body length
  - Update, set `updated_at = now()`
  - Revalidate

- `deleteCannedResponse(responseId)`:
  - Require agent role
  - Validate ownership or admin for public responses
  - Delete from `canned_responses`
  - Revalidate

- `searchCannedResponses(query?)`:
  - Require agent role
  - Return paginated list of accessible responses matching the search query
  - Used by the response picker in the reply form

### 4. Canned Response Picker in Reply Form

Update the reply/post composition form (used on ticket detail page):

- For agents: add a **"Insert canned response"** button/dropdown above the text area
- Clicking opens a searchable dropdown or modal listing accessible canned responses
- Each entry shows: title, visibility badge, body preview
- Search field for filtering by title or body content
- Selecting a response inserts its body into the text area at the cursor position
- The agent can then edit the inserted text before submitting
- This is a `"use client"` component for the interactive search/insert behavior

**`src/components/features/canned-responses/CannedResponsePicker.tsx`**:
- `"use client"` component
- Props: `onInsert: (body: string) => void`
- Fetches canned responses on open (or caches them)
- Search input + filtered list + click to insert

### 5. Follow/Unfollow UI on Ticket Detail

Update `src/app/(main)/tickets/[id]/[slug]/page.tsx`:

- **Follow/Unfollow toggle** (§3.11):
  - Shown for logged-in users who have access to the ticket
  - Ticket owner: automatically follows, **cannot unfollow** (button disabled or hidden)
  - Other users: "Follow" / "Unfollow" toggle button
  - Blocked users cannot follow/unfollow (button hidden, §22.1)

- **Followers list** (agents only):
  - A "Followers" section in the ticket metadata area
  - Shows the count (e.g., "3 followers")
  - Expandable: shows a list of follower display names
  - Only visible to agents

**Server Actions** (add to `src/lib/actions/tickets.ts`):

- `followTicket(ticketId)`:
  - Require authenticated user
  - Verify user has access to the ticket
  - Verify user is not blocked
  - Verify user is not the ticket owner (ticket owner auto-follows and cannot toggle)
  - Insert into `ticket_followers`
  - Revalidate

- `unfollowTicket(ticketId)`:
  - Require authenticated user
  - Verify user is not the ticket owner (cannot unfollow own ticket)
  - Delete from `ticket_followers`
  - Revalidate

- `getFollowers(ticketId)`:
  - Require agent role
  - Query `ticket_followers` joined with `profiles` for display names
  - Return list of follower display names and user IDs

### 6. Custom Fields on Ticket Detail

Update `src/app/(main)/tickets/[id]/[slug]/page.tsx`:

- Display custom fields in the ticket metadata area (§3.13):
  - Fetch all custom field definitions from `custom_fields` table (Phase 7 created this)
  - Display each field with its label and current value from `tickets.custom_fields` JSONB
  - Field types: text, number, dropdown, checkbox, date — render appropriately
  - Empty/unset fields show a placeholder or "Not set"

- **Editable by ticket owner and agents:**
  - Inline edit controls for each custom field
  - Dropdown fields show a select input
  - Checkbox fields show a toggle
  - Date fields show a date picker
  - Save changes via Server Action

- **Source article reference** (§3.13a):
  - If `source_article_id` is set and user is an agent:
    - Show "Created from article: {title}" as a clickable link to the KB article
  - This field is system-managed and not editable

**Server Action** (add to `src/lib/actions/tickets.ts`):

- `updateCustomFields(ticketId, fields: Record<string, any>)`:
  - Require: ticket owner or agent
  - Validate field values against custom field definitions (type validation, required check, dropdown options)
  - Update `tickets.custom_fields` JSONB
  - Log field changes to `activity_log` (recording field name, old value, new value per §13.7)
  - Revalidate

### 7. Custom Fields on Ticket Creation Form

Update `src/app/(main)/tickets/new/page.tsx` (or ticket creation form component):

- After the standard fields (title, body, urgency, type, category, privacy):
  - Render each custom field defined in `custom_fields` table
  - Apply field-specific input (text input, number input, dropdown select, checkbox, date picker)
  - Pre-fill with `default_value` from the custom field definition
  - Required fields show a required indicator
- On submit: include custom field values in the `createTicket` action

Update `src/lib/actions/tickets.ts` — `createTicket`:
- Accept custom fields from form data
- Validate against custom field definitions
- Store in `tickets.custom_fields` JSONB

### 8. NavBar Update

Update `src/components/layout/NavBar.tsx`:
- Add **"Canned Responses"** link visible to agents/admins
- Links to `/canned-responses`

### 9. Seed Data

Extend `supabase/seed.sql` per `docs/seed-data.md`:

**Canned Responses** (2):
- "Greeting" — public, author: Grace (agent), body: "Thank you for reaching out! Let me look into this for you."
- "Closing" — private, author: Grace, body: "I'm glad I could help! If you have any other questions, feel free to open a new ticket."

**Custom Field** (1 — already defined in Phase 7 seed data, verify it exists):
- "Browser" — dropdown, options: ["Chrome", "Firefox", "Safari", "Edge", "Other"], not required, default: null
- Assign values on 3 existing tickets: Ticket 1 = "Chrome", Ticket 4 = "Firefox", Ticket 7 = "Safari"

### 10. Tests

**`tests/db/015-canned-responses-follow.test.ts`** (new file):
- Canned response CRUD (agent: own responses)
- RLS: agent sees own private + all public
- RLS: agent cannot see other agents' private responses
- RLS: admin can edit/delete any public response
- RLS: regular user cannot access canned responses
- Follow/unfollow: user can follow accessible tickets
- Follow/unfollow: owner cannot unfollow own ticket
- Follow/unfollow: blocked user cannot follow
- Followers list: agents can see, users cannot
- Custom field validation: type checking, required fields, dropdown options
- Custom field update logged in activity_log

**`tests/e2e/canned-responses-follow.spec.ts`** (new file):
- Canned responses page: list, search, filter by visibility
- Create canned response (public and private)
- Edit own canned response
- Delete own canned response
- Admin edit/delete public response by other agent
- Canned response picker: insert response into reply text area
- Follow button appears for non-owner on ticket detail
- Unfollow button toggles correctly
- Owner cannot unfollow own ticket
- Followers count and list visible to agents
- Custom fields display on ticket detail
- Custom fields editable by owner and agent
- Custom fields on ticket creation form
- Custom field validation (required, dropdown options)

## Implementation Notes

- **Canned response RLS:** The SELECT policy uses a combined check: `visibility = 'public' OR author_id = auth.uid()`. This ensures agents only see their own private responses plus all public ones.
- **Response picker UX:** The canned response picker should be a searchable dropdown/modal that inserts the response body at the current cursor position in the text area. If cursor position tracking is complex, inserting at the end of the current content is acceptable.
- **Follow/unfollow idempotency:** Following an already-followed ticket should be a no-op (upsert pattern). Unfollowing a not-followed ticket should be a no-op.
- **Custom fields JSONB:** Custom field values are stored as a JSON object on the ticket (`tickets.custom_fields`). The keys match the custom field `id` or `name`. Validate values server-side against the field definitions before storing.
- **Activity log for custom fields:** Log each changed field individually with old and new values, per the activity log spec.

## Deferred Features (Added by Later Phases)

- Merge transfers followers (dedup) — Phase 17
- Blocked users cannot follow/unfollow but retain existing follows — already handled in this phase

## Verification Checklist

- [ ] Canned responses page lists own private + all public
- [ ] Create/edit/delete canned responses with correct permissions
- [ ] Admin can edit/delete any public response
- [ ] Canned response picker inserts body into reply text area
- [ ] Follow/unfollow toggle works on ticket detail
- [ ] Owner cannot unfollow own ticket
- [ ] Blocked users cannot follow/unfollow
- [ ] Followers count and list visible to agents
- [ ] Custom fields display on ticket detail with correct types
- [ ] Custom fields editable by owner and agents
- [ ] Custom fields on ticket creation form with defaults
- [ ] Custom field validation (required, type, dropdown options)
- [ ] Source article link visible on ticket detail for agents
- [ ] Custom field changes logged in activity_log
- [ ] NavBar: "Canned Responses" link visible to agents
- [ ] Seed data: 2 canned responses, custom field values on 3 tickets
- [ ] `npm run test:db` passes canned responses/follow tests
- [ ] `npm run test:e2e` passes canned responses/follow e2e tests
