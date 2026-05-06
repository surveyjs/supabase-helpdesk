# Change: Refactor Ticket Detail SurveyJS Form (Template-driven, No Mapping)

## Summary

Refactor the Ticket Detail editable sidebar from a hard-coded SurveyJS schema
built in [TicketSidebarSurvey.tsx](src/app/(main)/tickets/[id]/[slug]/TicketSidebarSurvey.tsx)
into a fully **template-driven** SurveyJS form whose JSON definition lives in
`app_settings` and is edited by admins through a dedicated
**SurveyJS form templates** admin section (using SurveyJS Creator / Form
Builder). All field names in the templates must match the Supabase column
names exactly — no field-name mapping layer between SurveyJS and the
database is allowed.

## Goals (in order)

1. **No name mapping.** Every SurveyJS question `name` in the ticket-detail
   templates must equal the corresponding Supabase column on `public.tickets`
   (or the canonical name for relationships such as `tag_ids` /
   `is_following`). Remove every helper, alias, or lookup table that
   translates between SurveyJS names and database column names in the
   ticket-detail flow.
2. **Two stored templates.** Persist two SurveyJS JSON definitions in
   `app_settings`:
   - `survey_ticket_detail_user_template` — shown to non-agents
   - `survey_ticket_detail_agent_template` — shown to agents
3. **Server-side trimming.** On the ticket-detail server page, fields the
   current viewer is **not allowed to see** are removed from the cloned
   template JSON **before** the SurveyJS model is constructed on the client.
4. **Server-side read-only flagging.** Fields that the viewer is **allowed to
   see but not allowed to change** get `readOnly: true` set on the question
   JSON before the model is built.
5. **Admin JSON editor section.** Templates are edited in a new admin route
   as raw SurveyJS JSON inside a SurveyJS `comment` (multiline text)
   question rendered by `SurveyJsonForm`. **Do not** use SurveyJS Creator,
   `survey-creator-react`, `survey-creator-core`, or any visual form
   builder anywhere in the app.
6. **`survey.data` initialization.** The initial ticket values are passed to
   the model via `survey.data = initial` (assignment after model construction)
   — not embedded inside the template JSON.
7. **`onValueChanged` autosave without re-render.** Each change calls the
   matching server action (e.g. status update, tag add/remove,
   privacy toggle) and **does not** trigger `router.refresh()` or any other
   page re-render. The page must continue to work after multiple consecutive
   edits without reload.

## Non-Goals

- Do **not** change the agent-dashboard filter form
  (`agent-dashboard-surveyjs-filtering.md`).
- Do **not** change the public-ticket-creation form.
- Do **not** change the existing server actions in
  [agent.ts](src/lib/actions/agent.ts) or
  [tickets.ts](src/lib/actions/tickets.ts) — only their call sites move.
- Tier-based gating rules already encoded in
  [survey-ui-config.ts](src/lib/constants/survey-ui-config.ts) (`tierControlRules`)
  remain in force; they now drive the trim/read-only decisions instead of a
  parallel `fields` boolean map.

---

## 1. Storage & Defaults

### 1.1 New `app_settings` keys

Add a new Supabase migration `supabase/migrations/NNN_ticket_detail_survey_templates.sql`
that:

- Removes (or leaves dormant) the old keys
  `survey_ticket_detail_agent_config` and `survey_ticket_detail_user_config`
  (boolean-flag JSON). Migration policy:
  - Keep the rows but mark them deprecated in a comment, OR
  - Delete the rows. Pick one and document it in the migration header.
- Inserts the two new keys with default SurveyJS templates:
  - `survey_ticket_detail_agent_template`
  - `survey_ticket_detail_user_template`
- Adds both keys to the allowlist enforced by
  [admin.ts](src/lib/actions/admin.ts) (`updateSurveyUiConfig`,
  `resetSurveyUiConfig`).

### 1.2 Default template content

Create two new constants in
[survey-ui-config.ts](src/lib/constants/survey-ui-config.ts):

```ts
export const DEFAULT_TICKET_DETAIL_AGENT_TEMPLATE: SurveyJsonDefinition = { ... };
export const DEFAULT_TICKET_DETAIL_USER_TEMPLATE: SurveyJsonDefinition = { ... };
```

Each template is a SurveyJS JSON document with **exactly these question
names** (one question per editable sidebar field), all matching Supabase /
canonical names:

| Question `name`     | Source                                  | SurveyJS type |
| ------------------- | --------------------------------------- | ------------- |
| `status`            | `tickets.status`                        | `dropdown`    |
| `urgency`           | `tickets.urgency`                       | `dropdown`    |
| `severity`          | `tickets.severity`                      | `dropdown`    |
| `type_id`           | `tickets.type_id`                       | `dropdown`    |
| `category_id`       | `tickets.category_id`                   | `dropdown`    |
| `assigned_agent_id` | `tickets.assigned_agent_id`             | `dropdown`    |
| `is_private`        | `tickets.is_private`                    | `boolean`     |
| `tag_ids`           | `ticket_tags` join (canonical)          | `tagbox`      |
| `is_following`      | `ticket_followers` presence (canonical) | `boolean`     |

The default templates are the SurveyJS JSON equivalent of what
`TicketSidebarSurvey.tsx` builds today, including:

- `defaultValue` for `status`, `urgency`, `severity`, `is_private` matching
  the Supabase NOT NULL DEFAULTs.
- `allowClear: false` for the three core dropdowns.
- The same row-grouping (`startWithNewLine: false`) layout.
- `choices` for fixed enums (`status`, `urgency`, `severity`) embedded
  literally in the template. Dynamic choices (`type_id`, `category_id`,
  `assigned_agent_id`, `tag_ids`) are intentionally left empty in the
  template JSON and are populated server-side at render time
  (see §3.3).

### 1.3 Type changes

In [survey-ui-config.ts](src/lib/constants/survey-ui-config.ts):

- Remove `TicketDetailSectionConfig.fields` and the `*_CONFIG` constants
  used for the boolean-checkbox editor (or keep them only as transient
  parsing fallbacks that immediately throw a deprecation warning).
- Keep `TicketDetailUserConfig.tierControlRules` — it now lives on the
  user template wrapper or on a sibling `app_setting` (pick the wrapper
  approach: store `{ template, tierControlRules }` under
  `survey_ticket_detail_user_template`).

---

## 2. Admin: SurveyJS Template Editor section

### 2.1 New route

Add `/admin/survey-templates` (sidebar label: **Survey Templates**). The
existing `/admin/survey-ui` page must be:

- Stripped of the two ticket-detail boolean-checkbox editors, OR
- Removed entirely, leaving only the agent dashboard config (preferred:
  remove and migrate the agent-dashboard editor into the new section as
  well, so all SurveyJS templates live in one place).

The new page lists every SurveyJS template stored in `app_settings`:

- `survey_ticket_detail_agent_template`
- `survey_ticket_detail_user_template`
- (optional, if migrated) `survey_agent_dashboard_template`

Each row links to a sub-page `/admin/survey-templates/[key]` that
renders the JSON editor described in §2.2.

### 2.2 SurveyJS-based JSON editor (no Creator)

The editor itself is a **SurveyJS `Survey`** rendered through the
existing `SurveyJsonForm` component — the same one used everywhere
else in the admin. **No SurveyJS Creator. No `survey-creator-react`.
No `survey-creator-core`. No visual form builder.**

- Build a client component
  `src/components/features/survey/SurveyTemplateEditor.tsx`. It
  renders a `SurveyJsonForm` whose schema is hard-coded:

  ```ts
  const EDITOR_SCHEMA = {
    showQuestionNumbers: 'off',
    pages: [
      {
        elements: [
          {
            type: 'comment',
            name: 'template_json',
            title: 'SurveyJS template JSON',
            rows: 24,
            isRequired: true,
            // monospace styling via survey-overrides.css
            cssClasses: { content: 'survey-template-json-editor' },
          },
        ],
      },
    ],
  };
  ```

- Initial data: `{ template_json: JSON.stringify(currentTemplate, null, 2) }`.
- A Save button (rendered outside the survey, or driven by
  `survey.onComplete`) submits the value of the `template_json`
  question to a server action.
- A Reset-to-default button calls a separate server action that
  rewrites the setting to its seeded default.
- Client-side, before submit, the JSON is parsed; on parse error,
  the survey question's error message is shown via
  `question.addError(...)` and submit is blocked.
- Server-side validation in [admin.ts](src/lib/actions/admin.ts):
  1. Parse the string as JSON; reject with a clear message on
     `SyntaxError`.
  2. Walk all `elements` (recursing into panels). Every element with a
     `name` must use one of the allowed names from the table in
     §1.2. Unknown names are rejected with a message naming the
     offending field. This prevents drift from Supabase columns.
  3. Persist the **canonicalized** JSON string (re-serialized via
     `JSON.stringify(parsed)`).

### 2.3 Tier control rules

The user template's tier rules (statusAllowedTiers, severityAllowedTiers,
typeAllowedTiers, tagsAllowedTiers, visibilityAllowedTiers) are stored
in the **same JSON document** as the template, under a sibling key, e.g.:

```json
{
  "template": { "pages": [ ... ] },
  "tierControlRules": {
    "statusAllowedTiers": ["gold"],
    "...": []
  }
}
```

The admin edits the entire wrapper JSON in the same `comment`
question. The server validator inspects the `template` sub-tree for
allowed question names and the `tierControlRules` sub-tree for the
fixed key set.

---

## 3. Ticket Detail rendering

### 3.1 Server load (`page.tsx`)

In [page.tsx](src/app/(main)/tickets/[id]/[slug]/page.tsx):

- Fetch the two new keys instead of the old `_config` keys.
- Pick the template by role: `template = isAgent ? agentTemplate : userTemplate`.
- Compute, **per question name**, two booleans:
  - `visible` — true if this viewer may see the field at all
    (combines `merged_into_id`, `isAgent`, capability flags, and
    `tierControlRules`).
  - `editable` — true if visible **and** this viewer may change the
    field. For agents: editable when visible. For users: editable when
    capability + tier rule both allow.

The rules currently encoded in `sidebarSurveyFields` move into a single
helper `computeTicketDetailFieldPolicy(...)` returning
`{ [name]: { visible, editable } }`. Place it in
`src/lib/tickets/ticket-detail-policy.ts`.

### 3.2 Template trimming + read-only flagging (server side)

Add a pure helper
`src/lib/tickets/apply-template-policy.ts`:

```ts
export function applyTemplatePolicy(
  template: SurveyJsonDefinition,
  policy: Record<string, { visible: boolean; editable: boolean }>,
): SurveyJsonDefinition;
```

- Deep-clones `template`.
- Walks every page → element (recursing into panels). For each
  element with a `name`:
  - If `policy[name].visible === false` → remove the element from its
    parent.
  - Else if `policy[name].editable === false` → set `readOnly: true`.
- Leaves elements without a `name` (decorative panels, html questions)
  untouched.
- Returns the trimmed JSON.

This trimming runs on the **server** in `page.tsx` and the result is
serialized into the props of `TicketSidebarSurvey`. The client never
sees questions it isn't allowed to see.

### 3.3 Dynamic choice injection (server side)

Before serializing to the client, inject runtime choices into the
trimmed template:

- `type_id` → `allTypes` choices
- `category_id` → `allCategories` choices (with leading `{ value: '', text: 'None' }`)
- `assigned_agent_id` → `allAgents` choices (with leading `{ value: '', text: 'Unassigned' }`)
- `tag_ids` → `allTags` choices

Implement this in the same `apply-template-policy.ts` (or a sibling
`inject-template-choices.ts`).

### 3.4 Client (`TicketSidebarSurvey.tsx`)

Replace the entire `useMemo` schema-builder + `fieldEntries` table in
[TicketSidebarSurvey.tsx](src/app/(main)/tickets/[id]/[slug]/TicketSidebarSurvey.tsx)
with:

1. Receive **trimmed template JSON** + **initial data** + **ticketId**
   as props. No more `fields`, no more `options`, no more giant
   `fieldEntries` array.
2. Construct the SurveyJS model from the JSON.
3. Set `model.data = initial` after construction (Goal #6).
4. Subscribe to `model.onValueChanged` and call `dispatchFieldChange`
   (see §3.5).
5. **Do not** call `router.refresh()` anywhere. Remove the
   `useTransition` / `setMessage` "Saved" UI driven by `router.refresh`.
   Replace with a small per-question "saving" / "saved" indicator
   sourced from a local `Map<questionName, status>` state.

`TicketSidebarSurveyProps` becomes:

```ts
export type TicketSidebarSurveyProps = {
  ticketId: string;
  templateJson: SurveyJsonDefinition; // already trimmed + choices injected
  initial: Record<string, unknown>;   // keys = SurveyJS question names = DB columns
};
```

### 3.5 Action dispatch table (no name mapping)

Create `src/lib/tickets/ticket-detail-dispatch.ts` exporting one
function per editable question, keyed **by the SurveyJS question name
which equals the DB column name**:

```ts
export const ticketDetailDispatch = {
  status:            (ticketId, value) => changeTicketStatus(...),
  urgency:           (ticketId, value) => changeUrgency(...),
  severity:          (ticketId, value) => changeSeverity(...),
  type_id:           (ticketId, value) => changeType(...),
  category_id:       (ticketId, value) => changeCategory(...),
  assigned_agent_id: (ticketId, value, prev) => assign|reassign|unassignAgent(...),
  is_private:        (ticketId, value) => toggleTicketPrivacy(...),
  tag_ids:           (ticketId, value, prev) => add/removeTagFromTicket(...),
  is_following:      (ticketId, value) => follow|unfollowTicket(...),
};
```

`TicketSidebarSurvey` simply does:

```ts
model.onValueChanged.add((sender, opt) => {
  const fn = ticketDetailDispatch[opt.name];
  if (!fn) return;
  fn(ticketId, opt.value, previousRef.current[opt.name]).then(...)
});
```

No router refresh. Update `previousRef.current[opt.name]` after the
action resolves successfully.

### 3.6 Cleanup of read-only fall-through markup in `page.tsx`

The current `page.tsx` renders read-only Markdown rows like
`detailFieldConfig.urgency && !sidebarSurveyFields.urgency && (...)`
as a fallback when the survey doesn't render a field. With server-side
trimming + read-only flagging, those fall-through `<div>` blocks are
removed; the SurveyJS form alone renders every visible field, in
read-only mode when not editable. Tag display (`<span>` chips) similarly
collapses into the survey's `tagbox` rendered as `readOnly`.

Verify the resulting page still shows e.g. urgency as a non-interactive
chip/label for users when they cannot change it. If the SurveyJS
`readOnly` rendering is too form-like, add a `survey-overrides.css`
rule that styles `.sd-question--readonly` in the sidebar to look like
the existing static chips (still a CSS-only change — no per-field
fallback markup).

---

## 4. Files to add / change / delete

### Add

- `supabase/migrations/NNN_ticket_detail_survey_templates.sql`
- `src/lib/tickets/ticket-detail-policy.ts`
- `src/lib/tickets/apply-template-policy.ts`
- `src/lib/tickets/ticket-detail-dispatch.ts`
- `src/components/features/survey/SurveyTemplateEditor.tsx`
- `src/app/(main)/admin/survey-templates/page.tsx`
- `src/app/(main)/admin/survey-templates/[key]/page.tsx`
- `src/components/features/survey/form-json/admin/ticket-detail-agent-template.json`
  (default JSON, also referenced by the migration)
- `src/components/features/survey/form-json/admin/ticket-detail-user-template.json`

### Change

- `src/lib/constants/survey-ui-config.ts` — drop `fields` boolean shape
  for ticket detail, add template constants and parsers
  (`parseTicketDetailAgentTemplate`, `parseTicketDetailUserTemplate`).
- `src/lib/actions/admin.ts` — extend allowlist; add JSON-shape
  validation for templates (only known question names).
- `src/app/(main)/admin/AdminSidebar.tsx` — add **Survey Templates**
  entry; remove the **Survey UI Config** entry if `/admin/survey-ui`
  is removed.
- `src/app/(main)/admin/survey-ui/page.tsx` and
  `src/app/(main)/admin/survey-ui/SurveyUiConfigEditor.tsx` — remove
  ticket-detail editors (or delete the route entirely).
- `src/app/(main)/tickets/[id]/[slug]/page.tsx` — replace
  `sidebarSurveyFields` + every `detailFieldConfig.X && !sidebarSurveyFields.X`
  fall-through block; pass trimmed template JSON to
  `TicketSidebarSurvey`.
- `src/app/(main)/tickets/[id]/[slug]/TicketSidebarSurvey.tsx` —
  rewrite per §3.4 / §3.5.
- `package.json` — **no new dependencies**. Reuse `survey-core` and
  `survey-react-ui` (already installed). Do **not** add
  `survey-creator-react` or `survey-creator-core`.

### Delete (or stub)

- The `fields.*` checkbox JSON
  (`DETAIL_AGENT_SCHEMA`, `DETAIL_USER_SCHEMA` in `survey-ui/page.tsx`).
- Any helper that maps `name` → DB column for ticket detail.

---

## 5. Specs to update

Update the following spec / prompt documents so they describe the new
template-driven model. **Each must be edited, not appended to:**

1. [promts/07-admin-setup.md](promts/07-admin-setup.md) — the
   `survey_ticket_detail_*_config` paragraph must be replaced with a
   description of the template keys and the new
   `/admin/survey-templates` section.
2. [promts/20-subscription-tiers.md](promts/20-subscription-tiers.md) —
   update the reference to `survey_ticket_detail_user_config` to
   `survey_ticket_detail_user_template` and explain that tier rules
   still narrow access.
3. [promts/changes/surveyjs-forms-admin-dashboard-ticket-detail.md](promts/changes/surveyjs-forms-admin-dashboard-ticket-detail.md)
   — append a "Superseded for ticket detail by
   `ticket-detail-survey-template-refactor.md`" note at the top of
   §4 (Ticket Detail Info).
4. [promts/changes/surveyjs-form-deduplication.md](promts/changes/surveyjs-form-deduplication.md)
   — note that the §6 declarative field table is now sourced from JSON,
   not from a TypeScript array.
5. [promts/changes/ticket-detail-redesign.md](promts/changes/ticket-detail-redesign.md)
   — bullet 13 ("JSON-configurable Ticket Info behavior") must reference
   the new keys.
6. [docs/architecture.md](docs/architecture.md),
   [docs/design.md](docs/design.md),
   [docs/requirements.md](docs/requirements.md) — search for
   `survey_ticket_detail_` and update; add a paragraph in
   `architecture.md` describing the trim + read-only pipeline.

---

## 6. DB tests to update

Located under `tests/db/`.

- `tests/db/007-admin.test.ts` and
  `tests/db/007a-admin-crud.test.ts`:
  - Remove assertions on `survey_ticket_detail_agent_config` /
    `_user_config`.
  - Add assertions that the two new keys
    (`survey_ticket_detail_agent_template`,
    `survey_ticket_detail_user_template`) are seeded by the new
    migration with valid SurveyJS JSON.
  - Add test: `updateSurveyUiConfig` rejects a template that contains
    a question `name` not in the allowed set
    (e.g. `unknown_field`) with a clear error.
  - Add test: `updateSurveyUiConfig` accepts a template whose every
    question name is in the allowed set.

- `tests/db/019-subscription-tiers.test.ts`:
  - If it asserts on `survey_ticket_detail_user_config.fields.*`,
    rewrite to assert against `survey_ticket_detail_user_template`
    (template + tierControlRules wrapper).

No new DB schema tests are required (no new tables or columns), but the
migration file itself must round-trip cleanly under
`tests/db/001-schema.test.ts`.

---

## 7. E2E tests to update

Located under `tests/e2e/`.

### 7.1 `tests/e2e/admin-setup.spec.ts`

- Replace the three `survey-ui-config-...` `getByTestId` assertions
  with assertions on the new `/admin/survey-templates` page:
  - The list page renders one row per template key.
  - Clicking a row opens the JSON editor
    (assert `data-testid="survey-template-editor-<key>"` is visible
    and contains a SurveyJS `comment` question with name
    `template_json`).
  - Editing the JSON in the textarea and clicking Save persists;
    reload confirms the change.
  - Reset-to-default restores the seeded template.
  - The page must **not** contain any element matching `.svc-creator`,
    `.svc-tabbed-menu`, or other SurveyJS Creator markers.
- Add a test that submitting invalid JSON or a template with an unknown
  question name surfaces a server (or client-side parse) error message
  in the UI without persisting.

### 7.2 `tests/e2e/agent-dashboard.spec.ts`

The 8 `getByTestId('ticket-sidebar-survey')` assertions remain valid
(the test id stays). Update only:

- The "make ticket private" test (currently expects a page reload via
  `router.refresh`): change it to assert that the privacy chip /
  badge updates **without a navigation event** (use
  `page.waitForLoadState('networkidle')` should not see a
  full-document load — instead poll the survey value).
- Same treatment for status / urgency / severity / type / category /
  assigned-agent / tags interactions: assert state changes via the
  survey itself or via a refetch, **not** via `expect(page).toHaveURL`
  + reload.

### 7.3 `tests/e2e/teams-tags.spec.ts`

Both `ticket-sidebar-survey` interactions there assume `router.refresh`
re-loads tags. Update to assert tag changes are persisted by reloading
the page **manually** at the end of the test (`await page.reload()`)
and re-reading the `tagbox` value, rather than relying on auto-refresh.

### 7.4 `tests/e2e/subscription-tiers.spec.ts`

Add / update tests that exercise tier-gated fields:

- Configure `survey_ticket_detail_user_template`'s
  `tierControlRules.statusAllowedTiers = ['gold']` and verify that:
  - A `gold`-tier user sees the `status` dropdown enabled.
  - A `free`-tier user sees the `status` question rendered as
    `readOnly` (or absent if visibility is also restricted) **and**
    that no name-mapping artifacts appear (e.g. inspect the SurveyJS
    JSON exposed in the page payload and assert every `name` is one of
    the canonical column names).

### 7.5 New e2e file (optional but recommended)

`tests/e2e/ticket-detail-survey-template.spec.ts`:

- Admin opens `/admin/survey-templates/survey_ticket_detail_user_template`,
  edits the JSON in the `template_json` comment question to remove the
  `severity` element, and saves.
- A non-agent user opens a ticket detail page and the `severity`
  question is absent from the rendered survey and from any payload
  embedded in the page HTML.
- Admin restores the default and severity reappears.
- Verify that triggering multiple consecutive changes
  (status → urgency → tag add → privacy toggle) does not cause a
  full-page reload (`page.on('load', ...)` counter stays at 1 from
  initial nav).

---

## 8. Acceptance criteria

- [ ] `grep` for `name:` in the trimmed templates passed to
      `TicketSidebarSurvey` returns only column-equivalent identifiers
      (`status`, `urgency`, `severity`, `type_id`, `category_id`,
      `assigned_agent_id`, `is_private`, `tag_ids`, `is_following`).
- [ ] No `mapName(...)` / `nameToColumn(...)` / similar helper exists in
      the ticket-detail flow.
- [ ] `TicketSidebarSurvey.tsx` does **not** call `router.refresh()`,
      `router.replace()`, or `window.location`.
- [ ] Admin Survey Templates page renders a `SurveyJsonForm` with a
      single `comment` question (`template_json`) and round-trips JSON
      edits via a server action. No SurveyJS Creator code or CSS is
      shipped to the client.
- [ ] Server-side `applyTemplatePolicy` removes hidden questions and
      flags read-only ones; verified by a unit test that round-trips a
      sample template through known policies.
- [ ] All updated DB / E2E tests pass.
- [ ] Old keys `survey_ticket_detail_agent_config` and
      `survey_ticket_detail_user_config` are no longer read by any
      runtime code path.
