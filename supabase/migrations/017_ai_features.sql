-- ============================================================
-- Phase 19 — AI Features
-- ============================================================

-- AI configuration stored in app_settings
INSERT INTO app_settings (key, value) VALUES
  ('ai_provider', ''),
  ('ai_custom_endpoint_url', ''),
  ('ai_model', ''),
  ('ai_request_timeout', '60'),
  ('ai_auto_categorize_enabled', 'false'),
  ('ai_auto_categorize_min_body_length', '20'),
  ('ai_duplicate_detection_enabled', 'false'),
  ('ai_duplicate_detection_threshold', 'medium'),
  ('ai_suggested_reply_enabled', 'false'),
  ('ai_suggested_reply_context_window', '20'),
  ('ai_suggested_reply_rate_limit', '20'),
  ('ai_ticket_summary_enabled', 'false'),
  ('ai_ticket_summary_min_posts', '10'),
  ('ai_generate_kb_article_enabled', 'false')
ON CONFLICT (key) DO NOTHING;

-- AI usage tracking (for monthly usage counter)
CREATE TABLE ai_usage_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id UUID REFERENCES profiles(id) ON DELETE SET NULL,
  feature TEXT NOT NULL CHECK (feature IN (
    'auto_categorize', 'duplicate_detection',
    'suggested_reply', 'ticket_summary', 'generate_kb_article'
  )),
  tokens_used INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_ai_usage_log_created_at ON ai_usage_log (created_at);
CREATE INDEX idx_ai_usage_log_agent_feature ON ai_usage_log (agent_id, feature, created_at);

ALTER TABLE ai_usage_log ENABLE ROW LEVEL SECURITY;
-- Only admins can view usage stats
CREATE POLICY ai_usage_log_select ON ai_usage_log
  FOR SELECT USING (is_admin());

-- AI suggested reply rate limit tracking
CREATE TABLE ai_rate_limit_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  feature TEXT NOT NULL DEFAULT 'suggested_reply',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_ai_rate_limit_log_agent_feature
  ON ai_rate_limit_log (agent_id, feature, created_at DESC);

ALTER TABLE ai_rate_limit_log ENABLE ROW LEVEL SECURITY;
-- Agents can read their own rate limit entries
CREATE POLICY ai_rate_limit_log_select ON ai_rate_limit_log
  FOR SELECT USING (auth.uid() = agent_id);

-- Ticket summary cache
CREATE TABLE ticket_summaries (
  ticket_id BIGINT PRIMARY KEY REFERENCES tickets(id) ON DELETE CASCADE,
  summary TEXT NOT NULL,
  post_count_at_generation INTEGER NOT NULL,
  generated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE ticket_summaries ENABLE ROW LEVEL SECURITY;
-- Only agents can view summaries
CREATE POLICY ticket_summaries_select ON ticket_summaries
  FOR SELECT USING (is_agent());
