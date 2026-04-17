'use client';

import { useActionState, useState } from 'react';
import { saveAiSettings, testAiConnection } from '@/lib/actions/ai';

type Props = {
  settings: Record<string, string>;
  usage: {
    totalCalls: number;
    totalTokens: number;
    byFeature: Record<string, { calls: number; tokens: number }>;
  };
};

const FEATURE_LABELS: Record<string, string> = {
  auto_categorize: 'Auto-categorize',
  duplicate_detection: 'Duplicate detection',
  suggested_reply: 'Suggested reply',
  ticket_summary: 'Ticket summary',
  generate_kb_article: 'Generate KB article',
};

export function AiConfigForm({ settings, usage }: Props) {
  const [state, formAction, pending] = useActionState(
    async (_prev: { error?: string }, formData: FormData) => {
      return saveAiSettings(formData);
    },
    {},
  );

  const [testResult, setTestResult] = useState<{ success?: boolean; error?: string; model?: string } | null>(null);
  const [testing, setTesting] = useState(false);

  const [provider, setProvider] = useState(settings.ai_provider || '');

  const hasApiKey = settings.ai_api_key_present === 'true';

  async function handleTestConnection() {
    setTesting(true);
    setTestResult(null);
    try {
      const result = await testAiConnection();
      setTestResult(result);
    } catch {
      setTestResult({ success: false, error: 'Connection test failed.' });
    } finally {
      setTesting(false);
    }
  }

  return (
    <form action={formAction} className="space-y-8">
      {state.error && (
        <div
          role="alert"
          className="p-3 rounded bg-red-50 border border-red-200 text-red-700 text-sm"
        >
          {state.error}
        </div>
      )}

      {/* Connection Settings */}
      <div className="bg-white rounded-lg border border-gray-200 p-6">
        <h2 className="text-lg font-medium text-gray-900 mb-4">Connection Settings</h2>

        <div className="space-y-4">
          <div>
            <label htmlFor="ai_provider" className="block text-sm font-medium text-gray-700 mb-1">
              AI Provider
            </label>
            <select
              id="ai_provider"
              name="ai_provider"
              value={provider}
              onChange={(e) => setProvider(e.target.value)}
              className="block w-full rounded border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none"
            >
              <option value="">None (unconfigured)</option>
              <option value="openai">OpenAI</option>
              <option value="anthropic">Anthropic</option>
              <option value="custom">Custom (OpenAI-compatible)</option>
            </select>
          </div>

          <div>
            <label htmlFor="ai_api_key" className="block text-sm font-medium text-gray-700 mb-1">
              API Key
            </label>
            <input
              id="ai_api_key"
              name="ai_api_key"
              type="password"
              placeholder={hasApiKey ? '••••••••••••••••' : 'Enter API key'}
              className="block w-full rounded border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none"
            />
            <p className="mt-1 text-xs text-gray-500">
              Stored encrypted in Supabase Vault. Leave blank to keep existing key.
            </p>
          </div>

          {provider === 'custom' && (
            <div>
              <label htmlFor="ai_custom_endpoint_url" className="block text-sm font-medium text-gray-700 mb-1">
                Custom Endpoint URL
              </label>
              <input
                id="ai_custom_endpoint_url"
                name="ai_custom_endpoint_url"
                type="url"
                defaultValue={settings.ai_custom_endpoint_url || ''}
                placeholder="https://your-api.example.com/v1/chat/completions"
                className="block w-full rounded border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none"
              />
            </div>
          )}

          <div>
            <label htmlFor="ai_model" className="block text-sm font-medium text-gray-700 mb-1">
              Model
            </label>
            <input
              id="ai_model"
              name="ai_model"
              type="text"
              defaultValue={settings.ai_model || ''}
              placeholder={
                provider === 'openai' ? 'gpt-4o' :
                provider === 'anthropic' ? 'claude-sonnet-4-20250514' :
                'model-name'
              }
              className="block w-full rounded border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none"
            />
          </div>

          <div>
            <label htmlFor="ai_request_timeout" className="block text-sm font-medium text-gray-700 mb-1">
              Request Timeout (seconds)
            </label>
            <input
              id="ai_request_timeout"
              name="ai_request_timeout"
              type="number"
              min={10}
              max={300}
              defaultValue={settings.ai_request_timeout || '60'}
              className="block w-48 rounded border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none"
            />
          </div>

          <div>
            <button
              type="button"
              onClick={handleTestConnection}
              disabled={testing}
              className="px-4 py-2 text-sm rounded bg-gray-100 text-gray-700 hover:bg-gray-200 disabled:opacity-50"
              data-testid="test-connection-btn"
            >
              {testing ? 'Testing…' : 'Test Connection'}
            </button>
            {testResult && (
              <span className={`ml-3 text-sm ${testResult.success ? 'text-green-600' : 'text-red-600'}`}>
                {testResult.success ? `✓ Connected (${testResult.model})` : `✗ ${testResult.error}`}
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Feature Toggles */}
      <div className="bg-white rounded-lg border border-gray-200 p-6">
        <h2 className="text-lg font-medium text-gray-900 mb-4">Feature Toggles</h2>

        <div className="space-y-6">
          {/* Auto-categorize */}
          <div className="flex items-start gap-4">
            <div className="flex items-center pt-0.5">
              <input
                id="ai_auto_categorize_enabled"
                name="ai_auto_categorize_enabled"
                type="checkbox"
                defaultChecked={settings.ai_auto_categorize_enabled === 'true'}
                className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
              />
            </div>
            <div className="flex-1">
              <label htmlFor="ai_auto_categorize_enabled" className="text-sm font-medium text-gray-700">
                Auto-categorize tickets
              </label>
              <div className="mt-2">
                <label htmlFor="ai_auto_categorize_min_body_length" className="block text-xs text-gray-500 mb-1">
                  Minimum body length
                </label>
                <input
                  id="ai_auto_categorize_min_body_length"
                  name="ai_auto_categorize_min_body_length"
                  type="number"
                  min={10}
                  defaultValue={settings.ai_auto_categorize_min_body_length || '20'}
                  className="block w-28 rounded border border-gray-300 px-2 py-1 text-xs focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none"
                />
              </div>
            </div>
          </div>

          {/* Duplicate detection */}
          <div className="flex items-start gap-4">
            <div className="flex items-center pt-0.5">
              <input
                id="ai_duplicate_detection_enabled"
                name="ai_duplicate_detection_enabled"
                type="checkbox"
                defaultChecked={settings.ai_duplicate_detection_enabled === 'true'}
                className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
              />
            </div>
            <div className="flex-1">
              <label htmlFor="ai_duplicate_detection_enabled" className="text-sm font-medium text-gray-700">
                Duplicate ticket detection
              </label>
              <div className="mt-2">
                <label htmlFor="ai_duplicate_detection_threshold" className="block text-xs text-gray-500 mb-1">
                  Similarity threshold
                </label>
                <select
                  id="ai_duplicate_detection_threshold"
                  name="ai_duplicate_detection_threshold"
                  defaultValue={settings.ai_duplicate_detection_threshold || 'medium'}
                  className="block w-32 rounded border border-gray-300 px-2 py-1 text-xs focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none"
                >
                  <option value="low">Low</option>
                  <option value="medium">Medium</option>
                  <option value="high">High</option>
                </select>
              </div>
            </div>
          </div>

          {/* Suggested reply */}
          <div className="flex items-start gap-4">
            <div className="flex items-center pt-0.5">
              <input
                id="ai_suggested_reply_enabled"
                name="ai_suggested_reply_enabled"
                type="checkbox"
                defaultChecked={settings.ai_suggested_reply_enabled === 'true'}
                className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
              />
            </div>
            <div className="flex-1">
              <label htmlFor="ai_suggested_reply_enabled" className="text-sm font-medium text-gray-700">
                Suggested reply for agents
              </label>
              <div className="mt-2 grid grid-cols-2 gap-4">
                <div>
                  <label htmlFor="ai_suggested_reply_context_window" className="block text-xs text-gray-500 mb-1">
                    Context window (posts)
                  </label>
                  <input
                    id="ai_suggested_reply_context_window"
                    name="ai_suggested_reply_context_window"
                    type="number"
                    min={5}
                    max={50}
                    defaultValue={settings.ai_suggested_reply_context_window || '20'}
                    className="block w-28 rounded border border-gray-300 px-2 py-1 text-xs focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none"
                  />
                </div>
                <div>
                  <label htmlFor="ai_suggested_reply_rate_limit" className="block text-xs text-gray-500 mb-1">
                    Rate limit (per agent/hour, 0 = unlimited)
                  </label>
                  <input
                    id="ai_suggested_reply_rate_limit"
                    name="ai_suggested_reply_rate_limit"
                    type="number"
                    min={0}
                    defaultValue={settings.ai_suggested_reply_rate_limit || '20'}
                    className="block w-28 rounded border border-gray-300 px-2 py-1 text-xs focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none"
                  />
                </div>
              </div>
            </div>
          </div>

          {/* Ticket summary */}
          <div className="flex items-start gap-4">
            <div className="flex items-center pt-0.5">
              <input
                id="ai_ticket_summary_enabled"
                name="ai_ticket_summary_enabled"
                type="checkbox"
                defaultChecked={settings.ai_ticket_summary_enabled === 'true'}
                className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
              />
            </div>
            <div className="flex-1">
              <label htmlFor="ai_ticket_summary_enabled" className="text-sm font-medium text-gray-700">
                Ticket summary
              </label>
              <div className="mt-2">
                <label htmlFor="ai_ticket_summary_min_posts" className="block text-xs text-gray-500 mb-1">
                  Minimum post count
                </label>
                <input
                  id="ai_ticket_summary_min_posts"
                  name="ai_ticket_summary_min_posts"
                  type="number"
                  min={5}
                  defaultValue={settings.ai_ticket_summary_min_posts || '10'}
                  className="block w-28 rounded border border-gray-300 px-2 py-1 text-xs focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none"
                />
              </div>
            </div>
          </div>

          {/* Generate KB article */}
          <div className="flex items-start gap-4">
            <div className="flex items-center pt-0.5">
              <input
                id="ai_generate_kb_article_enabled"
                name="ai_generate_kb_article_enabled"
                type="checkbox"
                defaultChecked={settings.ai_generate_kb_article_enabled === 'true'}
                className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
              />
            </div>
            <div>
              <label htmlFor="ai_generate_kb_article_enabled" className="text-sm font-medium text-gray-700">
                Generate KB article from ticket
              </label>
            </div>
          </div>
        </div>
      </div>

      {/* Usage Counter */}
      <div className="bg-white rounded-lg border border-gray-200 p-6">
        <h2 className="text-lg font-medium text-gray-900 mb-4">Current Month Usage</h2>

        <dl className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm mb-4">
          <div>
            <dt className="text-gray-500">Total AI API Calls</dt>
            <dd className="text-lg font-semibold text-gray-900" data-testid="usage-total-calls">{usage.totalCalls}</dd>
          </div>
          <div>
            <dt className="text-gray-500">Estimated Total Tokens</dt>
            <dd className="text-lg font-semibold text-gray-900" data-testid="usage-total-tokens">{usage.totalTokens.toLocaleString()}</dd>
          </div>
        </dl>

        {Object.keys(usage.byFeature).length > 0 && (
          <div>
            <h3 className="text-sm font-medium text-gray-500 mb-2">By Feature</h3>
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-200">
                  <th className="text-left py-1 pr-4 text-gray-500 font-medium">Feature</th>
                  <th className="text-right py-1 pr-4 text-gray-500 font-medium">Calls</th>
                  <th className="text-right py-1 text-gray-500 font-medium">Tokens</th>
                </tr>
              </thead>
              <tbody>
                {Object.entries(usage.byFeature).map(([feature, stats]) => (
                  <tr key={feature} className="border-b border-gray-100">
                    <td className="py-1 pr-4 text-gray-700">{FEATURE_LABELS[feature] ?? feature}</td>
                    <td className="py-1 pr-4 text-right text-gray-900">{stats.calls}</td>
                    <td className="py-1 text-right text-gray-900">{stats.tokens.toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {Object.keys(usage.byFeature).length === 0 && (
          <p className="text-sm text-gray-500">No AI usage this month.</p>
        )}
      </div>

      {/* Save */}
      <button
        type="submit"
        disabled={pending}
        className="bg-blue-600 text-white rounded px-4 py-2 text-sm font-medium hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:opacity-50"
        data-testid="save-ai-settings-btn"
      >
        {pending ? 'Saving…' : 'Save Settings'}
      </button>
    </form>
  );
}
