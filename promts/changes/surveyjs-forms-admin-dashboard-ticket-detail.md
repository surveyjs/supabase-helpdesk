# Change: SurveyJS Forms for Admin, Agent Dashboard, and Ticket Detail

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

### 4. Ticket Detail Info (Tier-aware JSON)

Use JSON configs for ticket detail info rendering:
- Agent UI uses `survey_ticket_detail_agent_config`.
- User UI uses `survey_ticket_detail_user_config`.

Tier-sensitive behavior:
- For user-side editable controls, support tier-based allow-lists from config.
- Existing capability checks still apply (capabilities are the base gate).
- Config allow-list narrows access further when specified.

### 5. Database

Add migration to seed missing app settings keys for the three Survey UI configs with defaults.

### 6. Tests

Update E2E coverage to include:
- New admin sidebar item and page availability.
- Existing agent filtering behavior after SurveyJS migration.
- Ticket detail behavior remains role/capability-correct with tier constraints.
