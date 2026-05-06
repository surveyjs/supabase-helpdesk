# Change: SurveyJS-Based Ticket Filtering for the Agent Dashboard

> **Update — superseded for the SurveyJS schema source by
> [`agent-dashboard-filter-template-storage.md`](./agent-dashboard-filter-template-storage.md).**
> The form schema referenced by §1 is no longer built in code. It is stored
> as a SurveyJS template under `app_settings.survey_agent_dashboard_template`
> and edited in `/admin/survey-templates`. The dynamic `choices` for
> category/type/agent/team/tier/tags are injected server-side at render
> time. The SQL generator and saved-views storage shape are unchanged.

## Summary

Replace the current ad-hoc filter form on the Agent Dashboard with a SurveyJS-driven
filtering experience whose state is persisted as a structured object (name + type +
JSON form data + generated SQL). Saved Views become first-class containers for that
state, and filter application happens through the active view rather than through
loose URL params.

## Rationale

- **Single source of truth:** The filter state is captured once as a SurveyJS
  response JSON and travels with the active Saved View.
- **Future-proof:** Carrying both the JSON definition and a generated SQL string
  on every view lets us swap the generator (JSON → SQL today, AI prompt → SQL
  tomorrow) without changing storage or UI.
- **Less binding code:** Naming SurveyJS questions identically to the SQL
  columns/filter keys removes the mapping layer between form fields and queries.
- **Cleaner UX:** Removing the redundant "Clear All" link, the inline "View
  name…" input, the "Save View" button, and the "None yet" placeholder reduces
  visual noise. The new "Add new view" inline affordance keeps view creation
  explicit and discoverable.

## Filtering State Shape

Every filtering definition (Default + each Saved View) is represented by the
following object:

```ts
type TicketFilterDefinition = {
  /** Display name. Empty / missing => "Default". */
  name: string;
  /** Generator type. Only `'json'` is implemented in this change. */
  type: 'json' | 'ai';
  /** SurveyJS response JSON (i.e. `survey.data`). Question names match SQL columns. */
  data: Record<string, unknown>;
  /** SQL `WHERE`/ordering text generated from `data` (or, in the future, from an AI prompt). */
  sql: string;
};
```

Storage notes:

- `saved_views.filters` (JSONB) stores the full `TicketFilterDefinition` (minus
  `name`, which lives in the `saved_views.name` column). Existing rows that
  contain only the legacy flat filter map are migrated on read by treating them
  as `{ type: 'json', data: <legacy>, sql: <regenerated> }`.
- The "Default" view is synthetic (not persisted) and always resolves to
  `{ name: 'Default', type: 'json', data: {}, sql: '' }`.
- `type: 'ai'` is reserved; this change does **not** implement an AI generator.
  The UI must still accept and round-trip the value, but the SQL generator
  rejects non-`json` types with a clear error.

## Changes

### 1. Filter Definition (`src/lib/filters/ticket-filter.ts`, new)

- Export the `TicketFilterDefinition` type above.
- Export `buildSurveyModel(): SurveyModel` — constructs the SurveyJS model used
  by the Agent Dashboard. Question names **must exactly match** the SQL column
  / filter key they map to. Initial fields (mirroring today's filter set):
  - `q` (text) — full-text search
  - `email` (text) — submitter email (ILIKE)
  - `status` (checkbox, `colCount: 0`) — choices: `Active`, `Pending`, `Closed`.
    All three checked by default; "all selected" means no status filter is
    applied. (See §"Status Behavior" below.)
  - `urgency`, `severity` (dropdowns) — `low | medium | high | critical`
  - `category`, `type`, `agent`, `team`, `tier` (dropdowns populated from the
    server)
  - `tags` (tag picker)
  - `sort` (dropdown) — current sort options
- Export `addClearAllNavButton(survey)` which adds the navigation button:

  ```ts
  survey.addNavigationItem({
    id: 'sv-nav-clear-filtering',
    title: 'Clear All',
    action: () => { survey.data = {}; },
  });
  ```

- Export `generateSqlFromJson(data: Record<string, unknown>): string` — pure
  function that converts the SurveyJS response into a SQL fragment (the
  `WHERE … ORDER BY …` portion used by `getAgentTickets`). It is the only
  generator wired up in this change; `generateSqlFromAi` is **not** implemented
  and must throw `Error('AI filter generation is not implemented')` if called.
- Export `generateSqlFromDefinition(def: TicketFilterDefinition): string` that
  dispatches by `def.type`.

### 2. Saved Views Storage (`saved_views`)

- Schema unchanged (still `filters JSONB`). The column now holds
  `Omit<TicketFilterDefinition, 'name'>` (`{ type, data, sql }`).
- Update `src/lib/actions/saved-views.ts`:
  - `createSavedView(name, definition)` — stores `{ type, data, sql }`.
  - New `updateSavedViewDefinition(viewId, definition)` — used by "Apply
    Filters" to persist the new `data`/`sql` on the active view.
  - `deleteSavedView` unchanged.
  - `renameSavedView` unchanged.
- Read path (`getSavedViews`) normalises legacy flat objects:
  if `filters` is missing `type`/`data`, treat it as `{ type: 'json', data:
  filters, sql: generateSqlFromJson(filters) }`.

### 3. Agent Dashboard Page (`src/app/(main)/agent/page.tsx`)

Replace the existing filter form with a SurveyJS-driven panel inside the
existing collapsible "Views & Filters" panel:

#### Saved Views section

- Label: `Saved Views:`
- "Default" pill (always present, always non-removable).
- One pill per persisted Saved View, with a `×` delete button.
- **Remove:** the "None yet" placeholder. When there are no saved views, only
  "Default" and the "Add new view" affordance are shown.
- **Add:** an inline "Add new view" link rendered at the **end** of the list,
  always visible (regardless of how many saved views exist). Behaviour:
  1. Initial state: link `+ Add new view`.
  2. On click: link is hidden; a text input appears in its place along with two
     icon buttons on its right — `OK` (✓) and `Cancel` (✕).
  3. On Cancel: input + icons disappear, link reappears, no state change.
  4. On OK (with non-empty trimmed name):
     - Create a new Saved View with `{ name, type: 'json', data: <current
       survey.data>, sql: <current sql> }`.
     - Make the new view the selected/active view.
     - Hide the input + icons; show the link again at the end of the list.
     - The input must be `required` for OK to be enabled (or OK is a no-op when
       empty).
- Selecting a Saved View loads its `data` into the SurveyJS model and applies
  its `sql` to the ticket query.

#### Filter Controls section

- Render the SurveyJS survey from `buildSurveyModel()`.
- Use the SurveyJS navigation bar's `Apply Filters` button (the existing
  Complete-button behavior is reused/renamed to `Apply Filters`).
- **Remove:** the old "Clear All" link; replaced by the SurveyJS navigation
  button `Clear All` registered via `addClearAllNavButton(survey)` (see §1).
- **Remove:** the inline "View name…" text input.
- **Remove:** the "Save View" button.

#### Apply Filters behavior

When the user clicks `Apply Filters`:

1. Read `survey.data` → `data`.
2. Compute `sql = generateSqlFromJson(data)`.
3. Persist `{ type: 'json', data, sql }` onto the **currently active** view via
   `updateSavedViewDefinition(activeViewId, …)`. If the active view is
   "Default", do **not** persist (Default is synthetic) — just apply for the
   current request.
4. Navigate to `/agent?view=<id>` (or `/agent` for Default) so the server
   re-renders with the new filter applied. The server uses the stored `sql` /
   `data` for the active view (Default uses the request's transient data).

### 4. Server Query (`src/lib/queries/agent-dashboard.ts`)

- Accept a resolved `TicketFilterDefinition` instead of (or in addition to) the
  flat `AgentTicketFilters` map.
- For `type: 'json'`, derive the same conditions today's code derives, but
  driven by `data` whose keys equal the SQL column / param names. The previous
  `AgentTicketFilters` map and its parser are removed (or kept only as an
  internal adapter used by `generateSqlFromJson`).
- `status` semantics:
  - Active filter applied **only when the chosen array is non-empty AND not all
    three statuses are selected**. All three selected ⇒ no status predicate
    (matches "All").
  - Map UI labels to DB values: `Active → open`, `Pending → pending`,
    `Closed → closed`. (Note: this changes today's behavior where `Active`
    meant `open OR pending`.)

### 5. Status Behavior

`status` is a SurveyJS `checkbox` question with `colCount: 0` so all options
render on a single line. Choices and storage values:

| Label   | Stored value |
| ------- | ------------ |
| Active  | `open`       |
| Pending | `pending`    |
| Closed  | `closed`     |

- Default (initial) value: `['open', 'pending', 'closed']` — i.e. all three
  selected => no predicate added.
- Any subset of selections => `status IN (<subset>)`.
- Empty selection => no rows match (apply `status IN ()` equivalent, e.g. a
  `false` predicate).

### 6. URL & State

- Active view is identified by `?view=<savedViewId>` (omit for Default).
- Transient unsaved filter state on Default lives in memory only for the
  current request; reloading `/agent` resets Default to empty filters.
- For non-Default views, the `data` and `sql` are read from `saved_views` by
  id, so the URL stays short.

### 7. Removed UI Elements

- "Clear All" link in the filter form (replaced by SurveyJS nav button).
- "View name…" text input.
- "Save View" button.
- "None yet" placeholder.

### 8. Added UI Elements

- SurveyJS survey hosting all filter controls.
- SurveyJS navigation buttons: `Apply Filters` (Complete) and `Clear All`
  (custom, per snippet above).
- Inline "Add new view" link with OK/Cancel inline editor at the end of Saved
  Views.

## SQL Generation Rules (`generateSqlFromJson`)

Input keys mirror SurveyJS question names:

| Question (`name`) | SQL fragment                                                                  |
| ----------------- | ----------------------------------------------------------------------------- |
| `q`               | `(title ILIKE '%…%' OR EXISTS (SELECT 1 FROM posts p WHERE p.ticket_id = t.id AND p.body ILIKE '%…%'))` |
| `email`           | `creator_email ILIKE '%…%'`                                                   |
| `status` (subset) | `status IN (…)` when not all selected                                         |
| `urgency`         | `urgency = '…'`                                                               |
| `severity`        | `severity = '…'`                                                              |
| `category`        | `category_id = '…'`                                                           |
| `type`            | `type_id = '…'`                                                               |
| `agent`           | `assigned_agent_id = '…'`                                                     |
| `team`            | `creator_team_id = '…'`                                                       |
| `tier`            | `creator_tier_key = '…'`                                                      |
| `tags`            | `id IN (SELECT ticket_id FROM ticket_tags WHERE tag_id = ANY('{…}'))`         |
| `sort`            | `ORDER BY …` (whitelist of allowed sort keys)                                 |

All values must be parameterised at the Supabase query layer; the stored `sql`
string is for diagnostics / round-tripping, not direct execution. Empty /
unset values produce no fragment.

## Acceptance Criteria

1. Saved views persist `{ type, data, sql }` and round-trip across reloads.
2. Selecting a view loads its SurveyJS state and applies its SQL.
3. `Apply Filters` updates the active (non-Default) view's `data` + `sql`.
4. `Clear All` SurveyJS nav button empties `survey.data` without submitting.
5. The old "Clear All" link, "View name…" input, "Save View" button, and "None
   yet" placeholder are gone.
6. "Add new view" inline editor behaves per §3 (link ↔ input+OK/Cancel).
7. `status` checkbox renders inline (`colCount: 0`) with all three options
   selected by default and "all selected" applies no status predicate.
   `minSelectedChoices: 1` enforces that at least one option is always
   selected — unchecking the last is impossible from the UI, so an
   undefined/empty status payload unambiguously means "no filter".
8. SurveyJS question names equal SQL filter keys (no mapping layer).
9. `type: 'ai'` is accepted in storage but rejected by the SQL generator with
   `Error('AI filter generation is not implemented')`. The Agent Dashboard
   page treats a non-`'json'` definition as unsupported: it shows an
   `unsupported-view-banner` and falls back to empty filters instead of
   silently re-saving the view as `'json'` on next Apply.
10. Re-applying filters on an already-active saved view persists the new
    definition and forces a server re-render via `router.refresh()` (the
    URL is unchanged so a plain `router.push` is a no-op).

## Follow-up Tasks (perform after this prompt is executed)

- Update related prompts/specs that describe the Agent Dashboard filtering and
  Saved Views, including:
  - `promts/04-agent-dashboard.md`
  - `promts/changes/agent-dashboard-panel-consolidation.md`
  - `promts/changes/surveyjs-form-deduplication.md`
  - `promts/changes/surveyjs-forms-admin-dashboard-ticket-detail.md`
  - `docs/requirements.md`, `docs/design.md`, `docs/architecture.md` where they
    discuss filtering or saved views.
- Update e2e tests in `tests/e2e/agent-dashboard.spec.ts`:
  - Replace clicks on the old "Clear All" link with clicks on the SurveyJS
    `Clear All` navigation button.
  - Replace "Save View" interactions with the new "Add new view" inline flow.
  - Adjust `status=closed` style assertions to match the new checkbox + label
    mapping.
- Update db tests in `tests/db/004-agent.test.ts` (and `001-schema.test.ts` if
  needed) so `saved_views.filters` rows store `{ type, data, sql }` and the
  legacy-shape compatibility path is covered.
- Update seed data (`supabase/seed.sql`) for any seeded saved views to use the
  new shape.
- Run `npm run lint`, `npm run typecheck`, and `npm run test`. Address any
  failures introduced by the changes above.
