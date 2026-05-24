-- ============================================================
-- Migration 030 — AI-powered dashboard filter
-- ============================================================

INSERT INTO app_settings (key, value)
VALUES ('ai_filter_enabled', 'false')
ON CONFLICT (key) DO NOTHING;
