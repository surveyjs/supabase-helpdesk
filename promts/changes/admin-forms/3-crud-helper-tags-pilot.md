# 3. CRUD Bulk-Save Helper + Tags Pilot

## Context

Third phase of the admin-forms SurveyJS rollout. Phases 1–2 covered
single-form pages and a fixed-row matrix. This phase introduces the
**shared `diffAndSave` helper** that all CRUD list pages will use, and
proves it on a single pilot page (`/admin/tags`).

Do **not** convert the other CRUD list pages in this prompt — that is
[`4-crud-rest-pages.md`](./4-crud-rest-pages.md). Splitting the helper
introduction from its mass adoption is intentional: the abstraction
must be reviewed in isolation, and the pilot must be exercised by E2E
before it is reused.

## Requirements

### 1. Shared helper

Add `src/lib/actions/admin-crud.ts` exporting `diffAndSave`:

```ts
type DiffAndSaveOptions<TRow extends { id?: string }> = {
  table: string;                  // e.g. 'tags'
  rows: TRow[];                   // payload from the client
  columns: (keyof TRow)[];        // columns to compare for "updated"
  auditAction: string;            // e.g. 'update_tags_bulk'
};

export async function diffAndSave<TRow extends { id?: string }>(
  opts: DiffAndSaveOptions<TRow>,
): Promise<{ added: number; updated: number; removed: number }>;
```

Behavior:

- `requireAdminRole()` once at the top.
- Load existing rows from `table` (admin-scoped query).
- Classify:
  - **Added** — rows in `rows` with no `id`.
  - **Updated** — rows in `rows` whose `id` matches DB and where any
    listed `column` differs.
  - **Removed** — rows in DB whose `id` is not in `rows`.
- Apply changes via supabase: bulk INSERT new rows, individual UPDATE
  per changed row, bulk DELETE removed rows. If supabase supports a
  transactional RPC in this codebase, prefer it.
- Call `logAudit` **once** with `action = opts.auditAction` and payload
  `{ added, updated, removed }`. Do not log per row.
- Return the counts.

Validation is **not** the helper's job — each caller validates rows
before invoking it (names, regex, foreign keys, etc.).

### 2. Pilot page — `/admin/tags`

Tags is the right pilot because it has both `name` and `color`,
exercising more of the helper than a name-only page would.

Schema — add
`src/components/features/survey/form-json/admin/tags.json` with one
`matrixdynamic` named `rows`, `keyName: 'id'`, columns:

- `name` — `text`, required.
- `color` — `text` with `inputType: 'color'`.

Server action — add `saveTags(formData)` in `lib/actions/admin.ts`:

- `requireAdminRole()`.
- `JSON.parse(formData.get('rows'))`. Validate each: trimmed `name`
  non-empty, `color` matches `/^#[0-9a-f]{6}$/i`. Reject the whole
  request with a clear error on first invalid row.
- Call `diffAndSave({ table: 'tags', rows, columns: ['name', 'color'],
  auditAction: 'update_tags_bulk' })`.

Client wrapper — add
`src/app/(main)/admin/tags/TagsSurveyForm.tsx`:

- `'use client'`.
- `<AdminSurveyForm mode="complete" schema={tagsSchema}
  data={{ rows: initialTags }} saveAction={saveTags} ...>`.
- `toFormData={(d) => { const fd = new FormData(); fd.set('rows',
  JSON.stringify(d.rows ?? [])); return fd; }}` (same convention as
  phase 2).

Page integration — update `src/app/(main)/admin/tags/page.tsx` to load
tags and render `<TagsSurveyForm initial={tags} />`. Remove the
existing list + per-row create/rename/delete `<form>` blocks.

### 3. Deprecate per-row tag actions

Mark `createTag`, `renameTag`, `updateTagColor`, `deleteTag` (whatever
exists in `admin.ts`) as `@deprecated` in JSDoc with a one-line
pointer to `saveTags`. **Do not delete them in this PR** — other
callers (E2E specs, possibly UI surfaces) may still depend on them.
Removal happens after phase 4 once nothing imports them.

### 4. Tests

- Update `tests/e2e/teams-tags.spec.ts` tag-related specs to drive the
  matrixdynamic UI: add a row → fill `name` and `color` → click the
  form's complete button; rename → change cell, complete; delete →
  remove row, complete.
- Add at least one DB test in `tests/db/` exercising `diffAndSave`
  directly with synthetic rows: covers all three cases (added,
  updated, removed) in a single call.

## Out of scope

- Categories, Types, Teams, KB Categories (phase 4).
- Custom fields (phase 5).
- Tiers + Auth (phase 6).
- Removing the deprecated per-row tag actions (phase 4 cleanup).

## Acceptance

- `/admin/tags` is fully driven by SurveyJS.
- `diffAndSave` has its own DB test and is used by exactly one caller
  (`saveTags`).
- All E2E specs pass.
