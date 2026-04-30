'use client';

import { useState, useTransition } from 'react';
import { saveAiSettings, testAiConnection } from '@/lib/actions/ai';
import { AdminSurveyForm } from '@/components/features/survey/AdminSurveyForm';
import aiSchema from '@/components/features/survey/form-json/admin/ai.json';

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

const BOOLEAN_KEYS = [
  'ai_auto_categorize_enabled',
  'ai_duplicate_detection_enabled',
  'ai_suggested_reply_enabled',
  'ai_ticket_summary_enabled',
  'ai_generate_kb_article_enabled',
] as const;

const NUMBER_KEYS = [
  'ai_request_timeout',
  'ai_auto_categorize_min_body_length',
  'ai_suggested_reply_context_window',
  'ai_suggested_reply_rate_limit',
  'ai_ticket_summary_min_posts',
] as const;

const DEFAULTS: Record<string, string | number | boolean> = {
  ai_provider: '',
  ai_model: '',
  ai_custom_endpoint_url: '',
  ai_request_timeout: 60,
  ai_auto_categorize_min_body_length: 20,
  ai_duplicate_detection_threshold: 'medium',
  ai_suggested_reply_context_window: 20,
  ai_suggested_reply_rate_limit: 20,
  ai_ticket_summary_min_posts: 10,
};

function buildData(settings: Record<string, string>): Record<string, unknown> {
  const data: Record<string, unknown> = {
    ai_provider: settings.ai_provider ?? DEFAULTS.ai_provider,
    ai_api_key: '',
    ai_model: settings.ai_model ?? DEFAULTS.ai_model,
    ai_custom_endpoint_url: settings.ai_custom_endpoint_url ?? DEFAULTS.ai_custom_endpoint_url,
    ai_duplicate_detection_threshold:
      settings.ai_duplicate_detection_threshold ?? DEFAULTS.ai_duplicate_detection_threshold,
  };
  for (const key of NUMBER_KEYS) {
    const raw = settings[key];
    const num = raw !== undefined ? Number(raw) : Number(DEFAULTS[key]);
    data[key] = Number.isFinite(num) ? num : DEFAULTS[key];
  }
  for (const key of BOOLEAN_KEYS) {
    data[key] = settings[key] === 'true';
  }
  return data;
}

export function AiConfigSurveyForm({ settings, usage }: Props) {
  const data = buildData(settings);
  const hasApiKey = settings.ai_api_key_present === 'true';

  const [testResult, setTestResult] = useState<{ success?: boolean; error?: string; model?: string } | null>(null);
  const [testing, startTesting] = useTransition();

  function handleTestConnection() {
    setTestResult(null);
    startTesting(async () => {
      try {
        const result = await testAiConnection();
        setTestResult(result);
      } catch {
        setTestResult({ success: false, error: 'Connection test failed.' });
      }
    });
  }

  return (
    <div className="space-y-6">
      <div className="bg-white rounded-lg border border-gray-200 p-6 space-y-3" data-testid="ai-config-survey-form">
        <AdminSurveyForm
          schema={aiSchema as Record<string, unknown>}
          data={data}
          mode="autosave"
          debounceMs={700}
          saveAction={async (fd) => {
            const res = await saveAiSettings(fd);
            return res?.error ? { message: res.error } : { message: 'AI settings saved.' };
          }}
          successMessage="AI settings saved."
        />
        {hasApiKey && (
          <p className="text-xs text-gray-500">
            API key is stored in Supabase Vault. Leave the API key field blank to keep the existing key.
          </p>
        )}
      </div>

      <div className="bg-white rounded-lg border border-gray-200 p-6">
        <h2 className="text-lg font-medium text-gray-900 mb-2">Connection Test</h2>
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
    </div>
  );
}
