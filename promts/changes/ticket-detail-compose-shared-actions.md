# Ticket Detail: Shared Compose Toggle for Replies/Comments

## Summary

Unify reply/comment creation UX with shared toggle behavior and explicit labels:

- Root reply composer: **Add a reply** + **Cancel**
- Comment composer under posts/replies: **Add a comment** + **Cancel**

Also ensure the trigger button is hidden while the corresponding composer is open.

## Motivation

There were multiple overlapping labels and flows:

- Root action used "Reply"
- Nested action used "Add a comment"
- Submit labels were inconsistent ("Reply", "Comment")

This made it unclear whether the user is adding a root reply or a nested comment. The update clarifies intent and standardizes behavior.

## Changes

### 1. Shared toggle component

Added `ComposerToggle.tsx` to encapsulate common open/close behavior for compose sections.

Responsibilities:
- Render trigger button when closed
- Render compose panel when open and pass a `close()` callback to the child form
- Hide trigger while open (for the active composer only)

### 2. Root reply flow

`MainReplyToggle.tsx` now uses `ComposerToggle`:
- Trigger label: **Add a reply**
- Panel title: **Add a reply**
- Cancel button remains available while composing
- Main trigger button is hidden while the reply composer is open

`ReplyForm.tsx` submit label updated:
- Default submit label: **Add a reply**

### 3. Nested comment flow

`ReplyToggle.tsx` now uses `ComposerToggle`:
- Trigger label: **Add a comment**
- Cancel button available while composing
- "Add a comment" trigger hidden while that comment form is open

`CommentForm.tsx` submit label updated:
- Default submit label: **Add a comment**

## Files

- `src/app/(main)/tickets/[id]/[slug]/ComposerToggle.tsx` (new)
- `src/app/(main)/tickets/[id]/[slug]/MainReplyToggle.tsx`
- `src/app/(main)/tickets/[id]/[slug]/ReplyToggle.tsx`
- `src/app/(main)/tickets/[id]/[slug]/ReplyForm.tsx`
- `src/app/(main)/tickets/[id]/[slug]/CommentForm.tsx`
- `tests/e2e/posts-comments.spec.ts`
- `tests/e2e/tickets.spec.ts`

## Test updates

Updated button-name based assertions/clicks:
- `Reply` -> `Add a reply`
- `Comment` -> `Add a comment`

No behavior change to threading depth rules:
- Level-2 comments still cannot spawn deeper comment actions.
