# Admin Forms → SurveyJS Conversion

Sequenced prompts for converting the remaining admin pages to SurveyJS.
**Run them in order.** Each phase depends on the previous one being
merged and its E2E specs passing.

| # | Prompt | Scope |
|---|---|---|
| 1 | [1-easy-single-forms.md](./1-easy-single-forms.md) | SLA, File Settings, AI — drop-in `AdminSurveyForm`. |
| 2 | [2-templates-matrixdynamic.md](./2-templates-matrixdynamic.md) | Notification templates → fixed-row `matrixdynamic`; introduces JSON-payload convention. |
| 3 | [3-crud-helper-tags-pilot.md](./3-crud-helper-tags-pilot.md) | Add `diffAndSave` helper; pilot it on `/admin/tags`. |
| 4 | [4-crud-rest-pages.md](./4-crud-rest-pages.md) | Categories, Types, Teams, KB Categories using `diffAndSave`. |
| 5 | [5-custom-fields.md](./5-custom-fields.md) | Custom fields → matrixdynamic with conditional `options` column. |
| 6 | [6-tiers-auth.md](./6-tiers-auth.md) | Tiers + Auth; finish the rollout. |

Permanently out of scope (list/action surfaces, not model editors):
`/admin`, `/admin/agents`, `/admin/users`, `/admin/audit-log`.

Background and rationale: see
[`../surveyjs-form-deduplication.md`](../surveyjs-form-deduplication.md)
for the existing pattern, and the parent
[`../surveyjs-forms-admin-dashboard-ticket-detail.md`](../surveyjs-forms-admin-dashboard-ticket-detail.md)
for the original SurveyJS introduction.
