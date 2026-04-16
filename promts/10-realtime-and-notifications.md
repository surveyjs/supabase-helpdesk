# Phase 10 — Real-Time & In-App Notifications

## Context

You are building real-time updates and in-app notifications for a **HelpDesk** application. Read `docs/requirements.md` sections 14a.1–14a.6, 21.1–21.3, and `docs/architecture.md` constraints 2, 7.

Phases 0–9 are complete: project init, database schema, authentication, tickets, agent dashboard, taxonomy, posts/comments/notes, admin setup, file attachments, and email notifications with SMTP, preferences, and coalescing. The email notification infrastructure is in place with `notifyUser()`, `notifyAgent()`, and `notifyTicketRecipients()` functions.

This phase adds Supabase Realtime subscriptions for live updates and the in-app notification system (bell icon, dropdown, notifications page, cleanup cron).

## Tasks

### 1. Migration: `supabase/migrations/008_in_app_notifications.sql`

#### Notifications Table

```sql
CREATE TABLE notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  recipient_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL,
  ticket_id BIGINT REFERENCES tickets(id) ON DELETE CASCADE,
  message TEXT NOT NULL,
  is_read BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_notifications_recipient_unread
  ON notifications (recipient_id, is_read, created_at DESC)
  WHERE is_read = false;

CREATE INDEX idx_notifications_recipient_created
  ON notifications (recipient_id, created_at DESC);

ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;

-- Users can only see their own notifications
CREATE POLICY notifications_select ON notifications
  FOR SELECT USING (auth.uid() = recipient_id);

-- Insert via service role (notifications are system-generated)
-- Or via authenticated user for the system to insert on their behalf
CREATE POLICY notifications_insert ON notifications
  FOR INSERT WITH CHECK (true);  -- Server Actions use service role for inserts

-- Users can update their own notifications (mark read/unread)
CREATE POLICY notifications_update ON notifications
  FOR UPDATE USING (auth.uid() = recipient_id);

-- Users can delete their own notifications (for cleanup)
CREATE POLICY notifications_delete ON notifications
  FOR DELETE USING (auth.uid() = recipient_id);
```

#### Enable Realtime on Relevant Tables

```sql
-- Enable Realtime publication for live updates
-- Posts: for live post appearance on ticket detail
ALTER PUBLICATION supabase_realtime ADD TABLE posts;

-- Tickets: for live status/metadata changes on ticket detail and dashboard
ALTER PUBLICATION supabase_realtime ADD TABLE tickets;

-- Notifications: for live bell icon updates
ALTER PUBLICATION supabase_realtime ADD TABLE notifications;
```

#### Notification Cleanup Cron Job

```sql
-- Daily cleanup: read notifications >30 days, all >90 days
SELECT cron.schedule(
  'cleanup-notifications',
  '0 3 * * *',  -- 3 AM daily
  $$
  DELETE FROM notifications
  WHERE (is_read = true AND created_at < now() - interval '30 days')
     OR (created_at < now() - interval '90 days');
  $$
);
```

### 2. In-App Notification Creation

Update the notification dispatch functions from Phase 9:

**`src/lib/email/notify.ts`** — extend to also create in-app notifications:

- `notifyUser(recipientId, eventType, ticketId, placeholders)`:
  - After handling email (existing logic): also check in-app notification preference
  - If in-app is enabled: INSERT into `notifications` table with appropriately formatted `message` text
  - In-app notifications are never coalesced — they are always inserted immediately for real-time delivery

- `notifyAgent(agentId, eventType, ticketId, placeholders)`:
  - Same — check in-app preference, insert notification if enabled

- Helper: `formatNotificationMessage(eventType, placeholders)` — generates a short human-readable message:
  - `new_post`: "{authorName} replied to your ticket #{ticketId}"
  - `status_changed`: "Ticket #{ticketId} status changed to {newStatus}"
  - `agent_assigned`: "{agentName} was assigned to your ticket #{ticketId}"
  - `agent_assigned_to_agent`: "You were assigned to ticket #{ticketId}"
  - `user_reply_to_agent`: "{authorName} replied to ticket #{ticketId}"
  - etc.

### 3. Bell Icon Component (§14a.1, 14a.5)

**`src/components/features/notifications/NotificationBell.tsx`**:
- `"use client"` component (architecture constraint 2g)
- On mount:
  - Fetch initial unread count via server endpoint or direct query
  - Subscribe to Supabase Realtime on the `notifications` table filtered by `recipient_id = currentUserId`
  - On INSERT event: increment unread count badge
  - On UPDATE event (mark as read): decrement count if is_read changed to true
- Renders a bell icon with a red badge showing unread count (hidden when 0)
- Clicking the bell toggles the notification dropdown panel

**`src/components/features/notifications/NotificationDropdown.tsx`**:
- `"use client"` component (part of the bell)
- Fetches the 10 most recent notifications on open
- Each entry:
  - Event type icon (e.g., 💬 for new post, 🔄 for status change, 👤 for assignment)
  - Message text (short description)
  - Relative timestamp ("5 minutes ago", "2 hours ago")
  - Link to the relevant ticket
  - Unread: highlighted background (light blue); read: plain white
  - Clicking an unread notification marks it as read
- Top of dropdown: "Mark all as read" button
- Bottom of dropdown: "View all" link → `/notifications`

### 4. Notifications Page (§14a.3)

**`src/app/(main)/notifications/page.tsx`**:
- Paginated list of all notifications for the current user
- Read page size from `app_settings.other_lists_page_size` (default 20)
- Each entry: event icon, message text, full timestamp, link to ticket, read/unread state
- Click a notification to navigate to the ticket (and mark as read)
- Bulk "Mark all as read" button at the top
- Unread notifications have highlighted background

**Server Actions** (`src/lib/actions/notifications.ts` — extend):
- `markNotificationRead(notificationId)` — update `is_read = true`
- `markAllNotificationsRead()` — update all unread for current user
- `getUnreadCount()` — count unread notifications for current user

### 5. NavBar Update

Replace the notification bell placeholder (created in Phase 2) with the real `NotificationBell` component:
- The bell component is a `"use client"` import inside the server-rendered NavBar
- Pass the initial unread count as a prop (fetched server-side in NavBar)
- Pass the current user ID for the Realtime subscription filter

### 6. Real-Time on Ticket Detail (§21.1)

**`src/components/features/tickets/RealtimeTicketUpdates.tsx`** (new file):
- `"use client"` component (architecture constraint 2a)
- Subscribes to Supabase Realtime on:
  - `posts` table filtered by `ticket_id = currentTicketId` (new posts, comments, notes)
  - `tickets` table filtered by `id = currentTicketId` (status, metadata changes)
- On change event: trigger a **server data refresh** using `useRouter().refresh()` from `next/navigation`
  - This causes Next.js to re-fetch the server component data and update the page
  - No client-side state management needed — the server re-renders with fresh data
- Minimal component: no visible UI, just the subscription logic

Update `src/app/(main)/tickets/[id]/[slug]/page.tsx`:
- Include `<RealtimeTicketUpdates ticketId={ticket.id} />` at the bottom of the page
- Only render for authenticated users (not for unauthenticated visitors on public tickets)

### 7. Real-Time on Agent Dashboard (§21.2)

**`src/components/features/agent/RealtimeDashboard.tsx`** (new file):
- `"use client"` component (architecture constraint 2a)
- Subscribes to Supabase Realtime on:
  - `tickets` table (any changes — new tickets, status changes, assignments)
- On change event: trigger `useRouter().refresh()` to re-fetch dashboard data
- The result count and ticket list update automatically

Update `src/app/(main)/agent/page.tsx`:
- Include `<RealtimeDashboard />` component

### 8. NavBar User Dropdown Links

Update `src/components/layout/NavBar.tsx`:
- The "Notification Settings" link in the user dropdown should now point to `/notifications/settings` (the page created in Phase 9)
- Verify "Profile" link points to the profile page (Phase 15 will create it; for now, link to `/profile` which will 404 — or link to `/` as a temporary measure)

### 9. Tests

**`tests/db/010-in-app-notifications.test.ts`** (new file):
- Notification created for correct recipient
- User can only read own notifications (RLS)
- User can mark own notification as read
- User cannot modify others' notifications
- Notification is CASCADE-deleted when ticket is deleted
- Notification is CASCADE-deleted when user is deleted
- Unread count query returns correct number
- Mark all as read updates all unread for user
- Notification message format is correct for each event type

**`tests/e2e/realtime-notifications.spec.ts`** (new file):
- Bell icon shows unread count badge
- Bell badge updates when new notification arrives (test: agent makes change → user sees badge update)
- Clicking bell opens dropdown with recent notifications
- Clicking a notification navigates to the ticket
- "Mark all as read" clears the badge
- Notifications page shows all notifications paginated
- Notification preferences: disabled in-app events don't create notifications
- Ticket detail: new post by another user appears in real-time (agent posts → user sees it without refresh)
- Agent dashboard: new ticket appears in list in real-time
- Agent dashboard: ticket status change updates in real-time

## Implementation Notes

- **Realtime client**: Use `createBrowserClient()` from `src/lib/supabase/client.ts` (Phase 0) for all Realtime subscriptions. This is the browser-side Supabase client.
- **Realtime pattern**: The standard pattern is:
  ```typescript
  const supabase = createBrowserClient();
  const channel = supabase.channel('channel-name')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'posts', filter: `ticket_id=eq.${ticketId}` }, () => {
      router.refresh();
    })
    .subscribe();
  
  return () => { supabase.removeChannel(channel); };
  ```
  Use this in a `useEffect` cleanup pattern.

- **Realtime security**: Supabase Realtime respects RLS. A user only receives events for rows they have SELECT access to. This means:
  - Users won't see events for private posts they can't access
  - Users won't see note events
  - The notification table subscription is filtered by `recipient_id`

- **Bell component as client component**: The NavBar is a Server Component. Import `NotificationBell` as a client component (`"use client"`) within it. Pass initial data (unread count, user ID) as props from the server-rendered parent.

- **Router refresh**: `useRouter().refresh()` from `next/navigation` triggers a server-side re-render of the current route without a full page reload. This is the recommended way to update server-rendered pages from client-side events in Next.js App Router.

- **Notification cleanup**: The pg_cron job handles automatic cleanup. No application-level cleanup code needed.

- **Unauthenticated visitors**: Public ticket pages (when enabled) are server-rendered without Realtime subscriptions. Visitors see a static page. Only authenticated users get live updates.

## Deferred Features (Added by Later Phases)

- CSAT rating notification — Phase 11
- SLA breach/approaching notification — Phase 12
- Merge notification — Phase 17
- Bulk action batched notification — Phase 17

## Verification Checklist

- [ ] Bell icon shows correct unread count
- [ ] Badge updates in real-time when new notification arrives
- [ ] Dropdown shows 10 most recent notifications
- [ ] Clicking notification navigates to ticket and marks as read
- [ ] "Mark all as read" works in dropdown and notifications page
- [ ] Notifications page is paginated
- [ ] Notification preferences respected (disabled events don't notify)
- [ ] Ticket detail updates in real-time (new posts, status changes)
- [ ] Agent dashboard updates in real-time (new tickets, status changes)
- [ ] Notification cleanup: old read notifications cleaned up
- [ ] Real-time only for authenticated users (no subscriptions for visitors)
- [ ] `npm run typecheck` passes with no errors
- [ ] `npm run lint` passes with no errors
- [ ] `npm run test:db` passes in-app notification tests
- [ ] `npm run test:e2e` passes realtime/notification e2e tests
