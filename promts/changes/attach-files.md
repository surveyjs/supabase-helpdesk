# Attach Files to Post Editor

## Summary

The Markdown editor's previous "image upload" toolbar button has been
replaced by an **Attach file(s)** button (paperclip icon `📎`,
`title="Attach file(s)"`) that lets the user attach one or more files of
any allowed type (images, documents, archives — see admin file-upload
settings). The same flow is also triggered by **dragging and dropping**
files onto the editor: a confirmation dialog lists the dropped files and
the user can tick which ones to actually attach.

Each attachment is uploaded as an orphan `attachments` row (`post_id IS
NULL`, `uploader_id = user.id`), exactly like the existing inline-image
flow. Markdown is inserted at the current cursor position:

- Images → `![filename](/attachments/<id>)` (renders inline in the post).
- All other types → `[filename](/attachments/<id>)` (renders as a link
  in the post body). The attachment also appears in the post's
  `AttachmentList` after the post is saved.

When the surrounding post is finally created or edited,
`claimInlineAttachments(postId, body)` re-parents every orphan referenced
in the body — both image and link Markdown — onto the new post.

---

## Motivation

The earlier inline-attachment flow only accepted images (the
`uploadInlineImage` server action validated against
`INLINE_IMAGE_EXTENSIONS`). The product spec (requirements §11.4 / §16.25)
allows attaching any admin-allowed type — PDFs, Office documents,
archives, etc. — but the editor exposed no UI for it: agents had to use
the (now-removed) `FileUpload` drop zone on the saved post. Replies,
comments, notes and new tickets had no way to attach a non-image file.

## Design

### Server action `uploadInlineAttachment`

Lives in `src/lib/actions/attachments.ts`. Mirrors `uploadInlineImage`
but validates against `app_settings.allowed_file_types` (with subscription
tier overrides for size). Returns:

```ts
{
  url: '/attachments/<id>',
  attachmentId: '<uuid>',
  name: '<original filename>',
  mimeType: '<mime>',
  isImage: boolean,
}
```

SVGs are sanitised, filenames are sanitised, the storage path follows
the existing `inline/{userId}/{uuid}-{filename}` convention, and the
50 MB hard cap is honoured. Orphan rows are protected by the existing
RLS policies introduced in migrations 023 / 024.

### Client helper

`src/components/features/tickets/inlineAttachmentUpload.ts` wraps the
server action and returns the descriptor the editor needs.

### Toolbar plugin `AttachFilePlugin`

A `react-markdown-editor-lite` plugin registered alongside
`CannedResponsePlugin`. The button dispatches a bubbling
`mdeditor:request-attach-files` CustomEvent on click; the surrounding
`MarkdownEditor` wrapper listens for it and triggers a hidden
`<input type="file" multiple>`. The dispatched event keeps the plugin
decoupled from React state owned by the wrapper.

### `MarkdownEditor` changes

- New optional prop:

  ```ts
  onAttachmentUpload?: (file: File) => Promise<{
    url: string;
    name: string;
    mimeType: string;
    isImage: boolean;
  }>;
  ```

- The legacy `'image'` toolbar plugin is replaced by `'attach-file'`
  whenever `onAttachmentUpload` is set.
- Wrapper-level capture-phase `dragover` / `drop` listeners intercept
  dropped files **before** the underlying editor sees them, so the user
  always confirms via the dialog (the lib's native drop handler would
  otherwise insert images directly).
- The dialog (`role="dialog"`, `data-testid="attach-files-dialog"`)
  lists each pending file with a checkbox, name, size, MIME type and
  any per-file upload error. **Attach** uploads each selected file and
  inserts Markdown at the textarea's current cursor position; **Cancel**
  discards the selection. Files with errors stay in the dialog so the
  user can retry or remove them.
- Image **paste** still flows through the existing `onImageUpload` prop
  (`uploadInlineImageFromEditor`), unchanged. Drop is now routed
  through the new dialog regardless of file type.

### Wiring

Both Markdown composers wire the new prop alongside the existing
image-paste handler:

- `src/components/features/tickets/TicketForm.tsx`
- `src/app/(main)/tickets/[id]/[slug]/MarkdownActionForm.tsx`
  (used by the reply, comment, note and edit flows)

---

## Security

- The new server action enforces auth, blocks `is_blocked` users, and
  validates file type / size / MIME exactly like `uploadAttachments`.
- SVG sanitisation is reused.
- Orphan rows are only readable / mutable by their uploader; RLS
  policies from migration 024 still apply.
- The dialog uploads through the same `/attachments/<id>` route so the
  user-facing URL never embeds a signed URL.

---

## Tests

- `tests/e2e/attach-files.spec.ts` — selects a non-image file via the
  toolbar button (`setInputFiles` on the hidden input), confirms the
  dialog, verifies the body contains `[filename](/attachments/<uuid>)`
  and the orphan attachment row is created. Submitting the post claims
  the orphan onto the new post.
- The existing `tests/e2e/inline-image-paste.spec.ts` continues to
  cover the image-paste flow via the unchanged `onImageUpload` prop.

---

## Related Files

- `src/lib/actions/attachments.ts` — `uploadInlineAttachment`
- `src/components/features/tickets/inlineAttachmentUpload.ts`
- `src/components/features/tickets/AttachFilePlugin.tsx`
- `src/components/features/tickets/MarkdownEditor.tsx`
- `src/components/features/tickets/TicketForm.tsx`
- `src/app/(main)/tickets/[id]/[slug]/MarkdownActionForm.tsx`
- `tests/e2e/attach-files.spec.ts`
