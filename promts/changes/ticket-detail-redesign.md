# Change: Ticket Detail Page Redesign

## Summary

Redesign the ticket detail page with three major improvements:
1. **Rich Markdown editor** — Replace plain textareas with a full-featured Markdown editor supporting live preview, code snippets, toolbar, and file attachment integration
2. **Two-column layout** — Subject & posts/notes on the left (main area), ticket metadata & controls on the right (sidebar)
3. **Posts/Notes tab separation** — Posts and replies visible to all users; internal notes shown under a separate "Notes" tab visible only to agents. Regular users see no tabs (just the posts stream).

---

## 1. Rich Markdown Editor Component

### New Dependencies

Install `react-markdown-editor-lite` and a markdown parser:

```bash
npm install react-markdown-editor-lite markdown-it
```

`react-markdown-editor-lite` provides:
- Editor / Preview / Split (side-by-side) modes
- Built-in toolbar: bold, italic, strikethrough, headings, links, images, quotes, ordered/unordered lists, code (inline + fenced blocks), tables, horizontal rules
- **Native image upload support** — `onImageUpload` prop handles drag-and-drop, paste, and toolbar upload button; returns a Promise resolving with the uploaded URL
- Pluggable toolbar (custom plugins via `MdEditor.use()`)
- Custom markdown parser — uses `markdown-it` (or any parser returning HTML/ReactElement)
- Synced scrolling between editor and preview
- Compatible with server-side rendering (use `dynamic` import with `ssr: false`)

### Abstraction Layer — Why It Matters

**All editor usage MUST go through a single wrapper component: `MarkdownEditor.tsx`.** No other file should import `react-markdown-editor-lite` directly. This ensures:
- Swapping to a different editor library (e.g., `@uiw/react-md-editor`, `milkdown`, `tiptap`) requires changing **only one file**
- Consistent props interface (`name`, `value`, `compact`, `onValueChange`, `onImageUpload`) across the entire app
- Centralized SSR-safe dynamic import, theme config, and plugin registration

### Replace `MarkdownPreview.tsx`

**`src/components/features/tickets/MarkdownEditor.tsx`** (new file, replaces `MarkdownPreview.tsx`):

```tsx
'use client';

import dynamic from 'next/dynamic';
import { useState, useCallback } from 'react';
import MarkdownIt from 'markdown-it';

// Import react-markdown-editor-lite with SSR disabled (it depends on browser APIs)
const MdEditor = dynamic(() => import('react-markdown-editor-lite'), { ssr: false });

// Import editor styles
import 'react-markdown-editor-lite/lib/index.css';

// Initialize markdown parser (shared instance)
const mdParser = new MarkdownIt({ html: false, linkify: true, typographer: true });

export interface MarkdownEditorProps {
  name: string;
  defaultValue?: string;
  required?: boolean;
  maxLength?: number;
  placeholder?: string;
  compact?: boolean;
  onValueChange?: (value: string) => void;
  /** Called when user uploads an image (drag/drop/paste/toolbar). Return the image URL. */
  onImageUpload?: (file: File) => Promise<string>;
}

export function MarkdownEditor({
  name,
  defaultValue,
  required,
  maxLength,
  placeholder,
  compact,
  onValueChange,
  onImageUpload,
}: MarkdownEditorProps) {
  const [value, setValue] = useState(defaultValue ?? '');

  const handleChange = useCallback(({ text }: { text: string }) => {
    setValue(text);
    onValueChange?.(text);
  }, [onValueChange]);

  const handleImageUpload = useCallback(async (file: File): Promise<string> => {
    if (onImageUpload) {
      return onImageUpload(file);
    }
    // Fallback: convert to data URI (not recommended for production)
    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = (e) => resolve(e.target?.result as string);
      reader.readAsDataURL(file);
    });
  }, [onImageUpload]);

  return (
    <div data-testid="markdown-editor">
      {/* Hidden textarea for form submission (keeps form action working) */}
      <textarea
        name={name}
        value={value}
        required={required}
        maxLength={maxLength}
        readOnly
        hidden
        aria-hidden="true"
      />
      <MdEditor
        value={value}
        onChange={handleChange}
        renderHTML={(text) => mdParser.render(text)}
        onImageUpload={handleImageUpload}
        style={{ height: compact ? '150px' : '250px' }}
        placeholder={placeholder ?? 'Write using Markdown…'}
        view={{ menu: true, md: true, html: !compact }}
        canView={{ menu: true, md: true, html: true, fullScreen: false, hideMenu: false }}
      />
    </div>
  );
}
```

**Key behaviors:**
- **Single abstraction layer** — this is the ONLY file that imports `react-markdown-editor-lite`. Changing editors means modifying only this component.
- Wraps `react-markdown-editor-lite` with SSR-safe dynamic import
- Hidden `<textarea>` with `name` attribute to integrate with existing Server Action form submissions (the editor manages state, the hidden field submits)
- `compact` prop for smaller comment/note forms (hides preview panel by default)
- `onValueChange` callback for integration with parent components (e.g., AI suggestion injection, canned response insertion)
- `onImageUpload` prop — receives a `File`, must return a `Promise<string>` with the URL. The editor supports drag-and-drop, paste, and toolbar upload natively.
- Uses `markdown-it` for preview rendering (consistent with server-side rendering config)

### Public API for External Insertion

For integrations like canned responses and AI suggested replies, expose a way to insert text:

```tsx
// In ReplyForm.tsx — pass a callback to set editor value
const [replyBody, setReplyBody] = useState('');

function handleInsertCanned(body: string) {
  setReplyBody((prev) => prev + body);
}

<MarkdownEditor
  name="body"
  defaultValue={replyBody}
  onValueChange={setReplyBody}
  ...
/>
```

The `SuggestReplyButton` and `CannedResponsePicker` should set the editor value via the parent component's state rather than directly manipulating a textarea ref.

### Where the Editor Is Used

Replace the plain `<textarea>` with `<MarkdownEditor>` in:

| Component | Current | New |
|-----------|---------|-----|
| `ReplyForm.tsx` | `<textarea name="body" aria-label="Reply body">` | `<MarkdownEditor name="body" placeholder="Write your reply…">` |
| `NoteForm.tsx` | `<textarea name="body" aria-label="Note body">` | `<MarkdownEditor name="body" compact placeholder="Write an internal note…">` |
| `CommentForm.tsx` | `<textarea name="body" aria-label="Comment body">` | `<MarkdownEditor name="body" compact placeholder="Write a comment…">` |
| `EditablePost.tsx` (edit mode) | `<textarea name="body">` | `<MarkdownEditor name="body">` |
| `TicketForm.tsx` (create ticket description) | `<MarkdownPreview name="body">` | `<MarkdownEditor name="body" placeholder="Describe your issue…">` |

**Keep the old `MarkdownPreview.tsx`** — it's no longer used in forms, but keep it as a deprecated file (or delete it). All form inputs now use `MarkdownEditor`.

### File Attachment Integration in Editor

`react-markdown-editor-lite` has **native image upload support** via the `onImageUpload` prop. When a user drags/drops, pastes, or uses the toolbar image button, the editor calls this handler and automatically inserts `![filename](url)` into the editor content.

Implement the `onImageUpload` handler to upload to Supabase Storage and return the signed URL:

```tsx
// In ReplyForm.tsx (or wherever MarkdownEditor is used with attachments)
async function handleImageUpload(file: File): Promise<string> {
  const formData = new FormData();
  formData.append('file', file);
  // Use the existing upload server action or API endpoint
  const result = await uploadAttachment(formData, ticketId, postId);
  return result.signedUrl; // The editor inserts ![filename](signedUrl) automatically
}

<MarkdownEditor
  name="body"
  onImageUpload={handleImageUpload}
  ...
/>
```

The existing `FileUpload` component remains for non-image attachments (PDFs, zips, etc.) and is shown below each post in `AttachmentList`. Images dropped into the editor are **also** stored as attachments in the database for consistency.

**Note:** If the `onImageUpload` prop is not provided to `MarkdownEditor`, the editor falls back to a data URI (for development/preview only). In production forms, always pass the Supabase upload handler.

---

## 2. Two-Column Layout

### Layout Structure

Replace the current single-column vertical layout with a two-column design:

```
┌──────────────────────────────────────────────────────────────────┐
│  ← My Tickets    ← Agent Dashboard                              │
├─────────────────────────────────────┬────────────────────────────┤
│  MAIN CONTENT (left, ~65-70%)       │  SIDEBAR (right, ~30-35%)  │
│                                     │                            │
│  [Duplicate/Merge banners]          │  Ticket Metadata           │
│                                     │  - Status badge            │
│  Subject (editable title)           │  - Urgency/Severity badges │
│  #123 · open · 2h ago              │  - Type                    │
│                                     │  - Category                │
│  ┌─[Posts]──[Notes (agents)]──┐     │  - Created by (+ team)     │
│  │                            │     │  - Assigned to             │
│  │  Original post             │     │  - Created / Updated dates │
│  │  ├─ Comment 1              │     │  - SLA Status (agents)     │
│  │  │  └─ Reply to comment    │     │  - CSAT rating             │
│  │  Activity log entry        │     │  - Tags                    │
│  │  Post 2                    │     │  - Custom fields           │
│  │  Post 3                    │     │  - Follow/Unfollow         │
│  │                            │     │                            │
│  │  [Show X older posts]      │     │  Agent Controls            │
│  │                            │     │  - Status buttons          │
│  │  Reply form (editor)       │     │  - Assignment              │
│  │                            │     │  - Urgency/Severity        │
│  └────────────────────────────┘     │  - Type/Category           │
│                                     │  - Privacy toggle          │
│                                     │  - Duplicate/Merge         │
│                                     │  - Delete (admin)          │
│                                     │  - KB Article gen          │
│                                     │                            │
│                                     │  Tier Controls (users)     │
│                                     │                            │
│                                     │  User Notes (agents)       │
│                                     │  AI Summary (agents)       │
│                                     │                            │
│                                     │  Source Article (agents)   │
│                                     │  Followers (agents)        │
└─────────────────────────────────────┴────────────────────────────┘
```

### Implementation

Update `src/app/(main)/tickets/[id]/[slug]/page.tsx`:

```tsx
return (
  <div>
    {/* Back links */}
    <div className="flex items-center gap-4 mb-4">
      <Link href="/tickets">← My Tickets</Link>
      {isAgent && <Link href="/agent">← Agent Dashboard</Link>}
    </div>

    {/* Duplicate / Merge banners — full width */}
    {ticket.duplicate_of_id && ( /* ... existing banner ... */ )}
    {ticket.merged_into_id && ( /* ... existing banner ... */ )}

    {/* Two-column layout */}
    <div className="flex flex-col lg:flex-row gap-6">
      {/* LEFT: Main content area */}
      <div className="flex-1 min-w-0" data-testid="ticket-main-content">
        {/* Subject */}
        <div className="mb-4">
          <EditableTitle ticketId={ticket.id} title={ticket.title} canEdit={canEditTitle} />
          <div className="flex items-center gap-2 mt-1 text-sm text-gray-500">
            <span>#{ticket.id}</span>
            <span>·</span>
            <Badge variant="status" value={ticket.status} />
            <span>·</span>
            <time>{formatTime(ticket.created_at)}</time>
          </div>
        </div>

        {/* Posts / Notes tabs (agents see two tabs, users see only posts — no tab bar) */}
        {isAgent ? (
          <TicketTabs
            postsContent={/* posts timeline + reply form */}
            notesContent={/* notes list + note form */}
            noteCount={noteCount}
          />
        ) : (
          /* Users: just render posts stream directly, no tabs */
          <div>
            {/* posts timeline + reply form */}
          </div>
        )}
      </div>

      {/* RIGHT: Sidebar */}
      <aside className="w-full lg:w-80 xl:w-96 flex-shrink-0" data-testid="ticket-sidebar">
        {/* Ticket metadata card */}
        <div className="bg-white rounded-lg border border-gray-200 p-4 mb-4 sticky top-4">
          {/* ... all metadata fields moved here ... */}
        </div>

        {/* Agent controls card */}
        {isAgent && !ticket.merged_into_id && (
          <div className="bg-white rounded-lg border border-gray-200 p-4 mb-4" data-testid="agent-controls">
            {/* ... agent controls moved here ... */}
          </div>
        )}

        {/* Tier controls (non-agent users with tier capabilities) */}
        {!isAgent && hasAnyTierCap && !ticket.merged_into_id && (
          <div className="bg-white rounded-lg border border-gray-200 p-4 mb-4" data-testid="tier-controls">
            {/* ... tier controls moved here ... */}
          </div>
        )}

        {/* User Notes (agents only) */}
        {isAgent && creatorNoteCount > 0 && ( /* ... */ )}

        {/* AI Summary (agents only) */}
        {isAgent && aiTicketSummaryEnabled && allPosts.length >= aiTicketSummaryMinPosts && (
          <AiTicketSummary ticketId={ticket.id} />
        )}
      </aside>
    </div>

    <RealtimeTicketUpdates ticketId={ticket.id} />
  </div>
);
```

### Responsive Behavior

- **Desktop (lg and above):** Two-column layout, sidebar on the right
- **Mobile/Tablet (below lg):** Single column — sidebar content stacks below the main content area
- Sidebar uses `sticky top-4` so it stays visible when scrolling long ticket threads on desktop

---

## 3. Posts / Notes Tab Separation

### New Client Component: `TicketTabs.tsx`

**`src/app/(main)/tickets/[id]/[slug]/TicketTabs.tsx`**:

```tsx
'use client';

import { useState } from 'react';

export function TicketTabs({
  postsContent,
  notesContent,
  noteCount,
}: {
  postsContent: React.ReactNode;
  notesContent: React.ReactNode;
  noteCount: number;
}) {
  const [activeTab, setActiveTab] = useState<'posts' | 'notes'>('posts');

  return (
    <div data-testid="ticket-tabs">
      <div className="flex border-b border-gray-200 mb-4" role="tablist">
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === 'posts'}
          onClick={() => setActiveTab('posts')}
          className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px ${
            activeTab === 'posts'
              ? 'border-blue-600 text-blue-600'
              : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
          }`}
          data-testid="posts-tab"
        >
          Posts
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === 'notes'}
          onClick={() => setActiveTab('notes')}
          className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px ${
            activeTab === 'notes'
              ? 'border-amber-600 text-amber-600'
              : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
          }`}
          data-testid="notes-tab"
        >
          Notes
          {noteCount > 0 && (
            <span className="ml-1.5 inline-flex items-center px-1.5 py-0.5 rounded-full text-xs font-medium bg-amber-100 text-amber-700">
              {noteCount}
            </span>
          )}
        </button>
      </div>

      <div role="tabpanel">
        {activeTab === 'posts' ? postsContent : notesContent}
      </div>
    </div>
  );
}
```

### Content Organization

**Posts tab** (visible to everyone):
- Original post (always first)
- Collapsible timeline of root posts (not notes) + activity log entries, interleaved chronologically
- Comments/replies threaded under their parent posts
- Reply form at the bottom (with `MarkdownEditor`)
- No notes appear in this tab

**Notes tab** (visible only to agents):
- List of all internal notes for this ticket, sorted chronologically (oldest first)
- Each note shows: author, timestamp, body (rendered Markdown), edit/delete buttons
- Note form at the bottom (with `MarkdownEditor compact`)
- Only posts where `post_type = 'note'` appear here

### Separation Logic

In the server component, split the rendered posts:

```tsx
// Separate notes from regular posts/comments
const notePosts = renderedPosts.filter((p) => p.post_type === 'note');
const nonNotePosts = renderedPosts.filter((p) => p.post_type !== 'note');

// Build timeline from non-note posts only
const rootPosts = nonNotePosts.filter(
  (p) => !p.is_original && !p.parent_post_id && !p.parent_comment_id && p.post_type !== 'comment',
);
// ... rest of timeline building uses non-note posts only ...

const noteCount = notePosts.length;
```

### User View (No Tabs)

Regular users never see the "Notes" tab. They see:
- Just the posts stream directly (no tab bar, no tab buttons)
- Same layout as the current "Posts" tab content
- The `TicketTabs` component is only rendered for agents

```tsx
{isAgent ? (
  <TicketTabs
    postsContent={renderPostsTabContent()}
    notesContent={renderNotesTabContent()}
    noteCount={noteCount}
  />
) : (
  renderPostsTabContent()
)}
```

---

## 4. Data-TestID Summary

New and updated `data-testid` attributes:

| Element | data-testid |
|---------|-------------|
| Main content area | `ticket-main-content` |
| Sidebar | `ticket-sidebar` |
| Tab container (agents only) | `ticket-tabs` |
| Posts tab button | `posts-tab` |
| Notes tab button | `notes-tab` |
| Markdown editor wrapper | `markdown-editor` |
| Existing: agent controls | `agent-controls` (unchanged) |
| Existing: tier controls | `tier-controls` (unchanged) |
| Existing: all post/activity testids | unchanged |

---

## 5. E2E Test Updates

### `tests/e2e/posts-comments.spec.ts`

**Updated tests:**

- **"add a reply to the ticket"**: The reply form now uses `MarkdownEditor`. Instead of `page.getByLabel('Reply body').fill(...)`, interact with the editor:
  ```typescript
  // The MarkdownEditor renders a contenteditable area or textarea inside the MDEditor wrapper
  // Target the textarea within the editor component
  const editor = page.locator('[data-testid="markdown-editor"]').last();
  await editor.locator('textarea').fill('A root reply to the ticket.');
  ```
  The submit button selector stays the same (find the "Reply" button inside the form).

- **"agent can add an internal note"**: The note form now uses `MarkdownEditor`. Additionally, notes are now under a separate tab:
  ```typescript
  // Agent must click the Notes tab first
  await page.getByTestId('notes-tab').click();
  // Then fill the note form
  const noteEditor = page.locator('[data-testid="markdown-editor"]').last();
  await noteEditor.locator('textarea').fill('Internal agent note content.');
  await page.getByRole('button', { name: 'Add Note' }).click();
  ```

- **"note not visible to regular user"**: Now verify that the user does not see any tab bar (no `ticket-tabs` element) AND the note content is not visible:
  ```typescript
  await expect(page.getByTestId('ticket-tabs')).not.toBeVisible();
  await expect(page.getByText('Internal agent note content.')).not.toBeVisible();
  ```

- **"add a comment on a post"**: Comment form now uses `MarkdownEditor`. Update the fill selector to target the editor textarea.

- **"edit a post"**: The edit mode now renders `MarkdownEditor` instead of a plain textarea. Update:
  ```typescript
  const editEditor = page.locator('[data-testid="markdown-editor"]').first();
  await editEditor.locator('textarea').clear();
  await editEditor.locator('textarea').fill('Edited root reply content.');
  ```

- **All ticket metadata checks**: Metadata (type, urgency, etc.) has moved to the sidebar. Update selectors:
  ```typescript
  // Metadata is now in the sidebar
  const sidebar = page.getByTestId('ticket-sidebar');
  await expect(sidebar.getByText('Issue')).toBeVisible();
  await expect(sidebar.getByText(/Urgency: High/)).toBeVisible();
  ```

### `tests/e2e/tickets.spec.ts`

**Updated tests:**

- **"ticket detail shows correct metadata and posts"**: Metadata is now in the sidebar:
  ```typescript
  const sidebar = page.getByTestId('ticket-sidebar');
  await expect(sidebar.getByRole('definition').filter({ hasText: 'Issue' })).toBeVisible();
  await expect(sidebar.getByText(/Urgency: High/)).toBeVisible();
  ```

- **"reply to a ticket"**: Use MarkdownEditor:
  ```typescript
  const editor = page.locator('[data-testid="markdown-editor"]').last();
  await editor.locator('textarea').fill('This is a test reply from E2E.');
  ```

- **"create a ticket with all fields"**: The ticket creation form now uses `MarkdownEditor` for the description field. Update the description fill:
  ```typescript
  // Description field now uses MarkdownEditor
  const descEditor = page.locator('[data-testid="markdown-editor"]');
  await descEditor.locator('textarea').fill('This is a test ticket created by E2E test. **Bold text** and `code`.');
  ```

- **"ticket detail shows team name next to creator display name"**: Team name is now in the sidebar.

### `tests/e2e/advanced-tickets.spec.ts`

**Updated tests:**

- **"merged ticket stub is read-only — no reply form"**: Update to check there's no Reply section in the main content area:
  ```typescript
  await expect(page.getByTestId('ticket-main-content').getByRole('heading', { name: 'Reply' })).not.toBeVisible({ timeout: 3000 });
  ```

- **Agent controls checks**: Now scoped to the sidebar:
  ```typescript
  await expect(page.getByTestId('ticket-sidebar').getByTestId('agent-controls')).not.toBeVisible();
  ```

### `tests/e2e/attachments.spec.ts`

**Updated tests:**

- **"file upload drop zone is visible on post"**: No change needed (drop zone is within the post card, which is in the main content area).

- All file-related selectors are unchanged since `AttachmentList` and `FileUpload` stay within post cards.

### New Tests

Add these tests to `tests/e2e/posts-comments.spec.ts`:

- **"two-column layout: sidebar shows metadata"**: Verify that the sidebar exists and contains expected metadata fields:
  ```typescript
  test('two-column layout: sidebar shows metadata', async ({ page }) => {
    await loginAs(page, 'alice@example.com');
    await page.goto(ticketUrl || await resolveTicketUrl());
    
    const sidebar = page.getByTestId('ticket-sidebar');
    await expect(sidebar).toBeVisible();
    await expect(sidebar.getByText('Type')).toBeVisible();
    await expect(sidebar.getByText('Created by')).toBeVisible();
  });
  ```

- **"agent sees Posts and Notes tabs"**: Verify that the tab bar appears for agents:
  ```typescript
  test('agent sees Posts and Notes tabs', async ({ page }) => {
    await loginAs(page, 'agent.smith@example.com');
    await page.goto(ticketUrl || await resolveTicketUrl());
    
    await expect(page.getByTestId('ticket-tabs')).toBeVisible();
    await expect(page.getByTestId('posts-tab')).toBeVisible();
    await expect(page.getByTestId('notes-tab')).toBeVisible();
  });
  ```

- **"Notes tab shows note count badge when notes exist"**: When there are internal notes, the Notes tab must display the count in a badge:
  ```typescript
  test('Notes tab shows note count badge when notes exist', async ({ page }) => {
    await loginAs(page, 'agent.smith@example.com');
    await page.goto(ticketUrl || await resolveTicketUrl());
    
    const notesTab = page.getByTestId('notes-tab');
    await expect(notesTab).toBeVisible();
    const badge = notesTab.locator('span');
    await expect(badge).toBeVisible();
    await expect(badge).toHaveText(/\d+/);
  });
  ```

- **"regular user does not see tab bar"**: Verify no tabs for users:
  ```typescript
  test('regular user does not see tab bar', async ({ page }) => {
    await loginAs(page, 'alice@example.com');
    await page.goto(ticketUrl || await resolveTicketUrl());
    
    await expect(page.getByTestId('ticket-tabs')).not.toBeVisible();
  });
  ```

- **"markdown editor shows toolbar"**: Verify the editor has formatting toolbar:
  ```typescript
  test('markdown editor shows toolbar', async ({ page }) => {
    await loginAs(page, 'alice@example.com');
    await page.goto(ticketUrl || await resolveTicketUrl());
    
    const editor = page.locator('[data-testid="markdown-editor"]').first();
    await expect(editor).toBeVisible();
    // react-markdown-editor-lite renders a toolbar with .rc-md-editor class
    await expect(editor.locator('.rc-md-navigation')).toBeVisible();
  });
  ```

---

## 6. Files Modified

### Source Files

| File | Action | Description |
|------|--------|-------------|
| `src/components/features/tickets/MarkdownEditor.tsx` | **Create** | New rich Markdown editor component |
| `src/components/features/tickets/MarkdownPreview.tsx` | **Delete or deprecate** | Replaced by MarkdownEditor |
| `src/app/(main)/tickets/[id]/[slug]/page.tsx` | **Major update** | Two-column layout, tabs, note separation |
| `src/app/(main)/tickets/[id]/[slug]/TicketTabs.tsx` | **Create** | Tab switcher for Posts/Notes (agents) |
| `src/app/(main)/tickets/[id]/[slug]/ReplyForm.tsx` | **Update** | Use MarkdownEditor instead of textarea |
| `src/app/(main)/tickets/[id]/[slug]/NoteForm.tsx` | **Update** | Use MarkdownEditor compact mode |
| `src/app/(main)/tickets/[id]/[slug]/CommentForm.tsx` | **Update** | Use MarkdownEditor compact mode |
| `src/app/(main)/tickets/[id]/[slug]/EditablePost.tsx` | **Update** | Use MarkdownEditor in edit mode |
| `src/components/features/tickets/TicketForm.tsx` | **Update** | Use MarkdownEditor for description field |
| `package.json` | **Update** | Add `react-markdown-editor-lite` and `markdown-it` dependencies |

### E2E Test Files

| File | Action | Description |
|------|--------|-------------|
| `tests/e2e/tickets.spec.ts` | **Update** | Metadata selectors scoped to sidebar; editor interaction updated |
| `tests/e2e/posts-comments.spec.ts` | **Update** | Editor selectors updated; tabs testing; notes tab interaction |
| `tests/e2e/advanced-tickets.spec.ts` | **Update** | Sidebar-scoped agent controls check |
| `tests/e2e/attachments.spec.ts` | **Minor review** | Verify no breakage from layout change |

### Prompts Updated

| File | Section Updated | Description |
|------|-----------------|-------------|
| `promts/03-tickets-user.md` | Ticket Detail page, MarkdownPreview, TicketForm | Two-column layout, MarkdownEditor, sidebar metadata |
| `promts/06-posts-comments-notes.md` | Ticket Detail section, NoteForm, tabs, all e2e tests | Tabs for posts/notes, MarkdownEditor in all forms, sidebar layout |
| `promts/08-file-attachments.md` | FileUpload integration note | Note about editor image insertion |

---

## 7. Prompt Updates

### `promts/03-tickets-user.md`

#### Section "3. UI Components" → `MarkdownPreview.tsx` entry:

**Old:**
```
**`src/components/features/tickets/MarkdownPreview.tsx`**:
- `"use client"` component (permitted by architecture constraint 2b)
- "Write" / "Preview" toggle tabs
- Preview renders Markdown client-side with same sanitization config
```

**New:**
```
**`src/components/features/tickets/MarkdownEditor.tsx`**:
- `"use client"` component (permitted by architecture constraint 2b)
- **Abstraction layer** — this is the ONLY file importing the underlying editor library. Swapping to a different editor requires changes only here.
- Rich Markdown editor using `react-markdown-editor-lite` (dynamically imported with `ssr: false`)
- Uses `markdown-it` for preview rendering (consistent with server-side config)
- Built-in toolbar: bold, italic, headings, links, images, code blocks (fenced + inline), lists, tables, quotes
- Editor / Preview / Split modes
- Native image upload via `onImageUpload` prop (drag-and-drop, paste, toolbar button)
- Hidden `<textarea>` with `name` attribute for Server Action form compatibility
- `compact` prop for smaller forms (comments, notes) — hides preview panel
- `onValueChange` callback for external text insertion (canned responses, AI suggestions)
- `data-testid="markdown-editor"` on wrapper div
```

#### Section "3. UI Components" → `TicketForm.tsx` entry:

**Add note:**
```
- Description field uses `<MarkdownEditor>` (not a plain textarea or MarkdownPreview)
```

#### Section "4. Pages" → Ticket Detail (`src/app/(main)/tickets/[id]/[slug]/page.tsx`):

**Old:**
```
- Show: title, type name, status badge, urgency badge, severity badge, category (if set), assigned agent display name (if any), creator display name, creation date
```

**New:**
```
- **Two-column layout**: main content area (left, ~65-70%) with subject, posts timeline, and reply form; sidebar (right, ~30-35%) with ticket metadata, agent controls, and secondary info
- **Sidebar** (`data-testid="ticket-sidebar"`): type, category, status badge, urgency badge, severity badge, assigned agent, creator (+ team name), dates, SLA, CSAT, tags, custom fields, follow/unfollow, agent controls, tier controls, user notes, AI summary
- **Main area** (`data-testid="ticket-main-content"`): editable title, status/time summary, posts timeline (or tabbed posts+notes for agents), reply form
- Responsive: single-column on mobile, two-column on lg+ breakpoint
- Sidebar uses `sticky top-4` on desktop
```

#### Section "6. Tests" → `tests/e2e/tickets.spec.ts`:

**Add/update these entries:**
```
- Ticket detail: metadata (type, urgency) appears in the sidebar (`data-testid="ticket-sidebar"`)
- Create ticket form uses MarkdownEditor for description (interact via `[data-testid="markdown-editor"] textarea`)
- Reply form uses MarkdownEditor (interact via `[data-testid="markdown-editor"] textarea`)
```

### `promts/06-posts-comments-notes.md`

#### Section "3. Ticket Detail Page Updates" → Add new subsection before 3a:

**Add:**
```
#### 3.0 Posts / Notes Tab Separation

Create `src/app/(main)/tickets/[id]/[slug]/TicketTabs.tsx` — a `"use client"` component:
- Two tabs: "Posts" and "Notes"
- "Posts" tab shows the timeline of all non-note posts, comments, activity entries, and the reply form
- "Notes" tab shows all internal notes chronologically and the note form at the bottom
- Note count badge on the Notes tab
- `data-testid="ticket-tabs"` on container, `data-testid="posts-tab"` and `data-testid="notes-tab"` on buttons

**Only agents see tabs.** Regular users see the posts stream directly — no `TicketTabs` component is rendered. Users never see notes or the Notes tab.

Split rendered posts in the server component:
- `notePosts = renderedPosts.filter(p => p.post_type === 'note')`
- `nonNotePosts = renderedPosts.filter(p => p.post_type !== 'note')`
- Build the timeline from `nonNotePosts` only
- Pass both to `TicketTabs` for agents; render only the posts stream for users
```

#### Section "3d. Note Form" — update:

**Old:**
```
- Below the reply form area, show a separate "Add Internal Note" section for agents
```

**New:**
```
- Inside the "Notes" tab (not below the reply form), show the "Add Internal Note" section
- The note form uses `<MarkdownEditor name="body" compact>` instead of a plain textarea
```

#### Section "3b. Inline Edit Form" — add note:

```
- The edit form renders `<MarkdownEditor>` instead of a plain `<textarea>`
```

#### Section "3c. Inline Comment/Reply Forms" — add note:

```
- Comment/reply forms use `<MarkdownEditor name="body" compact>` instead of a plain textarea
```

#### Section "5. Tests" → `tests/e2e/posts-comments.spec.ts` — update entries:

**Add:**
```
- Agent sees "Posts" and "Notes" tabs on ticket detail
- Regular user does not see tab bar
- Agent clicking "Notes" tab shows internal notes and note form
- Note not visible in the "Posts" tab for agents
- Two-column layout: sidebar shows metadata (Type, Created by fields visible)
- Markdown editor shows toolbar
```

**Update existing:**
```
- Add a reply → uses MarkdownEditor (fill via `[data-testid="markdown-editor"] textarea`)
- Add a comment → uses MarkdownEditor (fill via `[data-testid="markdown-editor"] textarea`)
- Add internal note → click "Notes" tab first, then fill MarkdownEditor
- Note not visible to regular user → also verify no `ticket-tabs` element
- Edit a post → edit mode shows MarkdownEditor
```

### `promts/08-file-attachments.md`

#### Section "5. UI Components" → Add note to `FileUpload.tsx` section:

```
**Note:** The post form now uses `MarkdownEditor` (from the ticket detail redesign). File attachments remain as a separate component below each post. The `FileUpload` component is unchanged.
```

---

## Implementation Notes

- **Abstraction layer is critical** — `MarkdownEditor.tsx` is the only file that imports `react-markdown-editor-lite`. All other components use `<MarkdownEditor>` via its stable props interface. Switching to a different editor (e.g., `@uiw/react-md-editor`, `milkdown`) requires editing only this one file.
- `react-markdown-editor-lite` must be dynamically imported with `{ ssr: false }` because it depends on browser APIs (window, document)
- It requires a separate markdown parser — use `markdown-it` (already used server-side for rendering posts)
- The hidden textarea pattern ensures the existing Server Action form submission logic continues to work without changes to server actions
- Image upload is handled natively by the editor — `onImageUpload: (file: File) => Promise<string>` — the editor inserts `![](url)` automatically
- The two-column layout uses Tailwind's `flex-col lg:flex-row` for responsive behavior
- The sidebar uses `sticky top-4` and `flex-shrink-0` with a fixed width (`w-80 xl:w-96`) on desktop
- Notes are completely separated from the posts timeline — they do not appear interspersed with posts even for agents
- Activity log entries related to notes (e.g., "draft published" for notes) should appear in the Notes tab, not the Posts tab
- The `TicketTabs` component is a minimal client component — it only manages which tab is active

## Verification Checklist

- [ ] `npm install` adds `react-markdown-editor-lite` and `markdown-it` successfully
- [ ] Markdown editor renders with toolbar (bold, italic, code, etc.)
- [ ] Editor preview mode shows rendered markdown
- [ ] Code snippets render correctly in preview (fenced code blocks)
- [ ] Image drag-and-drop uploads to Supabase Storage and inserts `![](url)` in editor
- [ ] Image paste from clipboard works the same way
- [ ] Two-column layout: sidebar on right on desktop, stacked on mobile
- [ ] Sidebar displays all ticket metadata, agent controls, tags, SLA, CSAT
- [ ] Sidebar is sticky on scroll
- [ ] Agents see Posts + Notes tabs
- [ ] Regular users see no tabs, just the posts stream
- [ ] Notes appear only in the Notes tab for agents
- [ ] Notes are invisible to regular users
- [ ] Reply form uses MarkdownEditor
- [ ] Note form uses MarkdownEditor (compact)
- [ ] Comment forms use MarkdownEditor (compact)
- [ ] Edit mode uses MarkdownEditor
- [ ] Ticket creation form uses MarkdownEditor
- [ ] Canned response insertion works with the new editor
- [ ] AI suggested reply works with the new editor
- [ ] File attachments still work on posts
- [ ] Collapsible timeline still works
- [ ] `npm run typecheck` passes
- [ ] `npm run lint` passes
- [ ] `npm run test:e2e` passes all updated tests
