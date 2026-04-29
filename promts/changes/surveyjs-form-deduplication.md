# Change: Remove SurveyJS Form Code Duplication

## Context

SurveyJS-driven admin forms and the ticket sidebar survey contain a large amount
of mechanical, repeated boilerplate. The SurveyJS question `name` values already
match the corresponding server-action `FormData` keys and the underlying
`app_settings` keys / DB column names. As a result, the per-form `toFormData`
mapping callbacks and the per-form `useMemo` "rename props to identical keys"
blocks are no-ops that can be centralized or removed.

This change consolidates that boilerplate, standardizes boolean encoding, and
collapses the thin admin form wrappers.

## Affected files (current state)

Wrappers that contain duplicated `toFormData` / `data` boilerplate:

- `src/app/(main)/admin/csat/CsatSettingsSurveyForm.tsx`
- `src/app/(main)/admin/pagination/AdminPaginationSurveyForm.tsx`
- `src/app/(main)/admin/rate-limit/AdminRateLimitSurveyForm.tsx`
- `src/app/(main)/admin/privacy/AdminPrivacySurveyForm.tsx`
- `src/app/(main)/admin/email/EmailConfigForm.tsx` (SMTP + delay sub-forms)
- `src/app/(main)/admin/inbound-email/InboundEmailForm.tsx` (config sub-form)

Other locations with duplicated mapping:

- `src/app/(main)/admin/survey-ui/page.tsx` — three hand-written
  flatten-to-dotted-key blocks (`enabledFilters.*`, `fields.*`,
  `tierControlRules.*`).
- `src/app/(main)/tickets/[id]/[slug]/TicketSidebarSurvey.tsx` — mirrored
  `if (fields.X)` blocks: one to build the schema, one to dispatch server
  actions on change.

Shared components updated:

- `src/components/features/survey/AdminSurveyForm.tsx`

Server action whose boolean dialect is updated:

- `src/lib/actions/admin.ts` — `updateCsatSettings`

## Requirements

### 1. Default `toFormData` inside `AdminSurveyForm`

Make `toFormData` optional. When omitted, `AdminSurveyForm` builds the
`FormData` automatically from the SurveyJS data object using these rules:

- Iterate own enumerable keys of the data object.
- Skip `undefined` and `null` values.
- `boolean true` → `fd.set(key, 'on')`. `boolean false` → omit the key.
  (Matches the standard HTML checkbox convention used by the majority of
  existing server actions.)
- `string` → `fd.set(key, value.trim())`.
- `number` → `fd.set(key, String(value))`.
- `string[]` → `fd.set(key, value.join(','))` (used by tag-style inputs;
  no current admin form needs this, but the rule keeps the helper general).
- Any other type → `fd.set(key, String(value))`.

Callers may still pass an explicit `toFormData` to override (kept as the
escape hatch; nothing currently needs it after this refactor).

### 2. Standardize boolean encoding on `'on'`

`updateCsatSettings` in `src/lib/actions/admin.ts` currently reads
`formData.get('csat_enabled') === 'true'`. Change it to
`formData.get('csat_enabled') === 'on'` so it matches the convention used by
every other admin action (`allow_user_privacy_control`, `inbound_email_enabled`,
`enforce_display_name_uniqueness`, etc.).

After this, the default `toFormData` in `AdminSurveyForm` is correct for
every existing admin form.

`csat_survey_delay` is a string; nothing changes for that field beyond being
emitted via the default trimmer.

### 3. Drop no-op `useMemo data` blocks in admin wrappers

In each of the wrapper files listed above, remove the `useMemo` whose only job
is to rename incoming props into identically-named keys. Pass the props (or a
plain object literal built once at render) directly as `data` to
`AdminSurveyForm`.

### 4. Remove per-wrapper `toFormData` callbacks

In each wrapper file listed above, remove the bespoke `toFormData` `useMemo`
and the `toFormData={...}` prop on `<AdminSurveyForm>`. Rely on the default
implementation added in (1).

After (3) and (4), each wrapper should reduce to roughly:

- imports,
- the component shell (kept where it adds non-form UI such as warnings, links,
  test-email button, auto-reply template list),
- one `<AdminSurveyForm schema={schema} data={...} saveAction={...} />`.

For `EmailConfigForm.tsx` and `InboundEmailForm.tsx`, keep the surrounding
JSX (status badge, "Send Test Email" button, auto-reply template list, helper
text) unchanged — only the form-mapping boilerplate is removed.

### 5. Generic flatten helper for `admin/survey-ui/page.tsx`

Replace the three hand-written objects (`dashboardEditorData`,
`detailAgentEditorData`, `detailUserEditorData`) with a single small helper:

```ts
function flatten(obj: Record<string, unknown>, prefix = ''): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      Object.assign(out, flatten(v as Record<string, unknown>, key));
    } else if (Array.isArray(v)) {
      out[key] = v.join(', ');
    } else {
      out[key] = v;
    }
  }
  return out;
}
```

Use it as `flatten(dashboardConfig)`, `flatten(detailAgentConfig)`,
`flatten(detailUserConfig)`. The array-join-with-`', '` branch matches the
existing handling for `tierControlRules.*` arrays.

Place the helper either co-located in `page.tsx` or in
`src/lib/utils/flatten.ts` if reused elsewhere.

### 6. Declarative field table for `TicketSidebarSurvey`

Refactor `TicketSidebarSurvey.tsx` so that each editable sidebar field is
described once. Define a list (built inside `useMemo`/closure to capture
`options`, `ticketId`, etc.) where each entry contains:

- `flag`: which `fields.*` boolean gates it,
- `schema`: the SurveyJS element fragment for that field (without
  `startWithNewLine` — see below),
- `dispatch(prev, next)`: returns a `Promise<unknown> | null` representing
  the server action to run when the value changes (or `null` when there is
  nothing to do).

Then:

- Build `schema.pages[0].elements` by filtering the table on `flag` and
  applying the existing row-grouping logic (the first element in a logical
  row keeps `startWithNewLine` default; the rest get `startWithNewLine: false`).
  Preserve the current logical groups: `[status, urgency]`, `[severity, type]`,
  `[category]`, `[assigned]`, `[tags]`, `[visibility, follow]`.
- In `onValueChanged`, iterate the same filtered table and call each entry's
  `dispatch(prev, next)`; collect non-null results into `tasks` and
  `await Promise.all(tasks)` exactly as today.
- Keep the existing `previousRef` snapshot update, the `aria-live` status
  indicator (`data-testid="ticket-sidebar-survey-status"`), and
  `router.refresh()` behavior unchanged.

The two parallel `if (fields.X)` ladders must be gone; each field is defined in
exactly one place.

### 7. No behavioural changes

- All server actions, validation, and authorization remain unchanged
  (except the single `'true'` → `'on'` swap in `updateCsatSettings`).
- The visual layout of admin forms and the ticket sidebar must be unchanged.
- The autosave debounce timing and `aria-live` messages remain the same.
- All existing `data-testid` hooks must be preserved.

### 8. Tests

- Existing E2E specs covering CSAT admin, privacy, pagination, rate limit,
  email config, inbound email, survey UI config, agent dashboard filters,
  and ticket detail sidebar must all continue to pass without modification.
- If any spec asserts on the literal string `'true'` / `'false'` being
  sent for `csat_enabled`, update it to `'on'` / absent (this is the only
  intentional wire-format change).

## Out of scope

- `AgentFiltersSurvey` (URL-param-driven, no `FormData`) is not part of this
  change.
- Schema JSON files in `src/components/features/survey/form-json/admin/` are
  not modified.
- The `SurveyJsonForm` low-level wrapper is not modified.
