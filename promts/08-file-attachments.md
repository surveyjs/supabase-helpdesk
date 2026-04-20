# Phase 8 — File Attachments

## Context

You are building file attachment support for a **HelpDesk** application. Read `docs/requirements.md` sections 11.4, 16.25, and `docs/architecture.md` constraints 8, 9.

Phases 0–7 are complete: project init, database schema, authentication, tickets, agent dashboard, taxonomy, posts/comments/notes, and admin setup with sidebar. Posts, comments, and notes are fully functional with threaded comments, editing, deletion, privacy, and drafts.

This phase adds the ability to upload and manage file attachments on posts, comments, and notes, with configurable file type/size limits, Supabase Storage integration, and SVG sanitization.

## Tasks

### 1. Migration: `supabase/migrations/006_attachments.sql`

#### Attachments Table

```sql
CREATE TABLE attachments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  post_id UUID NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  storage_path TEXT NOT NULL,
  original_filename TEXT NOT NULL CHECK (char_length(original_filename) <= 255),
  file_size BIGINT NOT NULL,
  mime_type TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_attachments_post_id ON attachments (post_id);

ALTER TABLE attachments ENABLE ROW LEVEL SECURITY;

-- Attachments inherit post visibility via RLS
-- Users who can see the post can see its attachments
CREATE POLICY attachments_select ON attachments
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM posts p
      WHERE p.id = attachments.post_id
      -- The posts RLS already handles visibility (owner, team, agent, privacy, draft)
    )
  );

-- Authenticated users can insert (the Server Action validates further)
CREATE POLICY attachments_insert ON attachments
  FOR INSERT WITH CHECK (auth.uid() IS NOT NULL);

-- Author or agent can delete
CREATE POLICY attachments_delete ON attachments
  FOR DELETE USING (
    EXISTS (
      SELECT 1 FROM posts p
      WHERE p.id = attachments.post_id
      AND (p.author_id = auth.uid() OR is_agent())
    )
  );
```

> **Note on attachments_select policy:** The inner `EXISTS` subquery relies on the `posts` table's own RLS policies to filter visibility. This means if a user cannot SELECT the parent post (because it's a private post, note, or draft they lack access to), the attachment row is also hidden. Test this carefully — Supabase evaluates RLS policies on both the outer and inner tables.

#### File Upload Settings in app_settings

```sql
INSERT INTO app_settings (key, value) VALUES
  ('allowed_file_types', '["png","jpg","jpeg","gif","webp","svg","pdf","doc","docx","xls","xlsx","txt","csv","md","zip","rar","7z","tar.gz"]'),
  ('max_file_size_mb', '10'),
  ('max_files_per_post', '5')
ON CONFLICT (key) DO NOTHING;
```

### 2. Supabase Storage Setup

Create a Supabase Storage bucket for attachments.

**`supabase/config.toml`** — add storage bucket configuration (or document manual setup):

The bucket should be named `attachments` with RLS enabled. Access policies:
- **SELECT (download)**: authenticated users who can view the parent post (via the attachment's post_id → post visibility)
- **INSERT (upload)**: authenticated, non-blocked users
- **DELETE**: post author or agent

> **Implementation approach:** Since Supabase Storage RLS policies don't have direct access to the `attachments` table for cross-referencing, use a two-step approach:
> 1. Upload files to Storage with a path pattern: `tickets/{ticketId}/posts/{postId}/{uuid}-{filename}`
> 2. Insert a record in the `attachments` table linking `post_id`, `storage_path`, and metadata
> 3. For downloads, generate signed URLs server-side only when the user has access to the parent post (verified via the server Supabase client which respects posts RLS)
>
> This avoids complex Storage RLS policies. The `attachments` table RLS handles access control; the Storage bucket uses a simple "authenticated users can upload" policy, and downloads are gated by signed URLs generated in Server Actions.

### 3. SVG Sanitization

**`src/lib/utils/svg-sanitize.ts`** (new file):
- Install a SVG sanitization library: `npm install dompurify` (or `isomorphic-dompurify` for server-side)
- Create `sanitizeSvg(buffer: Buffer): Buffer` function:
  - Parse the SVG content
  - Strip: `<script>` tags, event handler attributes (`onclick`, `onload`, `onerror`, etc.), `javascript:` URLs, `data:` URLs in `xlink:href`, foreign objects embedding scripts
  - Return sanitized SVG buffer
- This function is called before uploading any `.svg` file to Storage

### 4. Server Actions

**`src/lib/actions/attachments.ts`** (new file):

- `uploadAttachments(formData)`:
  - Require authenticated user, not blocked
  - Extract: `post_id`, files from formData
  - Fetch the post — verify user has access to the ticket
  - Read file upload settings from `app_settings`:
    - `allowed_file_types`: validate each file's extension matches
    - `max_file_size_mb`: validate each file's size
    - `max_files_per_post`: count existing attachments on the post + new files, reject if exceeds limit
  - **MIME type validation**: Check both the file extension AND the `Content-Type` header match (prevent extension spoofing)
  - For SVG files: sanitize content before upload
  - Upload each file to Supabase Storage: `attachments/tickets/{ticketId}/posts/{postId}/{uuid}-{sanitizedFilename}`
  - Insert row in `attachments` table for each file
  - Log file upload in `activity_log` (filename + post reference)
  - Revalidate page

- `deleteAttachment(attachmentId)`:
  - Fetch the attachment and its parent post
  - Verify: post author or agent
  - Delete file from Supabase Storage
  - Delete row from `attachments` table
  - Log file deletion in `activity_log`
  - Revalidate page

- `getAttachmentUrl(attachmentId)`:
  - Fetch the attachment
  - Verify user has access to the parent post (the posts RLS will handle this if querying through the authenticated client)
  - Generate a signed URL from Supabase Storage (time-limited, e.g., 1 hour)
  - Return the URL

### 5. UI Components

**`src/components/features/attachments/FileUpload.tsx`**:
- `"use client"` component (needed for file input handling and preview)
- File input with drag-and-drop zone
- Client-side validation:
  - File type check against allowed types (fetched from server or passed as props)
  - File size check
  - File count check
- Show selected files list with remove buttons before upload
- Upload progress indicator (optional — Supabase Storage provides upload progress)
- After upload: files appear below the post body
- **Note:** The post form now uses `MarkdownEditor` (from the ticket detail redesign). File attachments remain as a separate component below each post. The `FileUpload` component is unchanged.

**`src/components/features/attachments/AttachmentList.tsx`**:
- Server Component
- Renders the list of attachments below a post body
- For images (png, jpg, jpeg, gif, webp): show inline thumbnail preview (use signed URL, <img> with max-width constraint)
- For SVG: show thumbnail preview (sanitized content is safe)
- For other files: show file icon, original filename, file size, and a "Download" link (signed URL)
- For post author/agents: show "Delete" button on each attachment

### 6. Update Post Forms

Update all post/comment/note forms to include file attachment capability:

**Reply form** (`src/app/(main)/tickets/[id]/[slug]/page.tsx` and related components):
- Add file upload input below the textarea
- Submit uploads the text content AND the files together
- Implementation approach: submit the text first (creating the post), then upload files to the created post_id. This avoids large multipart form submissions in Server Actions.

**Comment and Note forms**: same pattern — create the post/comment/note first, then upload attachments.

**Edit post**: allow adding/removing attachments when editing (via separate attachment upload/delete actions on the existing post).

### 7. Admin File Upload Settings (§16.25)

**`src/app/(main)/admin/file-settings/page.tsx`**:
- **Allowed file types**: show the current list as editable chips/tags. Admin can add (extension input + add button) or remove extensions. Each shows the extension. A "Reset to defaults" button restores the default list.
- **Maximum file size**: numeric input in MB (min 1, max 50, default 10)
- **Maximum files per post**: numeric input (min 1, max 20, default 5)
- "Save" button for size/count settings
- Log changes to admin audit log

**Server Actions** (add to `src/lib/actions/admin.ts`):
- `updateFileSettings(allowedTypes, maxSizeMb, maxFilesPerPost)` — require admin, validate ranges, update `app_settings`, log audit, revalidate
- `resetFileTypesToDefault()` — require admin, restore default list, log audit, revalidate

### 8. Update Admin Sidebar

Add a new section to the admin sidebar:
- "File Uploads" → `/admin/file-settings` (add after "Rate Limit" section)

### 9. Tests

**`tests/db/008-attachments.test.ts`** (new file):
- Attachment is visible when parent post is visible (RLS)
- Attachment is hidden when parent post is private and viewer is unauthorized
- Attachment is hidden when parent post is a draft (for non-agents)
- Attachment is hidden when parent post is a note (for non-agents)
- Author can delete own attachment
- Agent can delete any attachment
- Regular user cannot delete another user's attachment
- Attachment is CASCADE-deleted when parent post is deleted
- File metadata (filename, size, mime_type) stored correctly
- Filename length constraint enforced (max 255 chars)

**`tests/e2e/attachments.spec.ts`** (new file):
- Upload a file to a post → attachment appears below post
- Upload an image → inline thumbnail preview shown
- Upload a non-image file → filename + download link shown
- Download link works (signed URL)
- File type validation: uploading a disallowed type shows error
- File size validation: uploading a too-large file shows error
- File count validation: exceeding max files per post shows error
- Delete an attachment → attachment disappears
- Agent can delete any user's attachment
- SVG upload: SVG with script tag is sanitized (script stripped)
- Admin file settings: change allowed types, verify enforcement
- Admin file settings: change max size, verify enforcement

## Implementation Notes

- **Signed URLs**: All file downloads go through signed URLs generated server-side. This avoids exposing Storage bucket paths directly and ensures access control is enforced through the `attachments` table RLS.
- **Upload flow**: The recommended approach is a two-phase process: (1) Create the post via Server Action, getting back the post_id. (2) Upload files to Storage and create `attachments` rows in a second Server Action. This is simpler than handling multipart uploads in a single Server Action.
- **Storage path format**: `attachments/tickets/{ticketId}/posts/{postId}/{uuid}-{filename}` — the UUID prefix prevents filename collisions.
- **Image thumbnails**: Use CSS `max-width: 200px; max-height: 200px; object-fit: contain` for inline thumbnail previews. Do not create actual thumbnail image variants.
- **SVG sanitization**: Must happen server-side before storage. The library strips all potentially dangerous elements while preserving valid SVG rendering.
- `dompurify` or `isomorphic-dompurify` works well for server-side SVG sanitization. Configure it to allow SVG elements (`<svg>`, `<circle>`, `<path>`, `<rect>`, etc.) while stripping script-related content.

## Deferred Features (Added by Later Phases)

- Inbound email attachment handling — Phase 18
- Per-tier file size and count overrides — Phase 20

## Verification Checklist

- [ ] Files can be uploaded to posts, comments, and notes
- [ ] Image files show inline thumbnail preview
- [ ] Non-image files show filename, size, and download link
- [ ] Download links use signed URLs and work correctly
- [ ] File type validation enforced (client + server)
- [ ] File size validation enforced (client + server)
- [ ] File count per post enforced
- [ ] SVG files are sanitized before storage
- [ ] Attachments inherit post visibility (private posts → private attachments)
- [ ] Author and agents can delete attachments
- [ ] Post deletion cascades to attachments (DB + Storage)
- [ ] Admin file settings page works (types, size, count)
- [ ] Activity log records uploads and deletions
- [ ] `npm run typecheck` passes with no errors
- [ ] `npm run lint` passes with no errors
- [ ] `npm run test:db` passes attachment tests
- [ ] `npm run test:e2e` passes attachment e2e tests
