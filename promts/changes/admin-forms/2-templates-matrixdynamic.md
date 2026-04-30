# 2. Notification Templates → SurveyJS `matrixdynamic`

## Context

Second phase of the admin-forms SurveyJS rollout (see
[`1-easy-single-forms.md`](./1-easy-single-forms.md)). This phase
introduces the **JSON-encoded-rows convention** for collection editors,
which phases 3–6 will reuse.

`/admin/templates` currently renders one `<form action={...}>` per
notification template. Convert it to a single SurveyJS form with one
`matrixdynamic` question whose rows are the templates. The per-row
"Reset to default" button stays outside SurveyJS.

## Requirements

### 1. Schema

Add `src/components/features/survey/form-json/admin/templates.json`
with one `matrixdynamic` question named `templates` and these columns:

- `event_type` — `text`, `readOnly: true`. Natural key, never edited.
- `subject` — `text`, required.
- `body` — `comment`, required.

Settings:

- `allowAddRows: false`
- `allowRemoveRows: false`
- `rowCount` is set by the loaded data; do not hard-code.
- `keyName: 'event_type'` so SurveyJS preserves row identity.

### 2. Server action

Add `saveNotificationTemplates(formData: FormData)` in
`src/lib/actions/admin.ts`:

- `requireAdminRole()`.
- Read `formData.get('templates')` and `JSON.parse` it. Validate it is
  an array of objects with string `event_type`, `subject`, `body`.
- Validate each `event_type` against the existing whitelist used by
  `updateNotificationTemplate`. Reject unknown event types.
- Upsert per `event_type` (subject + body).
- `logAudit` once per save with action
  `update_notification_templates_bulk` and payload `{ count: rows.length }`.

Keep the existing `updateNotificationTemplate` and
`resetNotificationTemplate` actions unchanged — `resetNotificationTemplate`
is still needed for the per-row reset button.

### 3. Client wrapper

Add `src/app/(main)/admin/templates/TemplatesSurveyForm.tsx`:

- `'use client'`.
- `<AdminSurveyForm mode="complete" ...>`. **Do not use autosave** for
  collection editors — autosave on every keystroke would post the full
  payload constantly.
- Pass an explicit `toFormData` (the **only** acceptable use in the
  whole admin-forms rollout):

```ts
toFormData={(data) => {
  const fd = new FormData();
  fd.set('templates', JSON.stringify(data.templates ?? []));
  return fd;
}}
```

- `successMessage="Templates saved."`.

### 4. Page integration

Update `src/app/(main)/admin/templates/page.tsx`:

- Load all templates as today.
- Render `<TemplatesSurveyForm initial={...} />` for the editing surface.
- Below or beside it, render a small plain table listing each template's
  `event_type` with a `<form action={resetNotificationTemplate}>` button
  per row. Do not attempt to fold reset into `matrixdynamic`.
- Preserve all helper text and links currently on the page.

### 5. Tests

- Update `tests/e2e/notifications.spec.ts` (the admin-templates portion)
  to drive the SurveyJS UI:
  - Cells are addressable via `input[name="..."]` because SurveyJS
    keeps the column `name`.
  - The save button is the SurveyJS "Apply" / complete button (the
    existing `AdminSurveyForm` default text).
- Reset-button specs continue to target the per-row plain `<form>`.

## Out of scope

- Other admin CRUD pages (phases 3–6).
- Replacing or deleting `updateNotificationTemplate` /
  `resetNotificationTemplate`. Both stay.

## Why this order

This phase establishes the matrixdynamic + JSON-payload pattern on a
small, fixed-row surface (no add/remove). Phases 3–5 reuse the same
pattern with `allowAddRows: true` and a shared `diffAndSave` helper.
