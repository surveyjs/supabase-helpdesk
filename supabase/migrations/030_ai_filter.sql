-- ============================================================
-- Migration 030 — AI-powered dashboard filter
-- ============================================================

INSERT INTO app_settings (key, value)
VALUES ('ai_filter_enabled', 'false')
ON CONFLICT (key) DO NOTHING;

-- Add 'ai_filter' to the feature CHECK constraint on ai_usage_log.
ALTER TABLE ai_usage_log
  DROP CONSTRAINT IF EXISTS ai_usage_log_feature_check;

ALTER TABLE ai_usage_log
  ADD CONSTRAINT ai_usage_log_feature_check
  CHECK (feature IN (
    'auto_categorize', 'duplicate_detection',
    'suggested_reply', 'ticket_summary',
    'generate_kb_article', 'ai_filter'
  ));
