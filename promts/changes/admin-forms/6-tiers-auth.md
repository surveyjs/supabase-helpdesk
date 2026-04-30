# 6. Tiers + Auth → SurveyJS (final phase)

## Context

Final phase of the admin-forms SurveyJS rollout. These two pages are
last because they mix **model editing** (which moves to SurveyJS) with
**side-channel operations** (API secret display, OAuth provider
verification) that stay as plain JSX.

**Prerequisite:** phase 5 (`5-custom-fields.md`) must be merged so the
`diffAndSave` helper has been exercised under the conditional-column
case.

---

## Part A — `/admin/tiers`

### Schema

Add `src/components/features/survey/form-json/admin/tiers.json` with
one `matrixdynamic` named `rows`, `keyName: 'id'`, columns:

- `key` — `text`, required. Validated as unique, lowercase, regex
  `/^[a-z0-9_]+$/`. Server-side rejects edits that change `key` for an
  existing row (see "key immutability" below).
- `display_name` — `text`, required.
- One `boolean` column per existing tier capability flag, named
  identically to the DB column.

`sort_order` is derived from row index. Do **not** expose a column.

### Key immutability

`key` must be editable for new rows but locked once a row has an `id`.
SurveyJS does not support per-cell read-only based on row-id presence
out of the box. Two acceptable approaches — pick one:

1. **Server enforcement only.** Allow the column to be edited in the
   UI but in `saveTiers` reject any update where `key` differs from
   the DB value for that `id`. Surface the error via the standard
   `AdminSurveyForm` failure path.
2. **Client guard via expression.** Use SurveyJS row-level expression
   to set `enableIf: "{row.id} empty"` on the `key` column. Combine
   with server enforcement as a defense-in-depth.

Prefer option 2 if SurveyJS' `enableIf` works correctly per row in
this version; otherwise option 1.

### Server action

Add `saveTiers(formData)` in `lib/actions/admin.ts`:

- `requireAdminRole()`.
- `JSON.parse(formData.get('rows'))`.
- Validate each row: `key` regex, unique within payload,
  `display_name` non-empty.
- For rows with an `id`, fetch the DB `key` and reject the request if
  it differs.
- Remap each row to include `sort_order: index`.
- Call `diffAndSave({ table: 'tiers', rows, columns: [...all editable
  columns...], auditAction: 'update_tiers_bulk' })`.

### Client wrapper

`src/app/(main)/admin/tiers/TiersSurveyForm.tsx`:

- `'use client'`, `<AdminSurveyForm mode="complete" ...>`.
- `toFormData` uses the standard JSON payload convention from phases
  2–5.

### Page integration

Update `src/app/(main)/admin/tiers/page.tsx`:

- Load tiers and render `<TiersSurveyForm initial={tiers} />` for the
  editing surface.
- Keep [TierApiSecretCard.tsx](../../../src/app/(main)/admin/tiers/TierApiSecretCard.tsx)
  rendered **outside** the SurveyJS form, unchanged. Its
  "regenerate secret" action remains a separate plain `<form>`.

### Cleanup

After E2E specs pass, delete the per-row tier actions
(`createTier` / `updateTier` / `deleteTier` / `reorderTier` —
whatever exists). Verify with grep first.

---

## Part B — `/admin/auth`

### Boolean alignment first

Today, `AuthConfigForm.handleSave` writes `formData.set('enabled',
isEnabled ? 'true' : 'false')` and the corresponding action reads
`=== 'true'`. Align both to the standard `'on'` checkbox convention
used everywhere else in admin (same swap done for
`updateCsatSettings` in the deduplication change):

- `updateSocialProvider`: read `formData.get('enabled') === 'on'`.
- `updateExternalProvider`: read `formData.get('enabled') === 'on'`.

This is required so the default `AdminSurveyForm` `toFormData` works
without an override.

### Schema

Two schemas:

- `src/components/features/survey/form-json/admin/auth-social.json`
- `src/components/features/survey/form-json/admin/auth-external.json`

Each is a SurveyJS form with one `panel` per provider. Inside each
panel:

- `provider` — `text`, `readOnly: true` (the natural key).
- `enabled` — `boolean`, `renderAs: 'checkbox'`.
- The provider's credential fields, each named identically to the
  current `<input name="...">`.

Use `text` with `inputType: 'password'` for secret fields so SurveyJS
masks them.

### Client wrapper

Replace `AuthConfigForm.tsx` with two wrappers:

- `SocialAuthSurveyForm.tsx` — one `AdminSurveyForm` per social
  provider. Use `mode="autosave"` (single-record settings; matches
  pagination/privacy/CSAT pattern).
- `ExternalAuthSurveyForm.tsx` — same pattern for external providers.

Both rely on the **default** `toFormData` in `AdminSurveyForm`
(boolean → `'on'` / omit, strings trimmed). Do not pass an explicit
`toFormData` here — these are flat single-record forms, not
collections.

### Side-channel buttons

Test/verify buttons (and any "send test email"-style actions) stay
**outside** the SurveyJS forms as plain `<button onClick={...}>`
elements calling the existing actions. Do not fold them into the
schema.

### Page integration

Update `src/app/(main)/admin/auth/page.tsx`:

- Load provider configs.
- For each social provider, render
  `<SocialAuthSurveyForm provider={p} config={...} />` followed by its
  test button.
- Same for external providers using `ExternalAuthSurveyForm`.

### Cleanup

After conversion, delete `AuthConfigForm.tsx` once no page imports it.

---

## Cross-cutting

- All new schemas use the project SurveyJS theme via
  `AdminSurveyForm` / `SurveyJsonForm`. No new global CSS.
- Audit logging continues. For `saveTiers`, log a single
  `update_tiers_bulk` event with `{ added, updated, removed }`.
- Auth actions keep their existing per-action audit log entries (each
  save is one record, not a bulk).

## Tests

- `tests/e2e/subscription-tiers.spec.ts` and any tier-touching parts
  of `tests/e2e/teams-tags.spec.ts` — update to drive the tiers
  matrixdynamic.
- Auth specs — update for the new `'on'` boolean encoding and the new
  per-provider SurveyJS surface.
- `TierApiSecretCard` specs unchanged.

## Out of scope

- `/admin`, `/admin/agents`, `/admin/users`, `/admin/audit-log` —
  permanently out of scope.
- Any user-facing OAuth flow changes.

## Acceptance

- `/admin/tiers` and `/admin/auth` driven by SurveyJS for model
  editing, with side-channels preserved as plain JSX.
- Auth boolean encoding aligned to `'on'`.
- Legacy per-row tier actions deleted; `AuthConfigForm.tsx` removed.
- All E2E specs pass.
- After this phase, every admin page that edits a model is on
  SurveyJS. The only admin pages still on plain HTML are the
  list/action surfaces explicitly out of scope.
