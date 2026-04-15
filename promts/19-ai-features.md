# Phase 19 — AI Features

## Context

You are building AI-powered features — auto-categorization, duplicate detection, suggested replies, ticket summaries, and KB article generation — for a **HelpDesk** application. Read `docs/requirements.md` sections 23.1–23.5, 16.20, 19.6, and `docs/architecture.md` constraints 1, 2 (especially 2d, 2e), 3.

Phases 0–18 are complete: project init, database schema, authentication, tickets, agent dashboard, taxonomy, posts/comments/notes, admin setup, file attachments, email notifications, real-time/in-app notifications, CSAT ratings, SLA policies, knowledge base, reporting, user profile/account management, canned responses/follow/custom fields, advanced ticket operations, and inbound email.

This phase adds AI provider configuration, auto-categorization on ticket creation, duplicate ticket detection via semantic similarity, suggested reply for agents, AI-generated ticket summaries, and KB article generation from tickets.

### Existing Infrastructure

- **Ticket creation form**: `src/components/features/tickets/TicketForm.tsx` — uses `useActionState`, supports `initialTitle`, `sourceArticleId`. Already has KB article suggestion search with debounce (§19.6). This phase adds auto-categorization suggestions and duplicate ticket suggestions.
- **Ticket detail page**: `src/app/(main)/tickets/[id]/[slug]/page.tsx` — shows posts timeline, agent actions. This phase adds "Suggest Reply" button and "Ticket Summary" panel.
- **KB article management**: `src/lib/actions/kb.ts` — `createArticle()`, `updateArticle()`, `changeArticleStatus()`. This phase adds "Generate KB Article" button on closed tickets.
- **App settings table** (`app_settings`) — key-value store for configuration.
- **Admin setup page** at `/admin` with sidebar sections. This phase adds the "AI Configuration" section.
- **Supabase Vault** — for encrypting API keys at rest (pgsodium). Accessible via `vault.decrypted_secrets` view on server side.
- **Architecture constraint 2d**: Client-side components are permitted for KB article suggestions and duplicate ticket detection with debounced search.
- **Architecture constraint 2e**: Client-side components are permitted for AI-powered form interactions (auto-categorization suggestions, suggested reply loading).

## Tasks

### 1. Migration: `supabase/migrations/017_ai_features.sql`

```sql
-- ============================================================
-- Phase 19 — AI Features
-- ============================================================

-- AI configuration stored in app_settings
INSERT INTO app_settings (key, value) VALUES
  ('ai_provider', ''),                         -- 'openai', 'anthropic', 'custom', or '' (unconfigured)
  ('ai_custom_endpoint_url', ''),              -- only used when provider = 'custom'
  ('ai_model', ''),                            -- selected model name
  ('ai_request_timeout', '60'),                -- seconds
  ('ai_auto_categorize_enabled', 'false'),
  ('ai_auto_categorize_min_body_length', '20'),
  ('ai_duplicate_detection_enabled', 'false'),
  ('ai_duplicate_detection_threshold', 'medium'), -- 'low', 'medium', 'high'
  ('ai_suggested_reply_enabled', 'false'),
  ('ai_suggested_reply_context_window', '20'),
  ('ai_suggested_reply_rate_limit', '20'),     -- per agent per hour, 0 = unlimited
  ('ai_ticket_summary_enabled', 'false'),
  ('ai_ticket_summary_min_posts', '10'),
  ('ai_generate_kb_article_enabled', 'false')
ON CONFLICT (key) DO NOTHING;

-- AI API key stored in Supabase Vault (encrypted)
-- The key is stored/retrieved via vault.create_secret / vault.decrypted_secrets
-- No table needed here — uses Supabase Vault's built-in secrets management

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
```

### 2. Server-Side AI Client

**`src/lib/ai/client.ts`** (new file):

```typescript
interface AiConfig {
  provider: 'openai' | 'anthropic' | 'custom';
  apiKey: string;
  model: string;
  endpointUrl?: string; // for custom provider
  timeout: number;      // seconds
}

async function getAiConfig(): Promise<AiConfig | null> {
  // Read provider, model, timeout from app_settings
  // Read API key from Supabase Vault (vault.decrypted_secrets)
  // Return null if provider is unconfigured or API key is missing
}

async function callAi(
  systemPrompt: string,
  userPrompt: string,
  config?: Partial<AiConfig>,
): Promise<{ content: string; tokensUsed: number }> {
  // Get config (or merge with overrides)
  // Build request based on provider:
  //   - OpenAI: POST to https://api.openai.com/v1/chat/completions
  //   - Anthropic: POST to https://api.anthropic.com/v1/messages
  //   - Custom: POST to configured endpoint URL (OpenAI-compatible format)
  // Apply timeout from config
  // Parse response, extract content and token usage
  // Throw on error (caller handles gracefully)
}

async function logAiUsage(
  agentId: string | null,
  feature: string,
  tokensUsed: number,
): Promise<void> {
  // Insert into ai_usage_log
}
```

### 3. Server Actions: Auto-Categorization (§23.1)

**`src/lib/actions/ai.ts`** (new file):

- `autoCategorizeTicket(formData: FormData)`:
  - Extract `title` and `body`
  - Check `ai_auto_categorize_enabled` in `app_settings` — if disabled, return empty suggestions
  - Check body length against `ai_auto_categorize_min_body_length` — if too short, return empty
  - Fetch available ticket types, categories (if any exist), tags from the database
  - Build AI prompt:
    - System: "You are a helpdesk ticket classifier. Given a ticket title and body, suggest the best matching type, urgency, tags, and category from the provided options. Return JSON."
    - User: include title, body, and the lists of available types/categories/tags with their names/IDs
  - Call `callAi()` with a structured output request (JSON mode)
  - Parse the AI response to extract: `suggestedTypeId`, `suggestedUrgency`, `suggestedTagIds[]`, `suggestedCategoryId` (null if no categories defined)
  - Log usage via `logAiUsage(null, 'auto_categorize', tokensUsed)`
  - Return the suggestions (only fields that the AI confidently matched)
  - On failure/timeout: return empty suggestions silently

### 4. Server Actions: Duplicate Detection (§23.2)

- `detectDuplicateTickets(formData: FormData)`:
  - Extract `title`
  - Check `ai_duplicate_detection_enabled` — if disabled, return empty array
  - Fetch the similarity threshold from `app_settings`
  - Fetch recent open/pending tickets (e.g., last 100 by updated_at) — titles and IDs
  - Build AI prompt:
    - System: "Given a new ticket title and a list of existing ticket titles, identify up to 3 that are semantically similar. Consider the similarity threshold: {threshold}. Return JSON array of ticket IDs ranked by similarity."
    - User: include the new title and list of existing titles with IDs
  - Call `callAi()`
  - Parse response to get up to 3 similar ticket IDs
  - Fetch ticket details (id, title, status, created_at) for the matched IDs
  - Log usage
  - Return the similar tickets array
  - On failure/timeout: return empty array silently

### 5. Server Actions: Suggested Reply (§23.3)

- `suggestReply(formData: FormData)`:
  - Extract `ticket_id`
  - Require agent role
  - Check `ai_suggested_reply_enabled` — if disabled, return error
  - **Rate limit check:**
    - Query `ai_rate_limit_log` for the current agent in the last hour
    - Compare against `ai_suggested_reply_rate_limit` from `app_settings` (0 = unlimited)
    - If exceeded, return error with message indicating when the limit resets
  - Fetch ticket context:
    - Ticket title, type, category, tags, urgency, severity
    - Recent posts (up to `ai_suggested_reply_context_window` setting), including author role info
    - Related KB articles (if ticket has `source_article_id`, include that article)
  - Build AI prompt:
    - System: "You are a helpful support agent. Based on the ticket context and conversation history, draft a professional reply. Be helpful, empathetic, and solution-oriented. Do not invent information — if you need more details, ask the customer."
    - User: include full ticket context
  - Call `callAi()`
  - Insert row into `ai_rate_limit_log` for the agent
  - Log usage via `logAiUsage(agentId, 'suggested_reply', tokensUsed)`
  - Return the suggested reply text
  - On failure/timeout: return error message

### 6. Server Actions: Ticket Summary (§23.4)

- `getTicketSummary(formData: FormData)`:
  - Extract `ticket_id`
  - Require agent role
  - Check `ai_ticket_summary_enabled` — if disabled, return null
  - Count posts on the ticket — if below `ai_ticket_summary_min_posts`, return null
  - **Check cache**: query `ticket_summaries` for this ticket
    - If cached and `post_count_at_generation` equals current post count → return cached summary
  - Fetch all posts (including comments and notes) for the ticket, ordered chronologically
  - Build AI prompt:
    - System: "Summarize this support ticket conversation. Provide: 1) The problem reported, 2) Key discussion points, 3) Current status and any pending actions. Be concise (2-3 paragraphs)."
    - User: include all posts with author roles, timestamps
  - Call `callAi()`
  - **Cache the result**: upsert into `ticket_summaries` with current post count
  - Log usage
  - Return the summary text
  - On failure/timeout: return error message

- `refreshTicketSummary(formData: FormData)`:
  - Same as `getTicketSummary` but always regenerates (ignores cache)
  - Delete existing cache entry, generate new summary, insert into cache

### 7. Server Actions: Generate KB Article (§23.5)

- `generateKbArticle(formData: FormData)`:
  - Extract `ticket_id`
  - Require agent role
  - Check `ai_generate_kb_article_enabled` — if disabled, return error
  - Fetch the ticket — must be `status = 'closed'`
  - Fetch all posts and comments for the ticket
  - Fetch existing KB categories
  - Build AI prompt:
    - System: "Based on this support ticket conversation, generate a knowledge base article. Output JSON with: title (clear, descriptive), suggestedCategoryId (from the provided list, or null if none fit), body (Markdown format summarizing the problem and solution). IMPORTANT: Strip all personally identifiable information (names, emails, account numbers) from the body. Replace with generic placeholders if needed."
    - User: include full ticket thread, available KB categories
  - Call `callAi()`
  - Parse the response
  - Create a draft KB article:
    - `title` = AI-suggested title
    - `category_id` = AI-suggested category or null
    - `body` = AI-generated body
    - `status` = `'draft'`
    - `author_id` = current agent
    - Store `source_ticket_id` as article metadata (add column to `kb_articles` if not present, or store in a JSONB metadata field)
  - Log usage
  - Return the created article ID and redirect URL to the article edit page

### 8. UI: Auto-Categorization on Ticket Creation Form

Update `src/components/features/tickets/TicketForm.tsx`:

- Add a `"use client"` wrapper for the AI suggestion UI (architecture constraint 2e)
- After the user fills in the title and body and moves focus out of the body field:
  - If body length ≥ configured minimum and AI auto-categorization is enabled:
    - Call `autoCategorizeTicket` Server Action
    - Pre-fill type, urgency, tags, category fields with AI suggestions — **only for fields still at their default/unset values** (do not override manual user choices)
    - Show a subtle visual indicator (e.g., small "AI suggested" label) next to pre-filled fields
- Add a **"Re-suggest"** button visible after auto-categorization has run:
  - Clicking re-triggers auto-categorization with current title and body
  - Replaces current suggestions with fresh ones
  - Same minimum body length check applies
- If AI is unavailable or fails → use standard defaults silently, no error shown

### 9. UI: Duplicate Ticket Detection on Ticket Creation Form

Update `src/components/features/tickets/TicketForm.tsx`:

- Below the existing KB article suggestions (§19.6), add a **"Similar open tickets"** section:
  - When the user types in the title field (debounced, same as KB suggestions — architecture constraint 2d):
    - If AI duplicate detection is enabled: call `detectDuplicateTickets` Server Action
    - Display up to 3 similar tickets as links: ticket title, status badge, creation date
    - Each link navigates to the ticket detail page
  - If no similar tickets found or AI unavailable → section is hidden

### 10. UI: Suggest Reply Button on Ticket Detail

Update `src/app/(main)/tickets/[id]/[slug]/page.tsx`:

- For agents, add a **"Suggest Reply"** button next to the reply text area
- Architecture constraint 2e: this is a permitted `"use client"` component
- Clicking the button:
  - Shows a loading spinner/indicator on the button
  - Calls `suggestReply` Server Action
  - On success: inserts the suggested text into the reply textarea (agent can edit before posting)
  - On rate limit exceeded: shows message "Rate limit reached. Available again at {time}" and disables the button
  - On error: shows error message "Could not generate suggestion. Please try again or write a manual reply."
- Button is not shown if `ai_suggested_reply_enabled` is `'false'`

### 11. UI: Ticket Summary on Ticket Detail

Update `src/app/(main)/tickets/[id]/[slug]/page.tsx`:

- For agents, if `ai_ticket_summary_enabled` is `'true'` and the ticket has ≥ minimum posts:
  - Show a **collapsible "AI Summary" panel** above the timeline, below ticket metadata
  - On page load: call `getTicketSummary` (which uses cache)
  - Display the summary as rendered Markdown (sanitized)
  - Include a **"Refresh Summary"** button that calls `refreshTicketSummary`
  - Show "Generating..." state while loading
  - If AI unavailable → panel is hidden

### 12. UI: Generate KB Article Button on Ticket Detail

Update `src/app/(main)/tickets/[id]/[slug]/page.tsx`:

- For agents, on **closed tickets**, show a **"Generate KB Article"** button in the ticket actions area
- Button is not shown if `ai_generate_kb_article_enabled` is `'false'`
- Clicking the button:
  - Shows a loading indicator
  - Calls `generateKbArticle` Server Action
  - On success: redirect to the article editing page (`/kb/manage/{articleId}/edit`)
  - On error: shows error message

### 13. Admin UI: AI Configuration

Add a new sidebar section to the admin setup page:

**Route**: `/admin/ai` (add to admin sidebar navigation)

**Connection settings card:**
- **AI Provider** — dropdown: "None (unconfigured)", "OpenAI", "Anthropic", "Custom (OpenAI-compatible)"
- **API Key** — password input, stored via Supabase Vault. Show masked after saving. "Test Connection" button that makes a minimal API call to verify the key and returns success/error.
- **Custom endpoint URL** — text input, shown only when "Custom" is selected
- **Model** — dropdown populated after API key is verified (fetched from provider's model list endpoint). If auto-fetch fails or provider is "Custom", show a freeform text input instead.
- **Request timeout** — numeric input (10–300 seconds, default 60)

**Feature toggles card** (toggles disabled until a valid API key is saved):
- **Auto-categorize tickets** — toggle + "Minimum body length" numeric input (default 20, min 10)
- **Duplicate ticket detection** — toggle + "Similarity threshold" select (Low / Medium / High, default Medium)
- **Suggested reply for agents** — toggle + "Context window" numeric input (default 20, min 5, max 50) + "Rate limit" numeric input (default 20, 0 = unlimited)
- **Ticket summary** — toggle + "Minimum post count" numeric input (default 10, min 5)
- **Generate KB article from ticket** — toggle

**Usage counter card** (read-only):
- "Current month usage" showing:
  - Total AI API calls this calendar month
  - Estimated total tokens used this month
  - Breakdown by feature (auto-categorize, duplicate detection, suggested reply, summary, KB generation)
- Data sourced from `ai_usage_log` aggregated by `created_at` within current month

**Save** button for all settings. Changes recorded in admin audit log.

### 14. Tests

**`tests/db/018-ai-features.test.ts`** (new file):

- **AI settings:**
  - All AI-related `app_settings` keys exist with correct defaults
  - Admin can update AI settings

- **ai_usage_log table:**
  - Admin can read usage data
  - Non-admin cannot read (RLS)
  - Rows can be inserted (service_role)

- **ai_rate_limit_log table:**
  - Agent can read their own entries
  - Agent cannot read other agents' entries
  - Rows can be inserted

- **ticket_summaries table:**
  - Agent can read summaries
  - Non-agent cannot read (RLS)
  - Upsert works correctly (cache update)

**`tests/e2e/ai-features.spec.ts`** (new file):

- **Admin AI configuration:**
  - Admin can navigate to `/admin/ai`
  - Provider dropdown shows correct options
  - API key field masks input
  - "Test Connection" button works (with a valid test key, or mock)
  - Feature toggles are disabled until API key is configured
  - Settings persist after save

- **Auto-categorization** (may require mocking the AI API):
  - On ticket creation form, filling title + body triggers auto-categorization
  - AI suggestions pre-fill type, urgency, tags, category
  - "Re-suggest" button triggers fresh suggestions
  - Manually changed fields are not overridden by AI
  - Works silently when AI is unavailable

- **Duplicate detection:**
  - Typing in title field shows "Similar open tickets" section
  - Similar tickets displayed as links with title, status, date
  - Hidden when no similar tickets found or AI unavailable

- **Suggested reply:**
  - Agent sees "Suggest Reply" button on ticket detail
  - Clicking inserts suggested text into reply textarea
  - Rate limit messaging works correctly
  - Non-agent does not see the button
  - Button hidden when feature is disabled

- **Ticket summary:**
  - Agent sees "AI Summary" panel on tickets with enough posts
  - Summary is displayed as rendered Markdown
  - "Refresh Summary" button regenerates
  - Panel hidden when feature disabled or insufficient posts
  - Non-agent does not see the panel

- **Generate KB article:**
  - Agent sees "Generate KB Article" button on closed tickets
  - Clicking generates a draft article and redirects to edit page
  - Article has AI-generated title, body, and suggested category
  - PII is stripped from the generated body
  - Source ticket reference is stored
  - Button hidden on open/pending tickets
  - Button hidden when feature disabled

## Implementation Notes

- **All AI calls are server-side** via Server Actions (architecture constraint 1). No client-side API key exposure.
- **Timeout handling:** Use `AbortController` with the configured timeout. On timeout, return a graceful fallback (empty suggestions, error message) rather than crashing.
- **Provider abstraction:** The `callAi()` function should abstract over different providers. All three providers (OpenAI, Anthropic, Custom) use similar request/response patterns. The main differences are endpoint URLs, authentication headers, and response parsing.
- **Vault integration for API key:** Use `supabase.rpc('vault.create_secret', { secret: apiKey, name: 'ai_api_key' })` for storage and query `vault.decrypted_secrets` for retrieval. Never log or expose the decrypted key.
- **Structured output (JSON mode):** For auto-categorization, duplicate detection, and KB article generation, request JSON output format from the AI. OpenAI supports `response_format: { type: "json_object" }`. Anthropic supports structured output via system prompts. Always validate the parsed JSON against expected schema.
- **PII stripping for KB articles:** The AI prompt explicitly instructs PII removal. Additionally, perform a post-processing pass to detect and replace common PII patterns (email addresses, phone numbers) as a safety net.
- **Rate limiting for suggested reply:** Track per-agent requests in `ai_rate_limit_log`. The rate limit resets on a rolling 1-hour window (not fixed hourly slots).

## Deferred Features

- AI-powered auto-responses (automatically posting replies without agent review) — not in scope
- AI training/fine-tuning on helpdesk data — not in scope
- Embedding-based semantic search (vector similarity) — using prompt-based similarity matching instead

## Verification Checklist

- [ ] AI configuration admin section with provider/key/model/timeout settings
- [ ] API key stored encrypted in Supabase Vault, never exposed to client
- [ ] "Test Connection" button verifies API key
- [ ] Feature toggles disabled until valid API key is configured
- [ ] Auto-categorization: triggers on blur from body field, respects minimum body length
- [ ] Auto-categorization: pre-fills only default/unset fields, does not override manual choices
- [ ] Auto-categorization: "Re-suggest" button available
- [ ] Duplicate detection: shows up to 3 similar tickets below title field
- [ ] Duplicate detection: uses configured similarity threshold
- [ ] Suggested reply: agent-only button next to reply textarea
- [ ] Suggested reply: rate limited per agent per hour (configurable, 0 = unlimited)
- [ ] Suggested reply: rate limit message shown when exceeded
- [ ] Ticket summary: collapsible panel for agents on tickets with enough posts
- [ ] Ticket summary: cached, invalidated when new posts added
- [ ] Ticket summary: "Refresh Summary" button regenerates
- [ ] Generate KB article: agent-only button on closed tickets
- [ ] Generate KB article: PII stripped from generated body
- [ ] Generate KB article: creates draft with source ticket reference
- [ ] Usage counter: shows monthly API calls and token usage by feature
- [ ] All AI failures handled gracefully (empty suggestions, error messages)
- [ ] Timeout configured and enforced per feature
- [ ] `npm run test:db` passes AI feature tests
- [ ] `npm run test:e2e` passes AI feature tests
