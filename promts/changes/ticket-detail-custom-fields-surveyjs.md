# Change: Render Ticket Detail Custom Fields via SurveyJS

## Summary

The custom fields block in the ticket detail right sidebar
([page.tsx](src/app/(main)/tickets/[id]/[slug]/page.tsx) around the
`data-testid="custom-fields"` `<dl>`) is currently rendered as hand-written
JSX with per-field `<form action={updateCustomFieldValue}>` `<details>` /
`<summary>` editors. Replace this custom HTML with **SurveyJS questions
generated into the same `TicketSidebarSurvey` model** that already drives
the standard sidebar fields (status, urgency, severity, type, category,
assignee, visibility, tags, follow).

The Ticket Detail templates (agent + user) gain a new opt-out boolean
**`autoGenerateCustomFields`** that controls whether the server
auto-injects one SurveyJS question per `public.custom_fields` row, or
defers entirely to whatever the admin authored in the template JSON.

Authoring custom fields by hand in the template JSON is supported via
the canonical question-name convention `custom_fields.<name>` (one dotted
key per custom field).

## Goals

1. **One SurveyJS model.** The sidebar has a single
   `TicketSidebarSurvey` rendering all editable fields, including custom
   fields. No parallel custom-HTML editor block remains.
2. **Opt-out auto-generation.** Each ticket-detail template wrapper gains
   `autoGenerateCustomFields: boolean` (default `true`). When `true`,
   the server scans `custom_fields` rows and adds one SurveyJS question
   per row to a dedicated "Custom Fields" panel before handing the JSON
   to the client. When `false`, the server makes **no** automatic
   additions — the admin authors custom-field questions directly in the
   template JSON using `custom_fields.<name>` question names.
3. **Read-only enforcement.** Custom-field questions are flagged
   `readOnly: true` server-side when the viewer is neither the ticket
   owner nor an agent. The same `applyTemplatePolicy` pipeline that
   handles the standard fields handles custom-field policy decisions.
4. **Autosave via existing dispatcher.** A new entry in
   `ticketDetailDispatch` handles custom-field question names (matched
   by the `custom_fields.` prefix) and calls
   `updateCustomFieldValue` once per changed value. No `router.refresh()`.
5. **Spec parity.** [docs/requirements.md](docs/requirements.md) §3.13
   and §16.14 are updated to describe the SurveyJS rendering and the
   new admin toggle.
6. **Quality gate.** End with `npm run lint`, `npm run typecheck`,
   `npm run test` (vitest), then `npm run test:e2e` (Playwright), and
   fix every failure the changes introduce.

## Non-goals

- Do **not** change the admin `/admin/custom-fields` matrix or the
  `custom_fields` table schema.
- Do **not** change the ticket **creation** form (custom fields there
  are out of scope).
- Do **not** introduce SurveyJS Creator or any visual form builder.
- Do **not** change `updateCustomFieldValue`'s validation contract —
  the new dispatcher must call it with the same `FormData` shape
  (`ticket_id`, `field_name`, `value`).

---

## 1. Template wrapper schema

### 1.1 Add `autoGenerateCustomFields`

Extend [src/lib/constants/survey-ui-config.ts](src/lib/constants/survey-ui-config.ts):

```ts
export type TicketDetailTemplateWrapper = {
  template: SurveyJsonDefinition;
  tierControlRules: TicketDetailTierControlRules;
  autoGenerateCustomFields: boolean; // NEW — default true
};
```

Update `DEFAULT_TICKET_DETAIL_AGENT_TEMPLATE` and
`DEFAULT_TICKET_DETAIL_USER_TEMPLATE` to set
`autoGenerateCustomFields: true`.

Update `parseTemplateWrapper` to read the new field:

- Missing/non-boolean → `true` (default).
- Persist exactly as the admin authored it.

### 1.2 Allow `custom_fields.*` question names

In the same file, `TICKET_DETAIL_ALLOWED_QUESTION_NAMES` currently
enumerates a fixed list. Replace
`findInvalidTicketDetailQuestionNames(template)` with a predicate that
accepts:

- Any name in the existing allowlist, **or**
- Any name matching the regex `^custom_fields\.[A-Za-z0-9_\- ]+$`.

Document the convention in a JSDoc comment on the export. The matching
custom-field row is looked up by the substring after `custom_fields.`
and is case-sensitive — it must equal `custom_fields.name` exactly.

### 1.3 Admin JSON validator update

The admin save flow already rejects unknown question names via
`findInvalidTicketDetailQuestionNames`. With the new predicate it must
now additionally validate, when `autoGenerateCustomFields === false`,
that every `custom_fields.<name>` question name corresponds to an
existing `public.custom_fields.name` row at save time, and surface a
single error message listing every unknown custom-field name (e.g.
`"Unknown custom field(s): foo, bar"`). When
`autoGenerateCustomFields === true`, do **not** validate
`custom_fields.*` names at save time (admins may pre-author hand-named
questions that will simply be overwritten by the auto-generator at
render time — see §2.3).

---

## 2. Server-side rendering pipeline

### 2.1 Custom-field auto-generation helper

Create `src/lib/tickets/custom-fields-template.ts`:

```ts
type CustomFieldDef = {
  id: string;
  name: string;
  field_type: 'text' | 'number' | 'dropdown' | 'checkbox' | 'date';
  is_required: boolean;
  options: string[] | null;
  default_value: unknown;
  display_order: number;
};

export function buildCustomFieldsPanel(
  defs: CustomFieldDef[],
): SurveyJsonDefinition | null;

export function injectCustomFieldsPanel(
  template: SurveyJsonDefinition,
  defs: CustomFieldDef[],
): SurveyJsonDefinition;
```

- `buildCustomFieldsPanel` returns a single SurveyJS `panel` element
  named `custom_fields_panel` with one question per def, ordered by
  `display_order`. The panel's `title` is `"Custom Fields"`. Returns
  `null` when `defs.length === 0`.
- Per-def SurveyJS question mapping:
  - `text` → `{ type: 'text', name: 'custom_fields.<name>',
    title: '<name>', maxLength: 1000 }`
  - `number` → `{ type: 'text', inputType: 'number', name: ... }`
  - `dropdown` → `{ type: 'dropdown', choices: options,
    allowClear: !is_required }`
  - `checkbox` → `{ type: 'boolean' }`
  - `date` → `{ type: 'text', inputType: 'date' }`
  - `isRequired` is set to `is_required` for all types.
  - For non-checkbox fields with a `default_value`, set `defaultValue`
    to the parsed default. (The autosave dispatch does **not** persist
    a question that still equals its initial value, so defaults are
    purely visual seeds for empty tickets.)
- `injectCustomFieldsPanel` clones the template and **appends** the
  generated panel as the last element of the last page (creating a
  page if the template has none). Returns the new tree unchanged when
  `defs.length === 0`.

If the admin's template JSON already contains a `custom_fields_panel`
element (i.e. they hand-authored one in auto-generate mode), the
auto-generator first **removes** that existing panel before injecting
its own. Hand-authored questions outside of `custom_fields_panel` that
use `custom_fields.<name>` names are also stripped in auto-generate
mode to avoid duplicate questions for the same name.

### 2.2 Wire into `page.tsx`

In [src/app/(main)/tickets/[id]/[slug]/page.tsx](src/app/(main)/tickets/[id]/[slug]/page.tsx):

1. Fetch `custom_fields` (already done — keep
   `const { data: customFieldDefs } = await supabase.from('custom_fields')...`).
   Pass them into a new policy + injection pipeline:

   ```ts
   const tplWrapper = isAgent ? detailAgentTemplate : detailUserTemplate;

   let workingTemplate = tplWrapper.template;
   if (tplWrapper.autoGenerateCustomFields) {
     workingTemplate = injectCustomFieldsPanel(
       workingTemplate,
       customFieldDefs ?? [],
     );
   }
   ```

2. Extend `computeTicketDetailFieldPolicy` (see §2.4) so it returns
   `{ visible, editable }` for every `custom_fields.<name>` produced by
   the working template (auto or hand-authored). Pass the working
   template (or the list of custom-field names + the cf defs) into the
   policy helper.

3. Run `applyTemplatePolicy(workingTemplate, policy)` and
   `injectTemplateChoices(...)` as today.

4. Extend `sidebarTemplateInitial` with one entry per cf def whose
   value exists on the ticket:

   ```ts
   for (const def of customFieldDefs ?? []) {
     const v = (ticket.custom_fields as Record<string, unknown> | null)?.[def.name];
     if (v !== undefined) sidebarTemplateInitial[`custom_fields.${def.name}`] = v;
   }
   ```

5. Delete the old `<div data-testid="custom-fields">` block and the
   `import { updateCustomFieldValue } from '@/lib/actions/admin'` line.
   The `data-testid="custom-fields"` selector moves onto the
   auto-generated panel (set it via the panel's `name` and a wrapper
   `<div data-testid="custom-fields">` in `TicketSidebarSurvey.tsx` if
   needed — or apply it through a SurveyJS `cssClassName` / wrapper
   in the client component). Keep the testid so existing e2e tests can
   still locate the section.

### 2.3 Field-policy extension

Update [src/lib/tickets/ticket-detail-policy.ts](src/lib/tickets/ticket-detail-policy.ts):

- Add a new optional input `customFieldNames: string[]` (the canonical
  cf names — without the `custom_fields.` prefix).
- For each name, set
  `policy['custom_fields.' + name] = { visible: true,
   editable: !isMerged && (isAgent || isOwner) && !isBlocked }`.
- The existing standard-field rules are unchanged.

Update `findInvalidTicketDetailQuestionNames` callers to also tolerate
`custom_fields.*` (per §1.2).

### 2.4 Dispatcher

Extend [src/lib/tickets/ticket-detail-dispatch.ts](src/lib/tickets/ticket-detail-dispatch.ts):

- Replace the bare `Record<string, TicketDetailDispatcher>` lookup with
  a small function `getDispatcher(name: string): TicketDetailDispatcher | undefined`
  that:
  - Returns the existing static handler for non-prefixed names.
  - Returns a dynamic handler for any name starting with
    `custom_fields.` which calls `updateCustomFieldValue` with
    `{ ticket_id, field_name, value }` where `field_name` is the
    portion after the prefix.
- Update `TicketSidebarSurvey.tsx` to call `getDispatcher(options.name)`
  instead of indexing the record. No other client changes needed —
  the existing `previousRef` / revert-on-error logic must continue to
  work for custom-field questions.
- The dynamic handler must coerce its `value` payload to the string
  shape `updateCustomFieldValue` already parses:
  - boolean → `'true'` / `'false'`
  - number → `String(n)`
  - date → ISO string already produced by SurveyJS `inputType: 'date'`
  - text / dropdown → as-is
  - `null` / `undefined` → empty string (the action treats empty
    non-checkbox values as no-op).

### 2.5 `updateCustomFieldValue` return shape

`updateCustomFieldValue` currently returns `Promise<void>` and is
invoked from a server-side `<form action>`. Keep the existing signature
but make the action **resolve** on success and **throw** on failure
(it currently silently `return`s on validation errors). The
`TicketSidebarSurvey` `.catch` handler relies on a rejected promise to
trigger the revert + error message — make the failure paths throw a
narrow `Error('Failed to update custom field')` instead of returning.
Add a small wrapper at the dispatcher boundary if needed to convert
silent failures into throws without breaking the existing form-action
callers (the only caller is being deleted in §2.2, so it is safe to
change the contract directly).

---

## 3. Admin templates UI

In [src/app/(main)/admin/survey-templates/page.tsx](src/app/(main)/admin/survey-templates/page.tsx)
and the per-template editor:

- Render `autoGenerateCustomFields` as a separate boolean SurveyJS
  question above the JSON `comment` editor (or as a stand-alone
  checkbox if the editor route is plain HTML). Persist it inside the
  wrapper JSON next to `template` and `tierControlRules`.
- When the toggle is `true`, display a short hint:
  *"Custom fields are added automatically; any `custom_fields.*`
  questions in the JSON below are replaced at render time."*
- When the toggle is `false`, display:
  *"Add one question per custom field using the name
  `custom_fields.<field name>`."*
- The "Default" / "Custom" status pill on the list page must compare
  the entire wrapper (including `autoGenerateCustomFields`) — the
  existing `stableStringify`-based comparison handles this once the
  defaults include the new key.

---

## 4. Spec updates

### 4.1 `docs/requirements.md`

Replace §3.13 with the SurveyJS-aware description:

> **3.13. Custom fields** — Tickets can have additional custom fields
> defined by the admin (see 16.14). Custom fields are stored as a JSON
> object on the ticket. On the ticket creation form, custom fields are
> displayed after the standard fields. On the ticket detail page,
> custom fields are rendered as questions in the same SurveyJS sidebar
> form that drives the standard editable fields. Each ticket-detail
> template wrapper (`survey_ticket_detail_agent_template`,
> `survey_ticket_detail_user_template`) has an
> `autoGenerateCustomFields` boolean (default `true`). When `true`,
> the server appends a "Custom Fields" panel with one question per
> defined custom field before the model is constructed. When `false`,
> the admin authors `custom_fields.<name>` questions directly in the
> template JSON; only questions whose name matches an existing custom
> field are accepted. The ticket owner and agents can edit custom
> field values; all other viewers see the questions as read-only.

Add a sentence to §16.14 noting the new toggle:

> The admin can also choose, per ticket-detail template (agent / user),
> whether custom fields are auto-injected into the sidebar SurveyJS
> form or authored manually as `custom_fields.<name>` questions in the
> template JSON (see 16.30 / Survey Templates).

(Use whichever cross-reference matches the current Survey Templates
section number — keep numbering consistent with the surrounding
document.)

### 4.2 Cross-references

Update the existing change docs that touch this surface to reference
this new doc:

- [promts/changes/ticket-detail-survey-template-refactor.md](promts/changes/ticket-detail-survey-template-refactor.md)
  — append a "Superseded for custom fields by
  `ticket-detail-custom-fields-surveyjs.md`" note at the top.
- [promts/changes/surveyjs-forms-admin-dashboard-ticket-detail.md](promts/changes/surveyjs-forms-admin-dashboard-ticket-detail.md)
  — same superseded note in the Ticket Detail section.

### 4.3 `docs/architecture.md` and `docs/design.md`

If either file describes the sidebar's custom-field rendering as
"custom HTML form", update it to "SurveyJS questions injected by the
template-policy pipeline; controlled by the
`autoGenerateCustomFields` toggle on each template wrapper."

---

## 5. Migration

Add `supabase/migrations/NNN_ticket_detail_autogenerate_custom_fields.sql`:

- For each existing `app_settings` row whose key is one of
  `survey_ticket_detail_agent_template` or
  `survey_ticket_detail_user_template`, parse the JSON value, add
  `"autoGenerateCustomFields": true` to the wrapper if missing,
  re-serialize, and write it back.
- Rows that are missing entirely (i.e. defaults are in use) do not
  need to be touched — the runtime default already covers them.
- Use `jsonb_set` (or a PL/pgSQL block) for the rewrite; do **not**
  drop or re-create the rows.

---

## 6. Tests

### 6.1 Unit tests

Add `src/lib/tickets/__tests__/custom-fields-template.test.ts`:

- Generates one question per def, sorted by `display_order`.
- Handles every `field_type` correctly (incl. `is_required` →
  `isRequired`).
- Returns `null` from `buildCustomFieldsPanel` for an empty list.
- `injectCustomFieldsPanel` removes prior `custom_fields_panel` and
  prior duplicate-named `custom_fields.*` questions.
- No-op when the def list is empty.

Add `src/lib/tickets/__tests__/ticket-detail-policy.custom-fields.test.ts`:

- `editable: false` for non-owner non-agent.
- `editable: false` when ticket is merged, even for owner/agent.
- `editable: true` for owner who is not blocked.
- `editable: true` for agent.
- `visible: true` in all the above cases.

Extend `src/lib/constants/__tests__/survey-ui-config.test.ts` (or add
a new test file) covering:

- `parseTicketDetailAgentTemplate` / `parseTicketDetailUserTemplate`
  default `autoGenerateCustomFields` to `true`.
- `findInvalidTicketDetailQuestionNames` accepts
  `custom_fields.<name>` and rejects malformed prefixes (e.g.
  `custom_fields.` with no suffix, `custom_field.foo`).

### 6.2 E2E tests

Update / add Playwright specs under `tests/e2e/`:

- `tests/e2e/ticket-detail-custom-fields.spec.ts` (new): with a
  seeded `custom_fields` row, opening a ticket as the owner shows the
  custom-field question inside `[data-testid="ticket-sidebar-survey"]`,
  editing it autosaves (assert via the
  `[data-testid="ticket-sidebar-survey-status"]` aria-live region and
  via re-loading the page), and the value is persisted to
  `ticket.custom_fields`.
- Same spec, signed in as a regular non-owner user with access to a
  public ticket: the custom-field question is visible but the input
  is disabled (`readOnly`).
- Same spec, as an agent: editable on any ticket.
- Admin spec: toggling `autoGenerateCustomFields = false` in the
  Survey Templates editor and saving a template that omits a
  `custom_fields.*` question causes that field to no longer appear in
  the sidebar (verifying opt-out works).
- Any existing e2e that depended on the old custom HTML
  (`.contents > dt`, the `✎` `<summary>`, the inline `<form>`) must be
  updated to use SurveyJS selectors. Grep `tests/e2e` for `✎`,
  `custom-fields`, `ticket-custom-field`, and similar markers and
  migrate them.

---

## 7. Run order

Execute, in this order, and fix any failure before proceeding:

1. `npm run lint`
2. `npm run typecheck`
3. `npm run test` (vitest unit + integration suite)
4. `npm run test:e2e` (Playwright)

For each failing test caused by this change:

- If the failure is an outdated selector / shape assertion, update
  the test to match the SurveyJS-rendered DOM.
- If the failure is a real regression (e.g. dispatcher does not fire,
  read-only flag missing, autosave does not persist), fix the
  implementation and re-run from step 1.

Do **not** silence failures with `test.skip` or `test.fixme`. The
suite must be fully green at the end of the run.

---

## Acceptance criteria

- [ ] The `data-testid="custom-fields"` block of legacy JSX in
      `page.tsx` is deleted; the only renderer of custom fields on
      the ticket detail page is `TicketSidebarSurvey`.
- [ ] `TicketDetailTemplateWrapper.autoGenerateCustomFields` exists,
      defaults to `true`, and round-trips through
      `parseTicketDetailAgentTemplate` / `parseTicketDetailUserTemplate`.
- [ ] When `autoGenerateCustomFields === true`, every row in
      `public.custom_fields` produces exactly one SurveyJS question in
      the sidebar.
- [ ] When `autoGenerateCustomFields === false`, the sidebar shows
      only the `custom_fields.*` questions explicitly authored in the
      template JSON, and unknown custom-field names are rejected at
      save time with a clear error message.
- [ ] Non-owner non-agent viewers see custom-field questions as
      `readOnly`.
- [ ] Editing a custom-field question autosaves via
      `updateCustomFieldValue` without `router.refresh()`; the status
      indicator transitions through `Saving… → Saved`; on failure the
      value reverts.
- [ ] `npm run lint`, `npm run typecheck`, `npm run test`, and
      `npm run test:e2e` all pass.
