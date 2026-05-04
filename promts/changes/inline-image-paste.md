# Inline Image Paste in Post Editor

## Summary

When a user copies / drags / drops an image into the Markdown editor used by
the reply, comment, note, edit and new-ticket forms, the image is uploaded
immediately, a new `attachments` row is created, and a Markdown image
reference (`![filename](signed-url)`) is inserted at the current cursor
position. Once the surrounding post is saved, the orphan attachment is
re-parented to the new post and rendered in the post's `AttachmentList`
exactly like any other attachment.

---

## Motivation

The editor (`react-markdown-editor-lite`) already invokes its `onImageUpload`
callback on paste, drop and toolbar-button events, but until now no composer
wired the prop and there was no server-side endpoint to accept the upload.
That meant a pasted screenshot was silently swallowed by the editor.

The natural ticketing-app behaviour is: paste a screenshot → it shows up
inline in the post and is also listed as a regular file attachment.

---

## Design

### Attachment model — orphan rows

The composer needs to upload an image **before** the parent post exists
(replies, comments, notes, drafts and new tickets are all written before
any post id is known). The schema is therefore extended so an attachment
can temporarily live without a `post_id`:

- Migration `023_inline_image_attachments.sql`
  - `attachments.post_id` is now nullable.
  - New column `uploader_id UUID REFERENCES profiles(id) ON DELETE CASCADE`
    is required when `post_id IS NULL` (CHECK constraint
    `attachments_post_or_uploader`).
  - Backfills `uploader_id` for legacy rows from `posts.author_id`.
  - Partial index `idx_attachments_uploader_orphan` on `(uploader_id)
    WHERE post_id IS NULL`.
  - RLS rewritten: post-bound rows keep their previous behaviour; orphan
    rows (`post_id IS NULL`) are visible / insertable / deletable only by
    their `uploader_id`. A new `attachments_update` policy lets the
    uploader move an orphan onto a freshly-created post.

### Upload flow

1. The Markdown editor calls `onImageUpload(file)`.
2. `uploadInlineImageFromEditor(file)` (client) wraps the file in a
   `FormData` and invokes the `uploadInlineImage` Server Action in
   `src/lib/actions/attachments.ts`.
3. `uploadInlineImage`:
   - Validates: image extension (`png|jpg|jpeg|gif|webp|svg`), MIME type,
     file size against `app_settings.max_file_size_mb` (with subscription
     tier override and a 50 MB hard cap).
   - SVGs are sanitised via the existing `sanitizeSvg` helper.
   - Stores the file at `attachments/inline/{userId}/{uuid}-{filename}`.
   - Inserts an orphan `attachments` row (`post_id = NULL`,
     `uploader_id = user.id`).
   - Returns a 24 h signed URL with the attachment id appended as
     `&att=<uuid>`.
4. The editor inserts `![filename](url)` at the cursor position
   (the library's `uploadWithDataTransfer` already handles paste, drop
   and the toolbar button; once `onImageUpload` is wired, all three work).

### Claiming on save

When the post is finally created or edited, the Server Action calls
`claimInlineAttachments(postId, body)` which:

- Scans `body` for `[?&]att=([0-9a-f-]{36})` substrings.
- Updates matching orphan rows owned by the current user, setting
  `post_id = postId`. RLS prevents claiming someone else's orphan.

Hooks added in `src/lib/actions/tickets.ts`:

- `createTicket` — after the original post insert
- `replyToTicket` — after the reply post insert
- `addComment` — after the comment insert
- `addNote` — after the note insert
- `editPost` — with the existing `postId`
- `saveDraft` — after the draft post insert

The post `.insert(...)` calls were updated to chain `.select('id').single()`
so the new post id is available.

### Wiring in composers

`MarkdownEditor` already exposes `onImageUpload`. The following composers
now pass `uploadInlineImageFromEditor`:

- `src/app/(main)/tickets/[id]/[slug]/ReplyForm.tsx`
- `src/app/(main)/tickets/[id]/[slug]/CommentForm.tsx`
- `src/app/(main)/tickets/[id]/[slug]/NoteForm.tsx`
- `src/app/(main)/tickets/[id]/[slug]/EditablePost.tsx`
- `src/components/features/tickets/TicketForm.tsx`

The shared client helper lives at
`src/components/features/tickets/inlineImageUpload.ts`.

---

## Security

- The Server Action enforces auth, rate-limit-friendly image-only
  validation, MIME / extension matching, and SVG sanitisation, so the
  inline path has the same guarantees as `uploadAttachments`.
- Orphan rows are only readable / mutable by their uploader (RLS).
- The signed URL has a 24-hour expiry — long enough to draft a post but
  not indefinitely accessible. After the post is saved, the existing
  `AttachmentList` regenerates a fresh signed URL for the (re-parented)
  attachment.
- Storage objects use a UUID-prefixed safe filename to prevent
  collision and path-traversal.

---

## Tests

### `tests/e2e/inline-image-paste.spec.ts`

- Pastes a 1×1 PNG into the new-ticket Markdown editor and verifies:
  - the editor inserts a `![…](…&att=<uuid>)` reference at the cursor;
  - submitting the form creates the ticket and the post body still
    references the image;
  - the attachment appears in the rendered `AttachmentList` of the
    original post (claimed by `claimInlineAttachments`).
- Repeats the flow for a reply on an existing ticket using
  `clipboardData.setData('Files', …)` via Playwright.
- Validates that the orphan row is created during paste and re-parented
  on submit by querying the DB with the service-role client.

---

## Related Files

- `supabase/migrations/023_inline_image_attachments.sql` — schema + RLS
- `src/lib/actions/attachments.ts` — `uploadInlineImage`,
  `claimInlineAttachments`
- `src/lib/actions/tickets.ts` — capture post ids, call
  `claimInlineAttachments` after every post create / edit / draft save
- `src/components/features/tickets/inlineImageUpload.ts` — client wrapper
- `src/components/features/tickets/MarkdownEditor.tsx` — already exposed
  `onImageUpload`; no change needed
- `src/app/(main)/tickets/[id]/[slug]/{ReplyForm,CommentForm,NoteForm,EditablePost}.tsx`
  — wire `onImageUpload`
- `src/components/features/tickets/TicketForm.tsx` — wire `onImageUpload`
- `tests/e2e/inline-image-paste.spec.ts` — new e2e coverage
