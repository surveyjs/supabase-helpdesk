-- ============================================================
-- Phase 19 — AI Features
-- ============================================================

-- Enable Vault extension (for encrypted API key storage)
CREATE EXTENSION IF NOT EXISTS supabase_vault;

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

-- ============================================================
-- Vault RPC functions for AI API key management
-- ============================================================

-- Store AI API key in Vault (admin only)
CREATE OR REPLACE FUNCTION store_ai_api_key(key_value TEXT)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Delete any existing AI API key
  DELETE FROM vault.secrets WHERE name = 'ai_api_key';
  -- Insert new secret
  PERFORM vault.create_secret(key_value, 'ai_api_key', 'AI provider API key');
END;
$$;

-- Retrieve AI API key from Vault (returns decrypted value)
CREATE OR REPLACE FUNCTION get_ai_api_key()
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  result TEXT;
BEGIN
  SELECT decrypted_secret INTO result
  FROM vault.decrypted_secrets
  WHERE name = 'ai_api_key'
  LIMIT 1;
  RETURN result;
END;
$$;

-- Delete AI API key from Vault
CREATE OR REPLACE FUNCTION delete_ai_api_key()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  DELETE FROM vault.secrets WHERE name = 'ai_api_key';
END;
$$;

-- AI usage tracking (for monthly usage counter)
CREATE TABLE ai_usage_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id UUID REFERENCES profiles(id) ON DELETE SET NULL,
  feature TEXT NOT NULL CHECK (feature IN (
    'auto_categorize', 'duplicate_detection',
    'suggested_reply', 'ticket_summary', 'generate_kb_article'
  )),
  tokens_used INTEGER DEFAULT 0 CHECK (tokens_used >= 0),
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
  feature TEXT NOT NULL DEFAULT 'suggested_reply' CHECK (feature IN (
    'suggested_reply', 'auto_categorize', 'duplicate_detection',
    'ticket_summary', 'generate_kb_article'
  )),
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
