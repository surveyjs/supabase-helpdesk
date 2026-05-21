# Change: SurveyJS Forms for Admin, Agent Dashboard, and Ticket Detail

> **Update — superseded for the agent dashboard filter form by
> [`agent-dashboard-filter-template-storage.md`](./agent-dashboard-filter-template-storage.md).**
> The boolean `survey_agent_dashboard_config.enabledFilters` map and the
> `/admin/survey-ui` route described below have been removed. The agent
> dashboard filter form is now driven by a SurveyJS template stored under
> `app_settings.survey_agent_dashboard_template` and edited in
> `/admin/survey-templates` alongside the ticket-detail templates.
>
> **Update — superseded for ticket-detail custom fields by
> [`ticket-detail-custom-fields-surveyjs.md`](./ticket-detail-custom-fields-surveyjs.md).**
> Custom fields on the ticket detail page are now SurveyJS questions in
> the sidebar template (named `custom_fields.<name>`), optionally
> auto-generated via the `autoGenerateCustomFields` wrapper flag.

## Summary

Introduce SurveyJS (React) as the form engine for the following areas:

1. Admin configuration forms (new JSON-driven Survey UI Config tab)
2. Agent dashboard filtering controls
3. Ticket detail information behavior (agent and user variants)

## Requirements

### 1. Dependencies

- Install latest SurveyJS packages for React:
  - `survey-core`
  - `survey-react-ui`
- Apply a custom panelless SurveyJS theme that mirrors the app's Tailwind palette and typography (blue-600 primary, gray-200 borders, gray-900 text, system font stack). Theme is centralized in `src/components/features/survey/theme.json` and applied via `model.applyTheme(...)` inside `SurveyJsonForm`. CSS overrides in `src/components/features/survey/survey-overrides.css` remove residual SurveyJS borders/shadows so survey forms blend with surrounding card UI. The theme is applied to:
  - All admin SurveyJS forms (Privacy, Pagination, Rate Limit, CSAT, User Settings, Inbound Email, Email SMTP/Delay, Survey UI Config).
  - Agent dashboard filter form (`AgentFiltersSurvey`).

### 2. Admin JSON Configuration Tab

Add a new admin tab:
- Route: `/admin/survey-ui`
- Sidebar label: `Survey UI Config`

Store and manage three JSON settings in `app_settings`:
- `survey_agent_dashboard_config`
- `survey_ticket_detail_agent_config`
- `survey_ticket_detail_user_config`

Each config is edited through SurveyJS forms and persisted as JSON.

### 2a. Admin Settings Forms (SurveyJS widgets)

The following admin pages are migrated from native HTML forms to SurveyJS widgets while keeping existing server actions:

- `/admin/privacy`
- `/admin/pagination`
- `/admin/rate-limit`
- `/admin/csat`
- `/admin/user-settings` (display-name uniqueness section)

Notes:
- Survey completion triggers the same backend actions used previously.
- Validation and authorization remain server-side.

### 3. Agent Dashboard Filtering (SurveyJS)

Replace the manual filter form controls in `/agent` with SurveyJS-driven controls.

Behavior:
- Read current URL filter values into SurveyJS initial data.
- Apply filters by navigating to URL params built from SurveyJS output.
- Keep saved views behavior unchanged.
- Respect `survey_agent_dashboard_config` for enabled filter fields and default sort.

> **Update — superseded by `agent-dashboard-surveyjs-filtering.md`:** The
> filter form is now built by `src/lib/filters/ticket-filter-survey.ts` and
> rendered by `ViewsAndFiltersPanel`. SurveyJS question names equal SQL
> filter keys (no mapping layer). Status uses an inline checkbox
> (`open/pending/closed`). Saved views store the full
> `{ type: 'json' | 'ai', data, sql }` definition rather than a flat filter
> map, and Apply Filters on a non-Default view persists into that view.

### 4. Ticket Detail Info (Tier-aware JSON)

> **Superseded for ticket detail by [`ticket-detail-survey-template-refactor.md`](./ticket-detail-survey-template-refactor.md).**
> The original `survey_ticket_detail_agent_config` /
> `survey_ticket_detail_user_config` boolean-flag JSON has been replaced
> by two stored SurveyJS templates
> (`survey_ticket_detail_agent_template`,
> `survey_ticket_detail_user_template`). Field visibility/edit-ability is
> trimmed and read-only-flagged server-side based on role + tier rules,
> and there is no SurveyJS-name → Supabase-column mapping layer. The
> sidebar form autosaves on `onValueChanged` without `router.refresh()`.

Use JSON configs for ticket detail info rendering:
- Agent UI uses `survey_ticket_detail_agent_config`.
- User UI uses `survey_ticket_detail_user_config`.

Tier-sensitive behavior:
- For user-side editable controls, support tier-based allow-lists from config.
- Existing capability checks still apply (capabilities are the base gate).
- Config allow-list narrows access further when specified.

Implementation notes:
- The editable info widgets in the ticket detail right sidebar are rendered as a single SurveyJS autosave form by `src/app/(main)/tickets/[id]/[slug]/TicketSidebarSurvey.tsx`.
- The form's effective schema is computed server-side in `page.tsx` (`sidebarSurveyFields`) by combining role + tier capabilities + the relevant config (`survey_ticket_detail_agent_config` for agents, `survey_ticket_detail_user_config` for users). Each field flag (`status`, `urgency`, `severity`, `type`, `category`, `assigned`, `visibility`, `tags`, `follow`) gates whether the corresponding SurveyJS question is added to the schema.
- The form persists each changed value through dedicated server actions (`changeTicketStatus`, `changeUrgency`, `changeSeverity`, `changeType`, `changeCategory`, `assignAgent`/`reassignAgent`/`unassignAgent`, `addTagToTicket`/`removeTagFromTicket`, `toggleTicketPrivacy`, `followTicket`/`unfollowTicket`) on `onValueChanged`, with an aria-live status indicator (`data-testid="ticket-sidebar-survey-status"`).
- Read-only metadata (created by, created/updated timestamps, source article, advanced/Mark-as-Duplicate/Merge, SLA, CSAT, custom fields, KB Article, Delete) remains rendered as plain JSX in the surrounding `<dl>`. The colored tag chip list and follower count badges remain as visual references next to the SurveyJS form.

#### Required defaults for non-nullable columns

Every SurveyJS question whose persisted value maps to a Supabase column that is
**`NOT NULL` with a `DEFAULT`** must mirror the database contract in its
schema:

- Set `defaultValue` to the same value as the column's SQL `DEFAULT`.
- For `dropdown` questions, also set `allowClear: false` so the user cannot
  blank the value through the SurveyJS clear (✕) button — clearing such a
  field would either be silently dropped by the autosave dispatch (because
  the empty value is filtered out before calling the server action) or
  rejected by the database constraint, and either outcome is confusing.

Do **not** set `isRequired: true` on these questions: the ticket sidebar
form is autosave-driven and does not surface SurveyJS validation errors,
so a required marker would only add a visual asterisk without any error
rendering. The combination of `defaultValue` + `allowClear: false` already
guarantees the value can never be empty.

In `TicketSidebarSurvey.tsx` this rule applies to:

| Question (`name`)                  | Column                        | Default    |
| ---------------------------------- | ----------------------------- | ---------- |
| `status` (dropdown)                | `tickets.status`              | `'open'`   |
| `urgency` (dropdown)               | `tickets.urgency`             | `'medium'` |
| `severity` (dropdown)              | `tickets.severity`            | `'medium'` |
| `is_private` (boolean / checkbox)  | `tickets.is_private`          | `true`     |

Nullable columns (e.g. `category_id`, `assigned_agent_id`) keep their
clearable dropdown with an explicit "None"/"Unassigned" option and **must
not** receive `allowClear: false`. Columns that are `NOT NULL` but have no
DB default (e.g. `type_id`) keep the dispatch guard as their only safety
net and do not need a `defaultValue`.

The same rule applies to any future SurveyJS form that edits Supabase data:
when wiring a question to a `NOT NULL DEFAULT …` column, set `defaultValue`
(+ `allowClear: false` for dropdowns).

### 5. Database

Add migration to seed missing app settings keys for the three Survey UI configs with defaults.

### 6. Tests

Update E2E coverage to include:
- New admin sidebar item and page availability.
- Existing agent filtering behavior after SurveyJS migration.
- Ticket detail behavior remains role/capability-correct with tier constraints.

## Follow-up

The original implementation duplicated form-mapping boilerplate across every
admin SurveyJS wrapper (a `useMemo` data block plus a `toFormData` callback
per form) and used two parallel `if (fields.X)` ladders inside
`TicketSidebarSurvey`. That duplication is removed in
[`surveyjs-form-deduplication.md`](./surveyjs-form-deduplication.md):

- `AdminSurveyForm` now owns a default `toFormData` that converts SurveyJS
  data into `FormData` using the standard HTML conventions
  (`true` → `'on'`, `false` → omit, strings trimmed). Per-form `toFormData`
  callbacks were removed.
- `updateCsatSettings` was aligned to the same `'on'` checkbox convention.
- `TicketSidebarSurvey` was refactored to a single declarative
  `fieldEntries` table that drives both schema generation and the
  `onValueChanged` dispatch.
- The three flatten blocks in `admin/survey-ui/page.tsx` were replaced
  with one `flatten(obj, prefix)` helper.

SurveyJS question `name` values are intentionally chosen to match the
corresponding server-action `formData.get(...)` keys (and, for
`app_settings`-backed forms, the underlying setting keys), so no per-form
mapping layer is required.
