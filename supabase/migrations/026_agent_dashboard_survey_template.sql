-- Agent Dashboard SurveyJS template (replaces `survey_agent_dashboard_config`
-- from migration 022).
--
-- Policy: deletes the deprecated `survey_agent_dashboard_config` row
-- (boolean-flag JSON shaped { enabledFilters, defaultSort }) and inserts
-- a new key `survey_agent_dashboard_template` whose value is the SurveyJS
-- JSON template for the Agent Dashboard filter form.
--
-- The template's `pages[].elements[].name` values must match the SQL
-- filter / column keys used by `getAgentTickets`
-- (q, email, status, sort, urgency, severity, type, category, agent, team,
-- tier, tags). Server validation in `saveSurveyTemplate` enforces this.
--
-- Dynamic `choices` for type/category/agent/team/tier/tags are intentionally
-- left as the static sentinel set ("All", "Unassigned", etc.). The agent
-- dashboard server page injects the database-derived options at render
-- time.

DELETE FROM app_settings WHERE key = 'survey_agent_dashboard_config';

INSERT INTO app_settings (key, value) VALUES
  (
    'survey_agent_dashboard_template',
    '{"showQuestionNumbers":"off","pages":[{"name":"filters","elements":[{"type":"text","name":"q","title":"Search","inputType":"search","placeholder":"Search title & all posts..."},{"type":"text","name":"email","title":"Submitter Email","placeholder":"email@..."},{"type":"checkbox","name":"status","title":"Status","colCount":0,"minSelectedChoices":1,"choices":[{"value":"open","text":"Active"},{"value":"pending","text":"Pending"},{"value":"closed","text":"Closed"}],"defaultValue":["open","pending","closed"]},{"type":"dropdown","name":"sort","title":"Sort By","defaultValue":"","allowClear":false,"choices":[{"value":"","text":"Last Modified"},{"value":"created","text":"Created Date"},{"value":"sla","text":"SLA Risk"}]},{"type":"dropdown","name":"urgency","title":"Urgency","choices":[{"value":"","text":"All"},{"value":"low","text":"Low"},{"value":"medium","text":"Medium"},{"value":"high","text":"High"},{"value":"critical","text":"Critical"}]},{"type":"dropdown","name":"severity","title":"Severity","startWithNewLine":false,"choices":[{"value":"","text":"All"},{"value":"low","text":"Low"},{"value":"medium","text":"Medium"},{"value":"high","text":"High"},{"value":"critical","text":"Critical"}]},{"type":"dropdown","name":"type","title":"Type","choices":[{"value":"","text":"All"}]},{"type":"dropdown","name":"category","title":"Category","startWithNewLine":false,"choices":[{"value":"","text":"All"}]},{"type":"dropdown","name":"agent","title":"Assigned Agent","choices":[{"value":"","text":"All"},{"value":"unassigned","text":"Unassigned"}]},{"type":"dropdown","name":"team","title":"Team","startWithNewLine":false,"choices":[{"value":"","text":"All"},{"value":"none","text":"No team"}]},{"type":"dropdown","name":"tier","title":"Tier","startWithNewLine":false,"choices":[{"value":"","text":"All"},{"value":"none","text":"No tier"}]},{"type":"tagbox","name":"tags","title":"Tags","choices":[],"showSelectAllItem":false}]}]}'
  )
ON CONFLICT (key) DO NOTHING;
