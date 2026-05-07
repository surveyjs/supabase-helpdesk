# Change: Ticket Detail Page Redesign

## Summary

Redesign the ticket detail page with these improvements:

1. **Full-width layout** — Remove `max-w-5xl` constraint for the ticket detail page; use all available viewport width to maximize space for subjects and posts
2. **Rich Markdown editor** — Replace plain textareas with `react-markdown-editor-lite` via a single abstraction layer (`MarkdownEditor.tsx`)
3. **Canned response in editor toolbar** — Move the "Insert canned response" feature into a custom editor toolbar plugin (agent mode only), replacing the standalone `CannedResponsePicker` dropdown above the form
4. **Remove FileUpload drop zone on posts** — The editor handles image attachments natively via `onImageUpload`. Remove `FileUpload` component from individual post cards (read-only posts especially should never show a drop zone). Keep `AttachmentList` for displaying existing attachments.
5. **Editor view preference in user profile** — Store the user's preferred editor display mode (`both` | `preview` | `editor`) in the `profiles` table. The user can toggle between modes on the fly; the preference persists across sessions.
6. **Compact ticket information** — Display metadata on a single line per field (e.g., `Type  Issue` on one line). Use a horizontal `dt/dd` layout instead of stacked labels.
7. **Single Ticket Info window with embedded controls** — Merge Ticket Information and Agent Controls into one right-column card. Keep ticket number and status at the top, and render editable controls inline by role/capability.
8. **Role/capability-aware fields** — Agents see status action buttons (`Mark Pending`, `Close Ticket`) and editable rows for assignment, urgency, severity, type, category, and visibility. Users see read-only values unless they have specific tier capabilities, in which case only those fields become editable.
9. **Ticket header cleanup** — Remove the border under the subject line. Move `#123` from the main content area into the first line of the Ticket Information sidebar. Show relative age next to the Created date, e.g., `Created  4/18/2026 (2 d ago)`. Remove status badge from main content (it's already in the sidebar).
10. **Remove back-links** — Remove "← My Tickets" and "← Agent Dashboard" links from ticket detail page top. These are already in the navigation bar.
11. **Two-column layout** — Subject & posts on the left (main area), ticket metadata & controls on the right (sidebar)
12. **Posts/Notes tab separation** — Posts and replies visible to all; internal notes under a separate "Notes" tab visible only to agents

13. **JSON-configurable Ticket Info behavior** — Field visibility and tier-sensitive user controls are now configurable via two admin-stored SurveyJS templates (`survey_ticket_detail_agent_template`, `survey_ticket_detail_user_template`) — see [`ticket-detail-survey-template-refactor.md`](./ticket-detail-survey-template-refactor.md)

---

## 1. Full-Width Layout for Ticket Detail

### Problem

The `(main)` layout applies `max-w-5xl` (1024 px) to all pages via:

```tsx
// src/app/(main)/layout.tsx
<main id="main" className="flex-1 max-w-5xl mx-auto w-full px-4 py-6">
```

This constrains long ticket subjects, wide code blocks in posts, and the two-column layout.

### Solution

The ticket detail page (`/tickets/[id]/[slug]`) should use full viewport width (minus padding). All other pages keep the existing `max-w-5xl`.

**Option A — CSS breakout class:**

Add a class on the ticket detail page's outermost wrapper that overrides the parent's max-width:

```tsx
// In page.tsx — outermost wrapper
<div className="ticket-detail-full-width">
  ...
</div>
```

```css
/* In globals.css */
.ticket-detail-full-width {
  max-width: 100%;
  margin-left: calc(-50vw + 50%);
  margin-right: calc(-50vw + 50%);
  padding-left: 1.5rem;
  padding-right: 1.5rem;
  width: 100vw;
}
```

**Option B — nested layout file:**

Create `src/app/(main)/tickets/[id]/[slug]/layout.tsx` that wraps children without the `max-w-5xl` constraint. This may require restructuring the outer layout to not apply max-width on the `<main>` tag and instead apply it per-page or per-layout-group.

Choose whichever is simpler. The key requirement: ticket detail content spans ~100% viewport width while other pages stay constrained.

---

## 2. Rich Markdown Editor Component

### Dependencies

```bash
npm install react-markdown-editor-lite markdown-it @types/markdown-it
```

### Abstraction Layer — `MarkdownEditor.tsx`

**`src/components/features/tickets/MarkdownEditor.tsx`** — the ONLY file importing `react-markdown-editor-lite`. Swapping editors means changing only this file.

```tsx
'use client';

import dynamic from 'next/dynamic';
import { useState, useCallback, useEffect } from 'react';
import MarkdownIt from 'markdown-it';

const MdEditor = dynamic(() => import('react-markdown-editor-lite'), { ssr: false });
import 'react-markdown-editor-lite/lib/index.css';

const mdParser = new MarkdownIt({ html: false, linkify: true, typographer: true });

export interface MarkdownEditorProps {
  name: string;
  defaultValue?: string;
  required?: boolean;
  maxLength?: number;
  placeholder?: string;
  compact?: boolean;
  /** Editor view mode — controlled by user preference */
  viewMode?: 'both' | 'preview' | 'editor';
  onValueChange?: (value: string) => void;
  onImageUpload?: (file: File) => Promise<string>;
  /** Toolbar plugins to prepend (e.g., canned response button for agents) */
  extraToolbarPlugins?: string[];
}

export function MarkdownEditor({
  name,
  defaultValue,
  required,
  maxLength,
  placeholder,
  compact,
  viewMode = 'both',
  onValueChange,
  onImageUpload,
  extraToolbarPlugins,
}: MarkdownEditorProps) {
  const [value, setValue] = useState(defaultValue ?? '');

  useEffect(() => {
    if (defaultValue !== undefined && defaultValue !== value) {
      setValue(defaultValue);
    }
  }, [defaultValue]);

  const handleChange = useCallback(({ text }: { text: string }) => {
    setValue(text);
    onValueChange?.(text);
  }, [onValueChange]);

  const handleImageUpload = useCallback(async (file: File): Promise<string> => {
    if (onImageUpload) return onImageUpload(file);
    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = (e) => resolve(e.target?.result as string);
      reader.readAsDataURL(file);
    });
  }, [onImageUpload]);

  // Derive view config from viewMode prop
  const viewConfig = {
    menu: true,
    md: viewMode === 'both' || viewMode === 'editor',
    html: viewMode === 'both' || viewMode === 'preview',
  };

  return (
    <div data-testid="markdown-editor">
      <textarea
        name={name}
        value={value}
        required={required}
        maxLength={maxLength}
        readOnly
        hidden
        aria-hidden="true"
        tabIndex={-1}
      />
      <MdEditor
        value={value}
        onChange={handleChange}
        renderHTML={(text: string) => mdParser.render(text)}
        onImageUpload={handleImageUpload}
        style={{ height: compact ? '150px' : '250px' }}
        placeholder={placeholder ?? 'Write using Markdown…'}
        view={viewConfig}
        canView={{ menu: true, md: true, html: true, both: true, fullScreen: false, hideMenu: false }}
        plugins={extraToolbarPlugins}
      />
    </div>
  );
}
```

**Key props:**
- `viewMode` (`'both' | 'preview' | 'editor'`) — drives the `view` config from user preference
- `extraToolbarPlugins` — allows injecting custom toolbar buttons (e.g., canned response)
- `compact` — smaller height for comments and notes
- `onImageUpload` — native drag-drop/paste/toolbar upload (wired to
  `uploadInlineImageFromEditor`; see
  `promts/changes/inline-image-paste.md` for the orphan-attachment +
  `claimInlineAttachments` flow that backs this prop)
- Hidden `<textarea>` for Server Action form compatibility

### Where the Editor Is Used

| Component | New |
|-----------|-----|
| `ReplyForm.tsx` | `<MarkdownEditor>` with `viewMode` from profile + `extraToolbarPlugins` for canned response (agent only) |
| `NoteForm.tsx` | `<MarkdownEditor compact>` with `viewMode` from profile |
| `CommentForm.tsx` | `<MarkdownEditor compact>` with `viewMode` from profile |
| `EditablePost.tsx` (edit mode) | `<MarkdownEditor>` with `viewMode` from profile |
| `TicketForm.tsx` (description) | `<MarkdownEditor>` with `viewMode` from profile |

---

## 3. Canned Response as Editor Toolbar Plugin

### Problem

The `CannedResponsePicker` is currently a standalone dropdown rendered above the reply form. It inserts text by appending to state. This is disconnected from the editor and takes extra vertical space.

### Solution

Register a **custom toolbar plugin** for `react-markdown-editor-lite` that opens the canned response picker as a dropdown anchored to a toolbar button. This keeps the insertion contextual and reduces UI clutter.

**`src/components/features/tickets/CannedResponsePlugin.tsx`** (new file):

```tsx
'use client';

import { PluginComponent } from 'react-markdown-editor-lite';
import { useState, useRef, useEffect } from 'react';
import { searchCannedResponses } from '@/lib/actions/canned-responses';

const CannedResponsePlugin: PluginComponent = ({ editor }) => {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<{ id: string; title: string; body: string }[]>([]);
  const containerRef = useRef<HTMLDivElement>(null);

  // Debounced search
  useEffect(() => {
    if (!open || query.length < 1) { setResults([]); return; }
    const timer = setTimeout(async () => {
      const fd = new FormData();
      fd.set('query', query);
      const res = await searchCannedResponses(fd);
      setResults(res);
    }, 300);
    return () => clearTimeout(timer);
  }, [query, open]);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    function handleClick(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [open]);

  function handleSelect(body: string) {
    editor.insertText(body);  // Insert at cursor position
    setOpen(false);
    setQuery('');
  }

  return (
    <span className="button" title="Insert canned response" ref={containerRef}>
      <span onClick={() => setOpen(!open)} style={{ cursor: 'pointer', fontSize: '14px' }}>
        📋
      </span>
      {open && (
        <div className="absolute top-full left-0 z-50 mt-1 w-80 bg-white border border-gray-200 rounded-lg shadow-lg p-2">
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search canned responses…"
            className="w-full px-2 py-1 text-sm border border-gray-300 rounded mb-2"
            autoFocus
          />
          <div className="max-h-48 overflow-y-auto space-y-1">
            {results.map((r) => (
              <button
                key={r.id}
                type="button"
                onClick={() => handleSelect(r.body)}
                className="w-full text-left px-2 py-1 text-sm hover:bg-gray-100 rounded"
              >
                <span className="font-medium">{r.title}</span>
                <span className="block text-xs text-gray-500 line-clamp-1">{r.body}</span>
              </button>
            ))}
            {query && results.length === 0 && (
              <p className="text-xs text-gray-400 px-2">No matches</p>
            )}
          </div>
        </div>
      )}
    </span>
  );
};

CannedResponsePlugin.pluginName = 'canned-response';
CannedResponsePlugin.align = 'left';

export default CannedResponsePlugin;
```

**Registration** — in `MarkdownEditor.tsx`, register the plugin at module level:

```tsx
import MdEditorLib from 'react-markdown-editor-lite';
import CannedResponsePlugin from './CannedResponsePlugin';
MdEditorLib.use(CannedResponsePlugin);
```

Then in `ReplyForm.tsx`, pass `extraToolbarPlugins={['canned-response']}` only when `isAgent` is true. **Remove** the standalone `<CannedResponsePicker>` import from `ReplyForm.tsx`.

---

## 4. Remove FileUpload Drop Zone from Posts

### Problem

Each post card currently renders a `<FileUpload>` drag-and-drop zone for the post author and agents. Since the editor now handles image attachments natively via `onImageUpload`, the separate drop zone is redundant — especially on read-only posts.

### Changes

In `page.tsx` `renderPostCard()`, **remove**:

```tsx
// REMOVE THIS BLOCK
{!isDraft && (isCurrentUser || isAgent) && (
  <FileUpload
    postId={post.id}
    allowedTypes={allowedFileTypes}
    maxFileSizeMb={maxFileSizeMb}
    maxFilesPerPost={maxFilesPerPost}
    existingCount={attachmentCountMap.get(post.id) ?? 0}
  />
)}
```

- **Keep** `<AttachmentList>` — displays existing attachments below each post
- **Keep** the `FileUpload` component source file — may be used for non-image attachments in other contexts
- Remove the `FileUpload` import from `page.tsx` if it becomes unused
- Remove variables used only for `FileUpload` props (`allowedFileTypes`, `maxFileSizeMb`, `maxFilesPerPost`) if they become unused after this change

---

## 5. Editor View Preference in User Profile

### Database Migration

**`supabase/migrations/021_editor_preference.sql`** (new):

```sql
-- Add editor view mode preference to profiles
ALTER TABLE profiles
  ADD COLUMN editor_view_mode TEXT NOT NULL DEFAULT 'both'
  CHECK (editor_view_mode IN ('both', 'preview', 'editor'));
```

### Server Action

Add to **`src/lib/actions/profile.ts`**:

```tsx
export async function updateEditorViewMode(formData: FormData) {
  const supabase = await createServerClient();
  const user = await requireAuth();
  const mode = formData.get('editor_view_mode') as string;

  if (!['both', 'preview', 'editor'].includes(mode)) {
    return { error: 'Invalid editor view mode' };
  }

  const { error } = await supabase
    .from('profiles')
    .update({ editor_view_mode: mode })
    .eq('id', user.id);

  if (error) return { error: error.message };
  revalidatePath('/');
  return {};
}
```

### UI — In-Editor Toggle

Add a small toggle (three buttons or a dropdown) inside the `MarkdownEditor` component (above or alongside the toolbar) that lets the user switch between:
- **Both** — editor + preview side-by-side (default)
- **Preview** — preview only
- **Editor** — editor only

When the user changes the mode:
1. Immediately update the editor view (local state)
2. Persist to the database via `updateEditorViewMode` server action (debounced, fire-and-forget)

### Passing the Preference

The ticket detail `page.tsx` (server component) fetches the current user's profile including `editor_view_mode` and passes it down to the form components:

```tsx
// In page.tsx — already has profile data
const editorViewMode = profile?.editor_view_mode ?? 'both';

// Pass to ReplyForm, NoteForm, etc.
<ReplyForm ticketId={ticket.id} isAgent={isAgent} editorViewMode={editorViewMode} />
```

Each form component passes `viewMode={editorViewMode}` to `<MarkdownEditor>`.

### Profile Page

On `/profile`, add an "Editor Preference" section showing the current mode with radio buttons or a dropdown. This is a convenience — the primary way to change the mode is the in-editor toggle.

> **Note:** The auto-grow behaviour and the `editor_min_height_px` /
> `editor_max_height_px` profile preferences are specified separately in
> [editor-auto-grow-height.md](./editor-auto-grow-height.md) (migration
> `027_editor_height_preferences.sql`). The same `updateEditorViewMode`
> server action handles both the view-mode and height fields.

---

## 6. Compact Ticket Information

### Problem

Current ticket info uses stacked `<dt>` / `<dd>` pairs — each field takes two lines. This wastes vertical space in the sidebar.

### Solution

Use an inline `<dl>` layout where label and value are on the same line:

```
#123
Type           Issue
Category       Billing
Created by     Alice (Support Team)
Assigned to    Agent Smith
Created        4/18/2026 (2 d ago)
Last updated   4/20/2026
```

Implementation:

```tsx
<dl className="text-sm space-y-1">
  <div className="flex items-baseline gap-2">
    <dt className="text-gray-500 w-28 flex-shrink-0">Ticket</dt>
    <dd className="text-gray-900 font-medium">#{ticket.id}</dd>
  </div>
  <div className="flex items-baseline gap-2">
    <dt className="text-gray-500 w-28 flex-shrink-0">Type</dt>
    <dd className="text-gray-900">{typeName}</dd>
  </div>
  {/* ... same pattern for each field ... */}
</dl>
```

Each `<div>` wraps one `<dt>` + `<dd>` pair, displayed as `flex` with a fixed-width label column (`w-28` ≈ 7rem).

---

## 7. Embed Agent Controls in Ticket Info

### Final behavior

Use one Ticket Info card for both metadata and controls.

- Keep the top row unchanged: `#ticket-id` + status badge.
- For **agents**: add a `Status` line with buttons `Mark Pending` and `Close Ticket`.
- For **agents**: render editable controls inline in Ticket Info for assignment, urgency, severity, type, category, and visibility.
- For **users with tier capabilities**: enable only the specific editable fields they are allowed to change.
- For **users without capabilities**: keep read-only values (or hidden behavior where already applicable).
- Visibility row is always shown; action button (`Make Public` / `Make Private`) is shown only if viewer has permission.

Merged tickets remain read-only in this same window.

---

## 8. Unified Sidebar and Single Ticket Info Window

### Final behavior

Sidebar stays as one sticky right-column container. Ticket metadata and controls are unified into one Ticket Info card (no separate Agent Controls card).

Use this structure:

```tsx
<aside className="w-full lg:w-80 xl:w-96 flex-shrink-0" data-testid="ticket-sidebar">
  <div className="lg:sticky lg:top-4 lg:max-h-[calc(100vh-2rem)] lg:overflow-y-auto space-y-4">
    {/* Ticket Information */}
    <div className="bg-white rounded-lg border border-gray-200 p-4">
      {/* ... compact metadata fields ... */}
    </div>

    {/* Tier Controls, User Notes, AI Summary, etc. */}
  </div>
</aside>
```

Key CSS:
- `lg:sticky lg:top-4` — sticks to top on desktop
- `lg:max-h-[calc(100vh-2rem)]` — limits height to viewport minus padding
- `lg:overflow-y-auto` — internal scroll when content exceeds viewport

---

## 9. Ticket Header Cleanup

### Remove Horizontal Rule / Border Under Subject

The subject line should flow directly into the posts content with no card border or `<hr>`.

### Move Ticket Number to Sidebar

Remove `<span>#{ticket.id}</span>` from the main content area. Show it as the **first line** in the Ticket Information sidebar:

```tsx
<div className="flex items-baseline gap-2">
  <dt className="text-gray-500 w-28 flex-shrink-0">Ticket</dt>
  <dd className="text-gray-900 font-medium">#{ticket.id}</dd>
</div>
```

### Relative Time on Created Date

Show relative time in parentheses next to the absolute date:

```tsx
<div className="flex items-baseline gap-2">
  <dt className="text-gray-500 w-28 flex-shrink-0">Created</dt>
  <dd className="text-gray-900">
    {new Date(ticket.created_at).toLocaleDateString()} ({formatRelativeTime(ticket.created_at)})
  </dd>
</div>
```

Add **`formatRelativeTime()`** utility to `src/lib/utils/time.ts` (or existing utils):

```tsx
export function formatRelativeTime(dateStr: string): string {
  const now = new Date();
  const date = new Date(dateStr);
  const diffMs = now.getTime() - date.getTime();
  const diffMin = Math.floor(diffMs / 60000);
  const diffHrs = Math.floor(diffMin / 60);
  const diffDays = Math.floor(diffHrs / 24);
  const diffMonths = Math.floor(diffDays / 30);
  const diffYears = Math.floor(diffDays / 365);

  if (diffMin < 1) return 'just now';
  if (diffMin < 60) return `${diffMin} min ago`;
  if (diffHrs < 24) return `${diffHrs} h ago`;
  if (diffDays < 30) return `${diffDays} d ago`;
  if (diffMonths < 12) return `${diffMonths} mo ago`;
  return `${diffYears} y ago`;
}
```

### Remove Status Badge from Main Content

The status badge below the title in main content is redundant — it's in the sidebar. The main content subject area becomes just:

```tsx
<div className="mb-4">
  <EditableTitle ticketId={ticket.id} title={ticket.title} canEdit={canEditTitle} />
</div>
```

---

## 10. Remove Back-Links from Ticket Detail

Delete the entire back-links `<div>`:

```tsx
// REMOVE THIS BLOCK
<div className="flex items-center gap-4 mb-4">
  <Link href="/tickets" className="text-sm text-blue-600 hover:text-blue-800">
    ← My Tickets
  </Link>
  {isAgent && (
    <Link href="/agent" className="text-sm text-blue-600 hover:text-blue-800">
      ← Agent Dashboard
    </Link>
  )}
</div>
```

These destinations are already in the navigation bar.

---

## 11. Two-Column Layout

### Layout Structure

```
┌──────────────────────────────────────────────────────────────────────────┐
│  [Duplicate/Merge banners — full width]                                  │
├───────────────────────────────────────────┬──────────────────────────────┤
│  MAIN CONTENT (left, flex-1)              │  SIDEBAR (right, w-80/w-96)  │
│                                           │  ┌─────────────────────────┐ │
│  Subject (editable title, full width)     │  │ Ticket Info (compact)   │ │
│                                           │  │ Ticket   #123           │ │
│  ┌─[Posts]──[Notes (agents)]──┐           │  │ Status   ● Open         │ │
│  │                            │           │  │ Created by  Alice       │ │
│  │  Original post             │           │  │ Created  4/18 (2d ago)  │ │
│  │  ├─ Comment thread         │           │  │ Tags  [bug] [urgent]   │ │
│  │  Activity entry            │           │  │ (Type/Cat/etc hidden    │ │
│  │  Post 2 (with attachments) │           │  │  for agents — shown in  │ │
│  │  ...                       │           │  │  Agent Controls below)  │ │
│  │                            │           │  ├─────────────────────────┤ │
│  │  [Show X older posts]      │           │  │ Agent Controls          │ │
│  │                            │           │  │ Status / Assign / Type  │ │
│  │  Reply form (MarkdownEditor│           │  │ Category / Urgency ...  │ │
│  │   with 📋 toolbar canned)  │           │  ├─────────────────────────┤ │
│  └────────────────────────────┘           │  │ User Notes / AI Summary │ │
│                                           │  └─────────────────────────┘ │
│                                           │  (single sticky scrollable)  │
└───────────────────────────────────────────┴──────────────────────────────┘
```

### Implementation

```tsx
<div className="ticket-detail-full-width">
  {/* Banners (full width) */}
  {ticket.duplicate_of_id && ( /* ... */ )}
  {ticket.merged_into_id && ( /* ... */ )}

  <div className="flex flex-col lg:flex-row gap-6">
    {/* LEFT: Main content */}
    <div className="flex-1 min-w-0" data-testid="ticket-main-content">
      <div className="mb-4">
        <EditableTitle ... />
      </div>

      {isAgent ? (
        <TicketTabs ... />
      ) : (
        <div>{/* posts stream */}</div>
      )}
    </div>

    {/* RIGHT: Sidebar (unified, sticky, scrollable) */}
    <aside className="w-full lg:w-80 xl:w-96 flex-shrink-0" data-testid="ticket-sidebar">
      <div className="lg:sticky lg:top-4 lg:max-h-[calc(100vh-2rem)] lg:overflow-y-auto space-y-4">
        {/* Ticket info card (compact, agent-filtered) */}
        {/* Agent controls card (agents only) */}
        {/* Tier controls (users with tier caps) */}
        {/* User notes, AI summary, etc. */}
      </div>
    </aside>
  </div>

  <RealtimeTicketUpdates ticketId={ticket.id} />
</div>
```

### Responsive Behavior

- **Desktop (lg+):** Two-column, sidebar on right
- **Mobile/Tablet (<lg):** Single column, sidebar stacks below main content

---

## 12. Posts / Notes Tab Separation

### `TicketTabs.tsx`

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
        <button role="tab" aria-selected={activeTab === 'posts'}
          onClick={() => setActiveTab('posts')}
          className={...} data-testid="posts-tab">
          Posts
        </button>
        <button role="tab" aria-selected={activeTab === 'notes'}
          onClick={() => setActiveTab('notes')}
          className={...} data-testid="notes-tab">
          Notes
          {noteCount > 0 && <span className="...">{noteCount}</span>}
        </button>
      </div>
      <div role="tabpanel">
        {activeTab === 'posts' ? postsContent : notesContent}
      </div>
    </div>
  );
}
```

### Separation Logic

```tsx
const notePosts = renderedPosts.filter((p) => p.post_type === 'note');
const nonNotePosts = renderedPosts.filter((p) => p.post_type !== 'note');
const noteCount = notePosts.length;
// Build timeline from nonNotePosts only
```

### User View

Regular users see the posts stream directly — no tabs, no notes.

---

## 13. Data-TestID Summary

| Element | data-testid |
|---------|-------------|
| Main content area | `ticket-main-content` |
| Sidebar | `ticket-sidebar` |
| Tab container (agents) | `ticket-tabs` |
| Posts tab button | `posts-tab` |
| Notes tab button | `notes-tab` |
| Markdown editor wrapper | `markdown-editor` |
| Agent controls | `agent-controls` |
| Tier controls | `tier-controls` |

---

## 14. E2E Test Updates

### Updated selectors across all test files

- **Metadata checks** — scope to `page.getByTestId('ticket-sidebar')`
- **Editor interaction** — use `page.locator('[data-testid="markdown-editor"]').locator('textarea')`
- **Reply form** — no standalone `CannedResponsePicker` above form; canned response is in the editor toolbar (📋 button)
- **Note form** — accessible via "Notes" tab for agents
- **No back-links** — tests must not expect "← My Tickets" or "← Agent Dashboard" links on ticket detail
- **No FileUpload** — remove expectations of drop zones on post cards
- **Compact info** — metadata fields are single-line in the sidebar

### New tests

- `two-column layout: sidebar shows metadata` — verify sidebar visible with compact metadata
- `agent sees Posts and Notes tabs` — verify tab bar for agents
- `Notes tab shows note count badge` — verify badge with count
- `regular user does not see tab bar` — no `ticket-tabs` visible
- `editor toolbar visible` — `.rc-md-navigation` visible
- `agent sees canned response in editor toolbar` — toolbar contains 📋 button
- `full-width layout on ticket detail` — content wider than standard max-w-5xl
- `editor view mode preference persists` — change mode, reload, verify same mode
- `agent does not see duplicate fields in ticket info` — Type, Category not in info when agent
- `user sees all fields in ticket info` — Type, Category visible for regular users

---

## 15. Files Modified

### Source Files

| File | Action | Description |
|------|--------|-------------|
| `src/components/features/tickets/MarkdownEditor.tsx` | **Update** | Add `viewMode`, `extraToolbarPlugins` props; register CannedResponsePlugin |
| `src/components/features/tickets/CannedResponsePlugin.tsx` | **Create** | Editor toolbar plugin for canned responses |
| `src/app/(main)/tickets/[id]/[slug]/page.tsx` | **Major update** | Full-width class, remove back-links, two-column layout, compact sidebar info, hide agent-duplicate fields, unified sticky sidebar, remove FileUpload from posts, move ticket # to sidebar, relative time |
| `src/app/(main)/tickets/[id]/[slug]/TicketTabs.tsx` | **Keep** | Already created — no changes |
| `src/app/(main)/tickets/[id]/[slug]/ReplyForm.tsx` | **Update** | Remove CannedResponsePicker, accept `editorViewMode` prop, pass `viewMode` and `extraToolbarPlugins` to editor |
| `src/app/(main)/tickets/[id]/[slug]/NoteForm.tsx` | **Update** | Accept `editorViewMode` prop, pass `viewMode` to editor |
| `src/app/(main)/tickets/[id]/[slug]/CommentForm.tsx` | **Update** | Accept `editorViewMode` prop, pass `viewMode` to editor |
| `src/app/(main)/tickets/[id]/[slug]/EditablePost.tsx` | **Update** | Accept `editorViewMode` prop, pass `viewMode` to editor |
| `src/components/features/tickets/TicketForm.tsx` | **Update** | Accept `editorViewMode` prop, pass `viewMode` to editor |
| `src/lib/actions/profile.ts` | **Update** | Add `updateEditorViewMode` server action |
| `src/lib/utils/time.ts` | **Create or update** | Add `formatRelativeTime()` utility |
| `src/app/(main)/profile/page.tsx` | **Update** | Add editor preference section |
| `src/app/globals.css` | **Update** | Add `.ticket-detail-full-width` CSS class |
| `supabase/migrations/021_editor_preference.sql` | **Create** | Add `editor_view_mode` column to profiles |
| `package.json` | **Update** | Add dependencies (if not already present) |

### E2E Test Files

| File | Action |
|------|--------|
| `tests/e2e/tickets.spec.ts` | Update selectors: sidebar, editor, no back-links, compact info |
| `tests/e2e/posts-comments.spec.ts` | Update: tabs, editor, sidebar, no FileUpload, canned response in toolbar |
| `tests/e2e/advanced-tickets.spec.ts` | Sidebar-scoped agent controls |
| `tests/e2e/attachments.spec.ts` | Remove FileUpload drop zone expectations on posts |

---

## 16. Prompt & Spec Updates

The following original prompts and specs need to be updated to reflect these changes:

### `docs/design.md`

- Add exception to "Centered content area, max-width ~5xl" — ticket detail page uses full width
- Add note about compact sidebar metadata layout

### `docs/requirements.md`

- §3.4 Ticket detail — mention full-width layout, compact sidebar info, no back-links, relative time on Created date
- §3.12 Markdown preview — update to reference the rich editor with user-selectable view mode (both/preview/editor)
- Add new requirement for `editor_view_mode` user preference on `profiles` table

### `promts/03-tickets-user.md`

- Ticket detail page section: full-width layout, remove back-links, compact sidebar info, ticket # in sidebar, relative time, hide agent-duplicate fields, unified sticky sidebar
- MarkdownEditor section: add `viewMode` and `extraToolbarPlugins` props
- TicketForm: pass `editorViewMode` to editor

### `promts/06-posts-comments-notes.md`

- ReplyForm: canned response via editor toolbar plugin (not standalone picker), pass `editorViewMode`
- NoteForm: pass `editorViewMode`
- CommentForm: pass `editorViewMode`
- EditablePost: pass `editorViewMode`
- Remove reference to CannedResponsePicker as a standalone component in forms

### `promts/08-file-attachments.md`

- Remove FileUpload from post cards (it's no longer rendered per-post)
- Keep AttachmentList for displaying existing attachments
- Note that image uploads are handled by the editor's onImageUpload

### `promts/15-user-profile.md`

- Add `editor_view_mode` column to profiles table
- Add editor preference section to profile page
- Add `updateEditorViewMode` server action

---

## Verification Checklist

- [ ] Ticket detail page uses full viewport width
- [ ] Other pages still use `max-w-5xl`
- [ ] Markdown editor renders with toolbar
- [ ] Editor view mode toggleable (both/preview/editor)
- [ ] View mode preference persists in profile
- [ ] Canned response accessible via editor toolbar button (agents only)
- [ ] No standalone CannedResponsePicker above forms
- [ ] No FileUpload drop zone on post cards
- [ ] AttachmentList still shows existing attachments
- [ ] Image drag-and-drop into editor works
- [ ] Two-column layout: sidebar on right on desktop, stacked on mobile
- [ ] Sidebar content in single sticky scrollable container
- [ ] Ticket info compact — single-line per field
- [ ] Agent-editable fields hidden from ticket info (agent view)
- [ ] Regular user sees all fields in ticket info
- [ ] Ticket number in sidebar, not main content
- [ ] Created date shows relative time: `4/18/2026 (2 d ago)`
- [ ] No status badge under subject in main content
- [ ] No "← My Tickets" / "← Agent Dashboard" links
- [ ] Agents see Posts + Notes tabs
- [ ] Regular users see no tabs
- [ ] Notes only in Notes tab for agents
- [ ] `npm run typecheck` passes
- [ ] `npm run lint` passes
- [ ] All E2E tests pass with updated selectors
