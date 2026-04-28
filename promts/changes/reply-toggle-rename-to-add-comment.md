# Ticket Detail: Rename "Reply" Toggle to "Add a Comment"

## Summary

Rename the "Reply" toggle button on post cards (which opens the comment form) to **"Add a comment"** to eliminate confusion with the main root-reply action.

---

## Motivation

**Current state:**
- Main button to reply to root post: "Add a reply" button
- Toggle to add a comment under a post: "Reply" button
- Comment form submit button: "Add a comment" button

This is confusing because two different actions use the same label. Users see:
- "Add a reply" button at root level → adds a reply to the ticket
- "Add a comment" button under a post → opens a comment form

**Solution:**
Rename the toggle button to "Add a comment" to clearly signal that it opens the comment form, distinct from replying to the root post.

---

## Changes

### `ReplyToggle.tsx`

**Button text:** `"Reply"` → `"Add a comment"`

**Test ID:** `data-testid="reply-btn"` → `data-testid="add-comment-btn"`

---

## Related Files

- `src/app/(main)/tickets/[id]/[slug]/ReplyToggle.tsx` — component updated
- `tests/e2e/posts-comments.spec.ts` — test selectors updated

---

## Test Coverage Changes

All tests that click the toggle button to add a comment will use the new test ID:

```typescript
// Old:
await rootReplyCard.locator('[data-testid="reply-btn"]').click();

// New:
await rootReplyCard.locator('[data-testid="add-comment-btn"]').click();
```

Tests affected:
- `add a comment on a post → comment appears indented`
- `reply to a comment → reply appears at level 2`
- `level-2 comment reply shows action buttons` (if exists)
