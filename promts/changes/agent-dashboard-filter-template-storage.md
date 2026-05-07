# Change: Store Agent Dashboard Filter Form as a SurveyJS Template in Supabase

## Summary

Move the Agent Dashboard ticket-filtering form's SurveyJS JSON definition out
of code and into Supabase as an `app_settings` template, edited from the
**same** admin section as the two ticket-detail templates
(`/admin/survey-templates`). This is the migration that the
[ticket-detail-survey-template-refactor.md](./ticket-detail-survey-template-refactor.md)
spec marks as "(optional, if migrated) `survey_agent_dashboard_template`" —
this change makes it required and concrete.

After this change, the JSON definition of the agent-dashboard filter form
is:

1. Persisted in `app_settings` under the key
   `survey_agent_dashboard_template`.
2. Editable through the **Survey Templates** admin section at
   `/admin/survey-templates/[key]`, using the same
   `SurveyTemplateEditor` (`SurveyJsonForm` + `comment` JSON editor) used
   for the user/agent ticket-detail templates. **No SurveyJS Creator. No
   visual form builder.**
3. Trimmed/augmented server-side at render time only with the dynamic
   `choices` (categories, types, agents, teams, tiers, tags) — never
   re-derived from code-side boolean flags.

## Goals (in order)

1. **One stored template for the filter form.** Replace the code-built
   schema in
   [src/lib/filters/ticket-filter-survey.ts](src/lib/filters/ticket-filter-survey.ts)
   (`buildTicketFilterSurveyJson`) with a SurveyJS JSON template loaded
   from `app_settings.survey_agent_dashboard_template`.
2. **No name mapping.** Question `name`s in the template must continue to
   equal the SQL filter / column keys consumed by
   [src/lib/filters/ticket-filter.ts](src/lib/filters/ticket-filter.ts)
   (`q`, `email`, `status`, `urgency`, `severity`, `category`, `type`,
   `agent`, `team`, `tier`, `tags`, `sort`). No alias layer.
3. **Same admin section as the ticket-detail templates.** All three
   templates are listed and edited at `/admin/survey-templates`:
   - `survey_ticket_detail_agent_template`
   - `survey_ticket_detail_user_template`
   - `survey_agent_dashboard_template` (added by this change)
4. **Server-side dynamic choices.** The template stores the **shape** of
   each `dropdown` / `tagbox` (name, title, type, layout) but its
   `choices` for fields backed by database lookups
   (`category`, `type`, `agent`, `team`, `tier`, `tags`) are intentionally
   left empty in the JSON and populated server-side at render time, the
   same way ticket-detail dynamic choices are populated.
5. **Retire the boolean `enabledFilters` map.** The
   `survey_agent_dashboard_config.enabledFilters` boolean map is replaced
   by simply including or omitting the corresponding question from the
   stored template. Admins disable a filter by deleting the question from
   the template JSON.

## Non-Goals

- Do **not** change the SQL generator
  ([src/lib/filters/ticket-filter.ts](src/lib/filters/ticket-filter.ts)
  `generateSqlFromJson`). Question names already match SQL keys.
- Do **not** change the saved-views storage shape
  (`{ type, data, sql }`) introduced by
  [agent-dashboard-surveyjs-filtering.md](./agent-dashboard-surveyjs-filtering.md).
- Do **not** change the ticket-detail templates or their editor — only
  add a third entry alongside them.
- Do **not** introduce SurveyJS Creator / `survey-creator-react` /
  `survey-creator-core`.

---

## 1. Storage

### 1.1 New `app_settings` key

Add a new Supabase migration
`supabase/migrations/NNN_agent_dashboard_survey_template.sql` that:

- Inserts `survey_agent_dashboard_template` into `app_settings` with the
  default JSON template (see §1.2).
- Adds the key to the allowlist enforced by
  [src/lib/actions/admin.ts](src/lib/actions/admin.ts) wherever the
  ticket-detail template keys are allowlisted (template update + reset
  server actions).
- Either deletes `survey_agent_dashboard_config` rows, or keeps them
  dormant for one release with a deprecation comment in the migration
  header. Pick one and document the choice. The application code path
  must stop reading this key in this change.

### 1.2 Default template content

Create a constant in
[src/lib/constants/survey-ui-config.ts](src/lib/constants/survey-ui-config.ts):

```ts
export const DEFAULT_AGENT_DASHBOARD_TEMPLATE: SurveyJsonDefinition = { ... };
```

Its content is the SurveyJS JSON equivalent of what
`buildTicketFilterSurveyJson` produces today with **all** filters enabled
(see the function for the canonical shape). In particular:

| Question `name` | Type       | Notes                                                          |
| --------------- | ---------- | -------------------------------------------------------------- |
| `q`             | `text`     | `inputType: 'search'`                                          |
| `email`         | `text`     |                                                                |
| `status`        | `checkbox` | `colCount: 0`, `minSelectedChoices: 1`, default all three      |
| `urgency`       | `dropdown` | static choices `low/medium/high/critical`                      |
| `severity`      | `dropdown` | static choices `low/medium/high/critical`                      |
| `category`      | `dropdown` | empty `choices`, populated server-side                         |
| `type`          | `dropdown` | empty `choices`, populated server-side                         |
| `agent`         | `dropdown` | empty `choices`, populated server-side                         |
| `team`          | `dropdown` | empty `choices`, populated server-side                         |
| `tier`          | `dropdown` | empty `choices`, populated server-side                         |
| `tags`          | `tagbox`   | empty `choices`, populated server-side                         |
| `sort`          | `dropdown` | static sort options matching today's set                       |

The "Apply Filters" navigation button and the "Clear All" navigation
button (§agent-dashboard-surveyjs-filtering.md) are **not** part of the
stored template — they remain registered in client code on the live
`SurveyModel`.

### 1.3 Type changes in `survey-ui-config.ts`

- Remove `AgentDashboardSurveyConfig.enabledFilters` (and the related
  `*_CONFIG` constant if it is no longer referenced after the
  application code stops reading
  `survey_agent_dashboard_config`).
- If `survey_agent_dashboard_config` had any non-`enabledFilters`
  fields still in use, migrate them onto the wrapper persisted under
  `survey_agent_dashboard_template` (e.g. store
  `{ template, defaultSort? }`). Otherwise persist the bare template
  JSON, mirroring the ticket-detail keys.

---

## 2. Admin: Survey Templates section

The new key is added to the existing **Survey Templates** admin
section introduced by
[ticket-detail-survey-template-refactor.md](./ticket-detail-survey-template-refactor.md).
No new route or component is created.

### 2.1 Template list page (`/admin/survey-templates`)

Render an additional row for `survey_agent_dashboard_template`
alongside the two ticket-detail rows. The row links to
`/admin/survey-templates/survey_agent_dashboard_template`.

### 2.2 Template editor sub-page

The existing `/admin/survey-templates/[key]` page must accept the new
key, load it from `app_settings`, and render the same
`SurveyTemplateEditor` (the `SurveyJsonForm` with the hard-coded
`comment` JSON editor schema described in
[ticket-detail-survey-template-refactor.md §2.2](./ticket-detail-survey-template-refactor.md)).

- Save → server action validates JSON syntax, walks the schema, and
  rejects any element whose `name` is not in the allowed set listed in
  §1.2.
- Reset to default → rewrites the setting to
  `DEFAULT_AGENT_DASHBOARD_TEMPLATE`.
- On save, revalidate `/admin/survey-templates`, the editor sub-page,
  and `/agent`.

### 2.3 Authorization

Same allowlist + admin-only role check used by the existing
template editor server actions; just extend the allowlist set with
the new key.

---

## 3. Agent Dashboard wiring

### 3.1 `src/lib/filters/ticket-filter-survey.ts`

- **Delete** `buildTicketFilterSurveyJson` (the code-built schema
  driven by `enabledFilters`).
- Replace it with a function that:
  1. Accepts the loaded template JSON (string or parsed object) plus
     `FilterOptions`.
  2. Clones the template and walks its `elements`, populating
     `choices` for `category`, `type`, `agent`, `team`, `tier`,
     and `tags` from `FilterOptions`.
  3. Returns the resulting JSON ready to be passed to a `SurveyModel`.
- The "Apply Filters" / "Clear All" navigation buttons continue to be
  registered on the live `SurveyModel` in client code (e.g. inside
  `ViewsAndFiltersPanel`); they are **not** in the template.

### 3.2 `src/app/(main)/agent/page.tsx`

- Stop reading `app_settings.survey_agent_dashboard_config`.
- Load `app_settings.survey_agent_dashboard_template`
  (falling back to `DEFAULT_AGENT_DASHBOARD_TEMPLATE` if the row is
  missing).
- Pass the populated JSON down to `ViewsAndFiltersPanel` in place of
  the previous `(config, filterOptions)` pair.

### 3.3 `src/app/(main)/agent/ViewsAndFiltersPanel.tsx`

- Replace its current call to `buildTicketFilterSurveyJson(config,
  options)` with the new template-driven call.
- Continue to register the `Apply Filters` Complete-button label and
  the `Clear All` navigation item exactly as today
  ([agent-dashboard-surveyjs-filtering.md](./agent-dashboard-surveyjs-filtering.md)).

### 3.4 SQL generator

`src/lib/filters/ticket-filter.ts` (`generateSqlFromJson`) is
**unchanged**. The contract — that question names equal SQL keys — is
preserved by the §2.2 server-side validator that rejects unknown names.

---

## 4. Migration of existing data

The agent dashboard filter form is currently shaped entirely by code,
so there is no per-tenant data to migrate other than the now-unused
`survey_agent_dashboard_config` row (handled by the migration in §1.1).
Saved Views (`saved_views.filters`) already store a
`{ type, data, sql }` object whose `data` keys are SQL filter keys; no
change is needed to existing rows.

---

## 5. Required updates to specs / prompts / tests

> **Instruction to the implementing agent:** the change above touches
> the same artifacts as several existing specs and prompts. Update
> every place listed below in the same PR. If a search reveals
> references to `survey_agent_dashboard_config` or `enabledFilters`
> outside this list, treat those as additional required edits.

### 5.1 Specs (`docs/`)

- [docs/architecture.md](docs/architecture.md) — wherever
  `app_settings` keys or the agent-dashboard filter form are listed,
  add `survey_agent_dashboard_template` and remove
  `survey_agent_dashboard_config`.
- [docs/design.md](docs/design.md) — update the agent-dashboard
  filter section to describe template-driven rendering.
- [docs/requirements.md](docs/requirements.md) — adjust any
  requirement worded around `enabledFilters` boolean toggles to
  instead reference editing the SurveyJS template JSON.
- [docs/seed-data.md](docs/seed-data.md) — add the new
  `survey_agent_dashboard_template` seed row.

### 5.2 Build prompts (`promts/`)

- [promts/04-agent-dashboard.md](promts/04-agent-dashboard.md) —
  replace the reference to `survey_agent_dashboard_config` /
  `enabledFilters` with the new template key and the
  `/admin/survey-templates` editor.
- [promts/07-admin-setup.md](promts/07-admin-setup.md) —
  - Under `/admin/survey-templates`, add
    `survey_agent_dashboard_template` to the list.
  - Under `/admin/survey-ui` (if still listed), remove
    `survey_agent_dashboard_config`. If `/admin/survey-ui` becomes
    empty, follow
    [ticket-detail-survey-template-refactor.md](./ticket-detail-survey-template-refactor.md)
    and delete the route + sidebar entry.
- [promts/changes/admin-sidebar-grouping.md](./admin-sidebar-grouping.md)
  — if it still references `Survey UI Config` and that route is being
  removed, update the grouping accordingly.
- [promts/changes/surveyjs-forms-admin-dashboard-ticket-detail.md](./surveyjs-forms-admin-dashboard-ticket-detail.md)
  — add a top-of-file `> **Update — superseded for the agent
  dashboard filter form by `agent-dashboard-filter-template-storage.md`**`
  banner near the existing supersedes notes.
- [promts/changes/agent-dashboard-surveyjs-filtering.md](./agent-dashboard-surveyjs-filtering.md)
  — add a similar banner clarifying that the SurveyJS schema
  referenced by §1 is now stored in `app_settings` rather than
  built in code.
- [promts/changes/ticket-detail-survey-template-refactor.md](./ticket-detail-survey-template-refactor.md)
  — change the line "(optional, if migrated)
  `survey_agent_dashboard_template`" to mark it as **required**
  and link back to this change.

### 5.3 Tests

Update or add tests so the new flow is covered end-to-end. Prefer
extending existing files over creating new ones.

- **Unit (`vitest`)**
  - Update tests that import `buildTicketFilterSurveyJson` to
    instead drive the new template-loader function with
    `DEFAULT_AGENT_DASHBOARD_TEMPLATE`. Existing assertions on the
    rendered question shape should still pass.
  - Add a test asserting that the server-side validator in
    [src/lib/actions/admin.ts](src/lib/actions/admin.ts) rejects
    a `survey_agent_dashboard_template` JSON containing a
    question whose `name` is not in the allowed set (§1.2).
- **DB tests (`tests/db/`)**
  - Extend the existing app-settings seed test to assert the new
    row exists and its value parses as JSON.
- **E2E (`tests/e2e/`)**
  - Add a scenario that signs in as admin, opens
    `/admin/survey-templates`, sees the new
    `survey_agent_dashboard_template` row, opens the editor, makes a
    minimal valid edit (e.g. removes the `email` question), saves,
    navigates to `/agent`, and asserts the `email` filter input is
    no longer rendered.
  - Add a negative scenario asserting that submitting invalid JSON
    (or an unknown question name such as `foo`) keeps the user on
    the editor page with an error.
  - Update any existing agent-dashboard E2E test that relies on the
    `enabledFilters` boolean toggles via
    `survey_agent_dashboard_config`; switch the setup helper to
    write a template JSON instead.

### 5.4 Seed / fixtures

- [supabase/seed.sql](supabase/seed.sql) — add the new
  `survey_agent_dashboard_template` row, mirroring the ticket-detail
  template rows.
- Test helpers in `tests/helpers/` that previously stubbed
  `survey_agent_dashboard_config` must be updated to stub
  `survey_agent_dashboard_template` instead.

---

## 6. Acceptance criteria

1. `app_settings.survey_agent_dashboard_template` exists after running
   migrations and is seeded with the default template.
2. `/admin/survey-templates` lists three templates; the new row links
   to a working JSON editor that loads, edits, validates, saves, and
   resets the template.
3. Saving an edited template (e.g. removing the `email` question) is
   reflected on `/agent` after revalidation, with no code change.
4. `survey_agent_dashboard_config` is no longer read anywhere in the
   application code.
5. `npm run lint`, `npm test`, and the E2E suite pass; new tests in
   §5.3 are included and green.
6. No SurveyJS Creator / `survey-creator-*` package is added to
   `package.json`.
