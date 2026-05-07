# Auto-Growing Markdown Editor Height with User Preference

## Summary

The shared `MarkdownEditor` (wrapper around `react-markdown-editor-lite`)
currently renders at a fixed height — `150px` in `compact` mode and `250px`
otherwise. Users cannot grow the editor as they type; long replies force
internal scrolling inside a small box.

This change makes the editor:

1. **Open at a comfortable starting height of 300px**, and
2. **Auto-grow as the user types additional lines**, capped at a **maximum
   of 540px**, after which internal scrolling resumes.

These two numbers are not hard-coded constants any more — they are stored
on the agent's profile (and configurable from **Profile → Editor
Preference**) so each agent can tune the editor to their screen.

---

## Motivation

Replies, comments, internal notes and ticket bodies are written in the same
`MarkdownEditor`. The fixed 250px height feels cramped for real
conversations and forces double-scrolling (page + editor). Letting the
editor grow up to roughly half a 1080p viewport (~540px) keeps the entire
draft visible without pushing the surrounding ticket UI off-screen.

Different agents work at very different resolutions and zoom levels, so
the min and max are exposed as profile preferences rather than baked-in
constants.

---

## Design

### 1. Profile schema

New migration **`supabase/migrations/027_editor_height_preferences.sql`**:

```sql
-- Add per-agent markdown editor height preferences.
ALTER TABLE profiles
  ADD COLUMN editor_min_height_px INTEGER NOT NULL DEFAULT 300
    CHECK (editor_min_height_px BETWEEN 120 AND 1000),
  ADD COLUMN editor_max_height_px INTEGER NOT NULL DEFAULT 540
    CHECK (editor_max_height_px BETWEEN 200 AND 2000),
  ADD CONSTRAINT editor_height_min_le_max
    CHECK (editor_min_height_px <= editor_max_height_px);
```

Defaults match the new product behaviour (300 / 540) for every existing
and future profile. The `compact` variant of the editor continues to be
rendered at half the configured `min` height (rounded, floored at 120px)
so dense lists like the new-ticket form stay tight; this derivation lives
in `MarkdownEditor`, not in the database.

The CLI snapshot (`supabase/snippets/profiles_with_settings.sql` if
present) is regenerated; otherwise no change to existing seed data.

### 2. Server action

Extend `updateEditorViewMode` (or add `updateEditorPreferences`) in
`src/lib/actions/profile.ts`:

- Accept `editor_view_mode`, `editor_min_height_px`, `editor_max_height_px`
  from the same form submission.
- Coerce the numeric fields with `Number.parseInt(..., 10)`.
- Validate:
  - `min` is an integer in `[120, 1000]`.
  - `max` is an integer in `[200, 2000]`.
  - `min <= max`.
- On any validation failure, return `{ error: '...' }` without touching
  the row (mirrors existing pattern).
- Update `profiles` with all three columns at once and revalidate `/` and
  `/profile`.

The existing `ProfileActionState` shape is reused; success message stays
"Editor preference saved." so existing tests asserting on it keep
passing.

### 3. Profile UI

`src/app/(main)/profile/EditorPreferenceForm.tsx`:

- Keep the existing layout-mode `<select>`.
- Add two number inputs in a 2-column grid below it:
  - **Initial height (px)** — `name="editor_min_height_px"`,
    `min={120}`, `max={1000}`, `step={10}`, default `300`.
  - **Maximum height (px)** — `name="editor_max_height_px"`,
    `min={200}`, `max={2000}`, `step={10}`, default `540`.
- Helper text under the grid:
  *"The markdown editor opens at the initial height and grows as you
  type, up to the maximum height."*
- Validate `min <= max` on the client before submit; show inline error
  and block submission if violated.
- Submit button label unchanged.

`src/app/(main)/profile/page.tsx`:

- Extend the `profileSelect` string with
  `, editor_min_height_px, editor_max_height_px`.
- Keep the backward-compatible fallback path that already strips
  `editor_view_mode` for older local DBs — extend it to also fall back
  for the new height columns (treat as `null`, defaulting to 300/540 in
  the form).
- Pass `currentMin`, `currentMax` into `<EditorPreferenceForm>`.

### 4. MarkdownEditor component

`src/components/features/tickets/MarkdownEditor.tsx`:

- Add two new optional props:
  ```ts
  /** Initial editor height in px (default 300). */
  minHeightPx?: number;
  /** Maximum editor height in px (default 540). */
  maxHeightPx?: number;
  ```
- Drop the `compact ? '150px' : '250px'` literal. Compute:
  ```ts
  const baseMin = compact
    ? Math.max(120, Math.floor((minHeightPx ?? 300) / 2))
    : (minHeightPx ?? 300);
  const baseMax = Math.max(baseMin, maxHeightPx ?? 540);
  ```
- Track the auto-grown height in local state, initialised to `baseMin`.
- Inside `handleChange`, after `setValue(text)`, measure the underlying
  `<textarea class="rc-md-editor textarea">` (queried via a `ref` on the
  outer wrapper `<div data-testid="markdown-editor">`) using
  `scrollHeight` plus the toolbar offset, clamp to
  `[baseMin, baseMax]`, and update state. Fall back to a line-count
  heuristic (`text.split('\n').length * lineHeight + chrome`) when the
  textarea is not yet mounted (initial render, paste before mount).
- Pass the clamped value to `MdEditor`'s `style={{ height }}` prop.
- When the value is reset externally (e.g. on save → `defaultValue`
  becomes empty), reset the height back to `baseMin`.
- Keep the editor's own scrollbar by relying on the library's CSS — once
  the wrapper hits `baseMax`, additional lines scroll inside as today.

### 5. Wiring through callers

The user's heights need to reach every `<MarkdownEditor>` instance, the
same way `viewMode` is plumbed today. Add an optional pair of props to
each composer / form that already accepts `editorViewMode`:

- `src/components/features/tickets/TicketForm.tsx`
- `src/app/(main)/tickets/[id]/[slug]/ReplyForm.tsx`
- `src/app/(main)/tickets/[id]/[slug]/ReplyToggle.tsx`
- Any post-edit / comment / note form that already forwards
  `editorViewMode`.

Each component accepts `editorMinHeightPx`, `editorMaxHeightPx`
(optional, defaulting to `300` / `540`) and forwards them to
`<MarkdownEditor>`.

Server pages that already read `editor_view_mode` (e.g.
`src/app/(main)/tickets/[id]/[slug]/page.tsx`, new-ticket page,
edit-post path) extend their `select` to include the two new columns and
pass them through. The same backward-compatible fallback used for
`editor_view_mode` applies.

---

## Spec & prompt updates

- `promts/15-user-profile.md` — extend the **Editor preference** bullet
  list (and the `updateEditorViewMode` server-action description) to
  cover `editor_min_height_px` and `editor_max_height_px`, their
  validation ranges, and the `min <= max` rule. Reference the new
  migration `027_editor_height_preferences.sql`.
- `promts/03-tickets-user.md` and `promts/06-posts-comments-notes.md` —
  in the sections listing `MarkdownEditor` props, add
  `minHeightPx` / `maxHeightPx` next to `viewMode`, and note the
  300px → 540px auto-grow behaviour.
- `promts/changes/ticket-detail-redesign.md` — append a short note in
  §5 ("Editor View Preference in User Profile") referring to this change
  for the height-related preferences so the older spec stays consistent.
- `docs/design.md` and `docs/requirements.md` — if either currently
  mentions a fixed editor height, update to reflect the auto-grow
  range and the per-agent override.

No schema-numbering renames: this change adds **migration 027**; existing
migrations 001–026 are untouched.

---

## Tests

### Unit / component (`vitest`)

`src/components/features/tickets/__tests__/MarkdownEditor.test.tsx`
(create if not present):

- Renders with default 300px height when no props passed.
- Honours `minHeightPx={400}` on initial render.
- Grows when `onChange` is fired with multi-line text — height is at
  least `lineCount * lineHeight` and at most `maxHeightPx`.
- Caps at `maxHeightPx`; further input does not increase height.
- `compact` mode halves the min height (floored at 120px).

Use `@testing-library/react`'s `render` + `act` and stub the dynamic
import the same way existing editor tests do (search the repo for an
existing `MarkdownEditor` test for the pattern, otherwise mock
`react-markdown-editor-lite` with a controlled `<textarea>`).

### DB (`vitest` under `tests/db/`)

`tests/db/editor-height-preferences.test.ts` (new):

- Inserts a profile and asserts defaults `300` / `540`.
- Updating to `min=320, max=600` succeeds.
- `min=100` (below 120) is rejected by the CHECK constraint.
- `max=2500` (above 2000) is rejected.
- `min=600, max=400` is rejected by the `editor_height_min_le_max`
  constraint.

### Profile-page e2e (`playwright`)

`tests/e2e/profile.spec.ts` (extend existing or add a new test):

- Sign in as an agent.
- Navigate to `/profile`.
- Change initial height to `350`, max height to `600`, save.
- Assert success toast.
- Reload, assert the inputs reflect `350` / `600`.
- Open a ticket, click Reply, assert the editor wrapper's computed
  height is `350px` initially.
- Type ~30 lines and assert the height grows but never exceeds `600px`.
- Submit the reply (verifies forms still work end-to-end).

### Existing tests

`tests/e2e/posts-comments.spec.ts` and `tests/e2e/tickets.spec.ts`
already reset `editor_view_mode` for the test agent. Extend the same
update calls to also set
`editor_min_height_px = 300, editor_max_height_px = 540` so the per-test
state is deterministic regardless of any prior runs that may have
mutated the row.

---

## Out of scope

- A drag-handle style manual resize (browser-native textarea resize is
  not used because `react-markdown-editor-lite` wraps the textarea).
- Per-form overrides from the UI (e.g. "make this one editor taller for
  this draft only"). The API supports it via props but no UI is added.
- Saving the heights anywhere other than the user profile (no
  per-team / per-tenant override).
