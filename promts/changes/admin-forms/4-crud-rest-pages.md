# 4. CRUD List Pages → `matrixdynamic` (Categories, Types, Teams, KB Categories)

## Context

Fourth phase of the admin-forms SurveyJS rollout. Phase 3 introduced
the `diffAndSave` helper and the matrixdynamic + JSON-payload pattern,
proven on `/admin/tags`. This phase applies the same pattern to the
remaining CRUD list pages.

**Prerequisite:** phase 3 (`3-crud-helper-tags-pilot.md`) must be
merged first. Do not start this prompt until `diffAndSave` exists and
`/admin/tags` is in production.

## Pages

| Route | Schema JSON | Server action | Columns |
|---|---|---|---|
| `/admin/categories` | `categories.json` | `saveCategories` | `name` |
| `/admin/types` | `types.json` | `saveTypes` | `name` |
| `/admin/teams` | `teams.json` | `saveTeams` | `name` |
| `/admin/kb-categories` | `kb-categories.json` | `saveKbCategories` | `name`, `sort_order` (derived from row index) |

## Requirements

For each of the four pages, repeat the pilot pattern from phase 3:

1. **Schema JSON** under
   `src/components/features/survey/form-json/admin/`. One
   `matrixdynamic` question named `rows`, `keyName: 'id'`, columns as
   listed above.
   - For `kb-categories`, **do not** expose `sort_order` as a column.
     Derive it from the row index when saving (see step 2).
2. **Server action** in `lib/actions/admin.ts`, validating then calling
   `diffAndSave({ table, rows, columns, auditAction })`:
   - `categories`: validate trimmed name non-empty, length ≤ existing
     limit, regex same as `createCategory`.
   - `types`: same as categories with the existing types validator.
   - `teams`: same as categories with the existing teams validator.
   - `kb-categories`: validate `name`; before invoking `diffAndSave`,
     remap each row to include `sort_order: index`.
3. **Client wrapper** at
   `src/app/(main)/admin/{slug}/{Slug}SurveyForm.tsx`:
   - `'use client'`, `<AdminSurveyForm mode="complete" ...>`.
   - `toFormData={(d) => { const fd = new FormData();
     fd.set('rows', JSON.stringify(d.rows ?? [])); return fd; }}` —
     identical to phase 2/3.
4. **Page integration** — replace the existing list + per-row
   create/rename/delete/reorder forms in each `page.tsx` with the new
   wrapper. Keep page chrome (titles, helper text, links) unchanged.
5. **Reorder handling** for KB Categories:
   - Row order in the matrixdynamic payload is the new sort order.
   - Drop the `reorderKbCategories` arrows from the page; reordering is
     done by SurveyJS row drag.

## Cleanup

After all four pages are converted **and** their E2E specs pass,
remove the now-unused per-row server actions (and only those — keep
anything still referenced):

- `createCategory`, `renameCategory`, `deleteCategory`
- `createType`, `renameType`, `deleteType`
- `createTeam`, `renameTeam`, `deleteTeam`
- `createKbCategory`, `renameKbCategory`, `deleteKbCategory`,
  `reorderKbCategories`
- The phase-3 deprecated tag actions: `createTag`, `renameTag`,
  `updateTagColor`, `deleteTag` — remove in this PR if nothing imports
  them.

Run a workspace-wide grep for each name before deleting. Update or
remove any unit/DB test that targets a removed action directly.

## Tests

- Update specs in `tests/e2e/teams-tags.spec.ts` and any
  category/team/kb-category specs to drive the matrixdynamic UI using
  the same patterns established in phase 3.
- Existing capability/permission specs continue unchanged — server-side
  validation and `requireAdminRole()` are unchanged.

## Out of scope

- Custom fields (phase 5).
- Tiers + Auth (phase 6).
- Notification templates (phase 2 already covered).

## Acceptance

- Four pages converted, all using `diffAndSave`.
- Per-row legacy actions deleted from `admin.ts`.
- All E2E specs pass.
