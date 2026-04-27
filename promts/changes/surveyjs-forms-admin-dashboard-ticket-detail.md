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

Implementation notes:
- The editable info widgets in the ticket detail right sidebar are rendered as a single SurveyJS autosave form by `src/app/(main)/tickets/[id]/[slug]/TicketSidebarSurvey.tsx`.
- The form's effective schema is computed server-side in `page.tsx` (`sidebarSurveyFields`) by combining role + tier capabilities + the relevant config (`survey_ticket_detail_agent_config` for agents, `survey_ticket_detail_user_config` for users). Each field flag (`status`, `urgency`, `severity`, `type`, `category`, `assigned`, `visibility`, `tags`, `follow`) gates whether the corresponding SurveyJS question is added to the schema.
- The form persists each changed value through dedicated server actions (`changeTicketStatus`, `changeUrgency`, `changeSeverity`, `changeType`, `changeCategory`, `assignAgent`/`reassignAgent`/`unassignAgent`, `addTagToTicket`/`removeTagFromTicket`, `toggleTicketPrivacy`, `followTicket`/`unfollowTicket`) on `onValueChanged`, with an aria-live status indicator (`data-testid="ticket-sidebar-survey-status"`).
- Read-only metadata (created by, created/updated timestamps, source article, advanced/Mark-as-Duplicate/Merge, SLA, CSAT, custom fields, KB Article, Delete) remains rendered as plain JSX in the surrounding `<dl>`. The colored tag chip list and follower count badges remain as visual references next to the SurveyJS form.

### 5. Database

Add migration to seed missing app settings keys for the three Survey UI configs with defaults.

### 6. Tests

Update E2E coverage to include:
- New admin sidebar item and page availability.
- Existing agent filtering behavior after SurveyJS migration.
- Ticket detail behavior remains role/capability-correct with tier constraints.
