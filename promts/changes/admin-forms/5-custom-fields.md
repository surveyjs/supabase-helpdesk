# 5. Custom Fields → `matrixdynamic` with Conditional Columns

## Context

Fifth phase of the admin-forms SurveyJS rollout. Reuses the
`diffAndSave` helper from phase 3 and the matrixdynamic conventions
from phases 2–4. The custom-fields editor adds one new wrinkle:
**conditional columns** based on the selected `field_type`.

**Prerequisite:** phase 4 (`4-crud-rest-pages.md`) must be merged so
`diffAndSave` is battle-tested.

## Requirements

### 1. Schema

Add `src/components/features/survey/form-json/admin/custom-fields.json`
with one `matrixdynamic` named `fields`, `keyName: 'id'`, columns:

- `name` — `text`, required.
- `field_type` — `dropdown` with the exact value list accepted by the
  existing validators in `lib/actions/admin.ts` (e.g. `text`,
  `textarea`, `number`, `select`, `radio`, `checkbox`, `date`).
- `is_required` — `boolean`.
- `default_value` — `text`.
- `options` — `text`, **conditionally visible**:
  `visibleIf: "{row.field_type} = 'select' or {row.field_type} = 'radio'"`.
  Stored as a comma-separated string (matches today's
  `formData.get('options')`).

`sort_order` is derived from row index — do **not** expose a column.

### 2. Server action

Add `saveCustomFields(formData)` in `lib/actions/admin.ts`:

- `requireAdminRole()`.
- `JSON.parse(formData.get('fields'))`.
- Validate each row using the **same** rules as the existing
  `createCustomField` / `updateCustomField` validators:
  - `name` regex.
  - `field_type` in supported list.
  - For `select` / `radio`: `options` must be a non-empty
    comma-separated list with each item trimmed and unique.
  - `default_value` (when present) must be one of the options for
    `select`/`radio`.
- Remap each row to include `sort_order: index`.
- Call `diffAndSave({ table: 'custom_fields', rows, columns: ['name',
  'field_type', 'is_required', 'default_value', 'options',
  'sort_order'], auditAction: 'update_custom_fields_bulk' })`.

### 3. Client wrapper

Add `src/app/(main)/admin/custom-fields/CustomFieldsSurveyForm.tsx`:

- `'use client'`, `<AdminSurveyForm mode="complete" ...>`.
- `toFormData={(d) => { const fd = new FormData(); fd.set('fields',
  JSON.stringify(d.fields ?? [])); return fd; }}`.
- `successMessage="Custom fields saved."`.

### 4. Page integration

Update `src/app/(main)/admin/custom-fields/page.tsx`:

- Load custom fields as today (sorted by `sort_order`).
- Render `<CustomFieldsSurveyForm initial={fields} />`.
- Remove the existing list, per-row reorder buttons, the inline
  `updateCustomField` form, the row-level `deleteCustomField` form,
  and the bottom `createCustomField` form.

### 5. Cleanup

After E2E specs pass, delete the per-row actions (verify with grep
first):

- `createCustomField`
- `updateCustomField`
- `deleteCustomField`
- `reorderCustomField`

### 6. Tests

- Update `tests/e2e/*custom-fields*.spec.ts` (or the closest existing
  spec) to drive the matrixdynamic UI:
  - Add a row, set `field_type = 'select'`, verify the `options`
    column becomes visible.
  - Set `field_type` back to `text`, verify `options` is hidden and
    not submitted (or submitted empty — match server validation).
  - Reorder rows, save, reload, verify the new order is persisted as
    `sort_order`.
  - Delete a row, save, verify it disappears.

## Out of scope

- Tiers + Auth (phase 6).
- Any change to how custom fields are *consumed* by ticket forms.

## Acceptance

- `/admin/custom-fields` fully driven by SurveyJS with conditional
  `options` column.
- Legacy per-row custom-field actions deleted.
- All E2E specs pass.
