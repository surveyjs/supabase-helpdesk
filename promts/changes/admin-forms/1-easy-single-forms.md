# 1. Easy Single-Form Admin Pages → SurveyJS

## Context

Eight admin pages already use SurveyJS via `AdminSurveyForm` /
`SurveyJsonForm` (CSAT, Email, Inbound Email, Pagination, Privacy, Rate
Limit, Survey UI Config, User Settings). This is the first phase of a
broader rollout — the lowest-risk one — covering pages that have a
single server action accepting a flat `FormData`.

The SurveyJS naming convention from the deduplication change is
preserved: **SurveyJS question `name` == server-action
`formData.get(...)` key == underlying `app_settings` key / DB column
name.** No mapping layer is introduced; the default `toFormData` in
`AdminSurveyForm` is used everywhere.

Run this prompt before phases 2–6 in `promts/changes/admin-forms/`.

## Pages to convert

| Route | New component | Existing server action |
|---|---|---|
| `/admin/sla` | `SlaSettingsSurveyForm.tsx` | existing SLA-update action(s) in `lib/actions/admin.ts` |
| `/admin/file-settings` | `FileSettingsSurveyForm.tsx` | `updateFileSettings` (or current handler in `admin.ts`) |
| `/admin/ai` | `AiConfigSurveyForm.tsx` | `saveAiSettings` |

## Requirements

1. For each page, add a SurveyJS schema JSON in
   `src/components/features/survey/form-json/admin/`:
   - `sla.json`
   - `file-settings.json`
   - `ai.json`
2. Question `name`s **must** equal the keys the existing server action
   reads via `formData.get(...)`. Verify by grepping `admin.ts` (and
   any related action file).
3. Add the new client wrapper component per page, modeled exactly on
   [AdminPaginationSurveyForm.tsx](../../../src/app/(main)/admin/pagination/AdminPaginationSurveyForm.tsx):
   `'use client'`, render `<AdminSurveyForm mode="autosave"
   debounceMs={700} schema={...} data={...} saveAction={...} />`. Do
   **not** pass `toFormData`.
4. Replace the existing form import in each `page.tsx` with the new
   Survey form. Keep all non-form chrome (helper text, status badges,
   external links) unchanged.
5. Field type rules:
   - `boolean` → `type: 'boolean'`, `renderAs: 'checkbox'`. The default
     `toFormData` already encodes `true → 'on'`, `false → omit` to
     match every other admin action.
   - Numeric → `type: 'text'`, `inputType: 'number'`. Existing actions
     coerce via `Number(formData.get(...))`.
   - Single-line text → `type: 'text'`.
   - Multi-line / template body → `type: 'comment'`.
6. Delete the obsolete form component files once nothing imports them.
   Verify with a grep before removing.
7. **Do not** introduce `matrixdynamic` or any nested-row patterns in
   this phase. They belong to phases 2–5.

## Boolean encoding

Every admin server action covered by this phase must read booleans as
`formData.get(key) === 'on'`. If any of the four targeted actions
currently uses a different encoding (e.g. `=== 'true'`), align it to
`'on'` in the same PR — the same swap done for `updateCsatSettings` in
the deduplication change. Update any DB-test or unit-test that asserts
on the literal wire value.

## Tests

- All existing E2E specs covering `/admin/sla`, `/admin/file-settings`,
  `/admin/ai` must pass without changes,
  except where they assert on a literal HTML control that no longer
  exists. SurveyJS-rendered inputs preserve the `name` attribute, so
  selectors like `input[name="..."]` continue to work.
- After conversion, run `npx playwright test` and confirm the only
  remaining failures (if any) are pre-existing flakes unrelated to
  these pages.

## Out of scope

- Notification templates list (`/admin/templates`) — phase 2.
- All CRUD list pages (categories, types, tags, teams, kb-categories)
  — phases 3–4.
- Custom fields — phase 5.
- Tiers + Auth — phase 6.
- `/admin`, `/admin/agents`, `/admin/users`, `/admin/audit-log` —
  permanently out of scope (list/action surfaces, not model editors).
