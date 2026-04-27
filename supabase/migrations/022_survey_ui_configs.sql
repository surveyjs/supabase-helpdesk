-- SurveyJS UI configuration JSON storage
INSERT INTO app_settings (key, value) VALUES
  (
    'survey_agent_dashboard_config',
    '{"enabledFilters":{"q":true,"email":true,"status":true,"sort":true,"urgency":true,"severity":true,"type":true,"category":true,"agent":true,"team":true,"tier":true,"tags":true},"defaultSort":""}'
  ),
  (
    'survey_ticket_detail_agent_config',
    '{"fields":{"status":true,"urgency":true,"severity":true,"type":true,"category":true,"assigned":true,"createdBy":true,"createdAt":true,"updatedAt":true,"visibility":true,"tags":true,"customFields":true,"follow":true}}'
  ),
  (
    'survey_ticket_detail_user_config',
    '{"fields":{"status":true,"urgency":true,"severity":true,"type":true,"category":true,"assigned":true,"createdBy":true,"createdAt":true,"updatedAt":true,"visibility":true,"tags":true,"customFields":true,"follow":true},"tierControlRules":{"statusAllowedTiers":[],"severityAllowedTiers":[],"typeAllowedTiers":[],"tagsAllowedTiers":[],"visibilityAllowedTiers":[]}}'
  )
ON CONFLICT (key) DO NOTHING;
