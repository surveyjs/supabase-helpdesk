# Ticket Detail: Reply Button & Activity Logs Tab

## Summary

Two focused UX improvements to the ticket detail page:

1. **Reply on demand** — Remove the always-visible `ReplyForm` at the bottom of the thread. Users and agents must click an **Add a reply** button to open the compose form.
2. **Separate Activity Logs tab** — Move activity-log entries out of the interleaved post timeline and into a dedicated **Logs** tab shown under the original post. The tab only appears when there are visible log entries.

---

## Motivation

### 1. Auto-reply removal
Previously, the reply form was pre-rendered at the bottom of every ticket regardless of the user's intent. This cluttered the layout, especially on long threads. The form should only appear when explicitly requested.

### 2. Logs tab
Activity-log entries (e.g. *"Admin changed status from open to closed"*, *"Agent assigned"*) were interleaved inline with posts in the thread timeline. This mixed conversational content with system events, making the thread hard to read. Separating them into a distinct tab improves focus.

---

## Changes

### New component: `MainReplyToggle.tsx`

A client component located alongside the ticket detail page components:

```
src/app/(main)/tickets/[id]/[slug]/MainReplyToggle.tsx
```

Renders an **Add a reply** button. When clicked, it expands to show `ReplyForm` with a **Cancel** button to collapse it again.

Props:
```ts
{
  ticketId: number;
  isAgent: boolean;
  editorViewMode: 'both' | 'preview' | 'editor';
  aiSuggestedReplyEnabled?: boolean;
}
```

### Updated component: `TicketTabs.tsx`

Extended to support an optional `logsContent` / `logCount` pair:

| Scenario | Tabs shown |
|---|---|
| Agent, no logs | Thread \| Notes |
| Agent, with logs | Thread \| Notes \| Logs |
| User, no visible logs | No tabs (just thread content) |
| User, with visible logs | Thread \| Logs |

- The **"Posts"** tab is renamed to **"Thread"** (`data-testid="thread-tab"`) to better convey that it contains the conversation replies rather than the original post.
- New "Logs" tab: `data-testid="logs-tab"`.
- When only `threadContent` is provided (no notes, no logs), the component renders `threadContent` directly without a tab bar.

### Updated page: `page.tsx`

- The original post (`is_original: true`) is rendered **above** all tabs, unconditionally.
- The timeline of root posts no longer includes interleaved activity entries; posts are shown in the Thread tab, activity entries in the Logs tab.
- The existing `timelineItems` interleaved structure is replaced with:
  - `threadItems` — only root posts (non-original)
  - `visibleActivityEntries` — activity log entries filtered by role (non-agents continue to see filtered subset)
- `MainReplyToggle` replaces the inline `ReplyForm` block in both agent and non-agent paths.

---

## Naming rationale

`"Thread"` was chosen over `"Post"` because:
- It signals a *conversation thread* (multiple replies) rather than a single post.
- It aligns with common support/forum terminology.
- It doesn't conflict with the existing `post_type` field vocabulary used internally.

---

## Related files

- `src/app/(main)/tickets/[id]/[slug]/page.tsx` — main ticket detail page
- `src/app/(main)/tickets/[id]/[slug]/TicketTabs.tsx` — tab bar component
- `src/app/(main)/tickets/[id]/[slug]/MainReplyToggle.tsx` — new toggle component
- `src/app/(main)/tickets/[id]/[slug]/ReplyForm.tsx` — unchanged
- `tests/e2e/posts-comments.spec.ts` — E2E tests updated

---

## Test coverage changes

### `posts-comments.spec.ts`

- **`add a reply to the ticket`**: click the **Add a reply** button first to open the form, then submit.
- **`activity log entries display inline`** → renamed to **`activity log entries display in Logs tab`**: navigate to Logs tab, verify entries visible there.
- **`agent sees Posts and Notes tabs`** → updated to check for `thread-tab`, `notes-tab`, and `logs-tab` (logs tab only if logs exist).
- **`regular user does not see tab bar`** → updated to check for absence of `ticket-tabs` when no visible log entries exist for the test ticket.
- New test: **`Reply button opens compose form`** — verifies the `ReplyForm` is hidden initially and appears after clicking Add a reply.

### Follow-up update

Later refinement introduced a shared compose-toggle implementation and standardized submit labels:
- root reply submit button: **Add a reply**
- nested comment submit button: **Add a comment**
- New test: **`Reply form can be cancelled`** — verifies Cancel hides the form again.
- New test: **`Logs tab shows activity entries`** — navigates to Logs tab as agent, checks `data-testid^="activity-"` entries.
