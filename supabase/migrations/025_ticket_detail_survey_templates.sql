-- Ticket Detail SurveyJS templates (replaces *_config keys from migration 022).
--
-- Policy: deletes the deprecated `survey_ticket_detail_agent_config` and
-- `survey_ticket_detail_user_config` rows (boolean-flag JSON) and inserts
-- two new keys storing the SurveyJS template wrapper:
--
--   { "template": <SurveyJS JSON>, "tierControlRules": { ... } }
--
-- The wrapper's `template.pages[].elements[].name` values must match
-- columns on `public.tickets` (or canonical relationship names like
-- `tag_ids`/`is_following`). Server validation enforces this.

DELETE FROM app_settings WHERE key IN (
  'survey_ticket_detail_agent_config',
  'survey_ticket_detail_user_config'
);

INSERT INTO app_settings (key, value) VALUES
  (
    'survey_ticket_detail_agent_template',
    '{"template":{"showQuestionNumbers":"off","pages":[{"name":"sidebar","elements":[{"type":"dropdown","name":"status","title":"Status","defaultValue":"open","allowClear":false,"choices":[{"value":"pending","text":"Pending"},{"value":"open","text":"Open"},{"value":"closed","text":"Closed"}]},{"type":"dropdown","name":"urgency","title":"Urgency","startWithNewLine":false,"defaultValue":"medium","allowClear":false,"choices":[{"value":"low","text":"Low"},{"value":"medium","text":"Medium"},{"value":"high","text":"High"},{"value":"critical","text":"Critical"}]},{"type":"dropdown","name":"severity","title":"Severity","defaultValue":"medium","allowClear":false,"choices":[{"value":"low","text":"Low"},{"value":"medium","text":"Medium"},{"value":"high","text":"High"},{"value":"critical","text":"Critical"}]},{"type":"dropdown","name":"type_id","title":"Type","startWithNewLine":false,"choices":[]},{"type":"dropdown","name":"category_id","title":"Category","choices":[]},{"type":"dropdown","name":"assigned_agent_id","title":"Assigned Agent","choices":[]},{"type":"tagbox","name":"tag_ids","title":"Tags","choices":[],"showSelectAllItem":false},{"type":"boolean","name":"is_private","title":"Private ticket","renderAs":"checkbox","defaultValue":true},{"type":"boolean","name":"is_following","title":"Follow this ticket","renderAs":"checkbox","startWithNewLine":false}]}]},"tierControlRules":{"statusAllowedTiers":[],"severityAllowedTiers":[],"typeAllowedTiers":[],"tagsAllowedTiers":[],"visibilityAllowedTiers":[]}}'
  ),
  (
    'survey_ticket_detail_user_template',
    '{"template":{"showQuestionNumbers":"off","pages":[{"name":"sidebar","elements":[{"type":"dropdown","name":"status","title":"Status","defaultValue":"open","allowClear":false,"choices":[{"value":"pending","text":"Pending"},{"value":"open","text":"Open"},{"value":"closed","text":"Closed"}]},{"type":"dropdown","name":"urgency","title":"Urgency","startWithNewLine":false,"defaultValue":"medium","allowClear":false,"choices":[{"value":"low","text":"Low"},{"value":"medium","text":"Medium"},{"value":"high","text":"High"},{"value":"critical","text":"Critical"}]},{"type":"dropdown","name":"severity","title":"Severity","defaultValue":"medium","allowClear":false,"choices":[{"value":"low","text":"Low"},{"value":"medium","text":"Medium"},{"value":"high","text":"High"},{"value":"critical","text":"Critical"}]},{"type":"dropdown","name":"type_id","title":"Type","startWithNewLine":false,"choices":[]},{"type":"tagbox","name":"tag_ids","title":"Tags","choices":[],"showSelectAllItem":false},{"type":"boolean","name":"is_private","title":"Private ticket","renderAs":"checkbox","defaultValue":true},{"type":"boolean","name":"is_following","title":"Follow this ticket","renderAs":"checkbox","startWithNewLine":false}]}]},"tierControlRules":{"statusAllowedTiers":[],"severityAllowedTiers":[],"typeAllowedTiers":[],"tagsAllowedTiers":[],"visibilityAllowedTiers":[]}}'
  )
ON CONFLICT (key) DO NOTHING;
