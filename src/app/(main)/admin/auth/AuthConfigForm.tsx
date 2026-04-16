'use client';

import { useState } from 'react';
import {
  updateAuthMode,
  updateSocialProvider,
  updateExternalProvider,
  testAuthConnection,
  type AuthConfigSettings,
} from '@/lib/actions/auth-config';

type Props = {
  settings: AuthConfigSettings;
  redirectUri: string;
};

const SOCIAL_PROVIDERS = [
  { key: 'google', label: 'Google' },
  { key: 'github', label: 'GitHub' },
  { key: 'microsoft', label: 'Microsoft' },
  { key: 'gitlab', label: 'GitLab' },
] as const;

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <button
      type="button"
      onClick={handleCopy}
      className="ml-2 px-2 py-1 text-xs rounded bg-gray-100 text-gray-600 hover:bg-gray-200"
      data-testid="copy-redirect-uri"
    >
      {copied ? 'Copied!' : 'Copy'}
    </button>
  );
}

function SocialProviderCard({
  provider,
  label,
  enabled,
  hasCredentials,
}: {
  provider: string;
  label: string;
  enabled: boolean;
  hasCredentials: boolean;
}) {
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [result, setResult] = useState<{ error?: string; success?: string } | null>(null);
  const [testResult, setTestResult] = useState<{ success?: boolean; error?: string; details?: string } | null>(null);
  const [isEnabled, setIsEnabled] = useState(enabled);

  async function handleSave(formData: FormData) {
    setSaving(true);
    setResult(null);
    formData.set('provider', provider);
    formData.set('enabled', isEnabled ? 'true' : 'false');
    const res = await updateSocialProvider(formData);
    if (res.error) {
      setResult({ error: res.error });
    } else {
      setResult({ success: 'Saved.' });
    }
    setSaving(false);
  }

  async function handleTest() {
    setTesting(true);
    setTestResult(null);
    const fd = new FormData();
    fd.set('provider', provider);
    const res = await testAuthConnection(fd);
    setTestResult(res);
    setTesting(false);
  }

  return (
    <div className="bg-white rounded-lg border border-gray-200 p-6" data-testid={`social-provider-${provider}`}>
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-base font-medium text-gray-900">{label}</h3>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={isEnabled}
            onChange={(e) => setIsEnabled(e.target.checked)}
            className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
            data-testid={`toggle-${provider}`}
          />
          Enabled
        </label>
      </div>

      <form action={handleSave} className="space-y-3">
        <div>
          <label htmlFor={`${provider}_client_id`} className="block text-sm font-medium text-gray-700 mb-1">
            Client ID
          </label>
          <input
            id={`${provider}_client_id`}
            name="client_id"
            type="text"
            placeholder={hasCredentials ? '••••••••' : 'Enter Client ID'}
            className="block w-full rounded border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none"
          />
        </div>
        <div>
          <label htmlFor={`${provider}_client_secret`} className="block text-sm font-medium text-gray-700 mb-1">
            Client Secret
          </label>
          <input
            id={`${provider}_client_secret`}
            name="client_secret"
            type="password"
            placeholder={hasCredentials ? '••••••••' : 'Enter Client Secret'}
            className="block w-full rounded border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none"
            data-testid={`${provider}-client-secret`}
          />
        </div>

        {provider === 'microsoft' && (
          <div>
            <label htmlFor="microsoft_tenant_id" className="block text-sm font-medium text-gray-700 mb-1">
              Tenant ID
            </label>
            <input
              id="microsoft_tenant_id"
              name="tenant_id"
              type="text"
              placeholder="Enter Tenant ID"
              className="block w-full rounded border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none"
            />
          </div>
        )}

        {provider === 'gitlab' && (
          <div>
            <label htmlFor="gitlab_instance_url" className="block text-sm font-medium text-gray-700 mb-1">
              Instance URL <span className="text-gray-400 font-normal">(optional, for self-hosted)</span>
            </label>
            <input
              id="gitlab_instance_url"
              name="instance_url"
              type="url"
              placeholder="https://gitlab.example.com"
              className="block w-full rounded border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none"
            />
          </div>
        )}

        <div className="flex items-center gap-3 pt-2">
          <button
            type="submit"
            disabled={saving}
            className="px-4 py-2 bg-blue-600 text-white text-sm rounded hover:bg-blue-700 disabled:opacity-50"
            data-testid={`save-${provider}`}
          >
            {saving ? 'Saving…' : 'Save'}
          </button>
          <button
            type="button"
            onClick={handleTest}
            disabled={testing}
            className="px-4 py-2 text-sm rounded bg-gray-100 text-gray-700 hover:bg-gray-200 disabled:opacity-50"
            data-testid={`test-${provider}`}
          >
            {testing ? 'Testing…' : 'Test Connection'}
          </button>
        </div>

        {result?.error && (
          <div className="p-2 rounded bg-red-50 border border-red-200 text-red-700 text-sm">{result.error}</div>
        )}
        {result?.success && (
          <div className="p-2 rounded bg-green-50 border border-green-200 text-green-700 text-sm">{result.success}</div>
        )}
        {testResult && (
          <div className={`p-2 rounded text-sm ${testResult.success ? 'bg-green-50 border border-green-200 text-green-700' : 'bg-red-50 border border-red-200 text-red-700'}`}>
            {testResult.success ? `✓ ${testResult.details}` : `✗ ${testResult.error}`}
          </div>
        )}
      </form>
    </div>
  );
}

export function AuthConfigForm({ settings, redirectUri }: Props) {
  const [mode, setMode] = useState(settings.auth_mode);
  const [modeError, setModeError] = useState('');
  const [modeSaving, setModeSaving] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [pendingMode, setPendingMode] = useState('');

  // External provider state
  const [extSaving, setExtSaving] = useState(false);
  const [extResult, setExtResult] = useState<{ error?: string; success?: string } | null>(null);
  const [extTesting, setExtTesting] = useState(false);
  const [extTestResult, setExtTestResult] = useState<{ success?: boolean; error?: string; details?: string } | null>(null);

  function handleModeChange(newMode: string) {
    if (newMode !== mode) {
      setPendingMode(newMode);
      setShowConfirm(true);
    }
  }

  async function confirmModeChange() {
    setShowConfirm(false);
    setModeSaving(true);
    setModeError('');
    const fd = new FormData();
    fd.set('mode', pendingMode);
    const res = await updateAuthMode(fd);
    if (res.error) {
      setModeError(res.error);
    } else {
      setMode(pendingMode);
    }
    setModeSaving(false);
  }

  async function handleExtSave(formData: FormData) {
    setExtSaving(true);
    setExtResult(null);
    const res = await updateExternalProvider(formData);
    if (res.error) {
      setExtResult({ error: res.error });
    } else {
      setExtResult({ success: 'Saved.' });
    }
    setExtSaving(false);
  }

  async function handleExtTest() {
    setExtTesting(true);
    setExtTestResult(null);
    const fd = new FormData();
    fd.set('provider', 'external');
    const res = await testAuthConnection(fd);
    setExtTestResult(res);
    setExtTesting(false);
  }

  return (
    <div className="space-y-8">
      {/* Confirmation dialog */}
      {showConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30">
          <div className="bg-white rounded-lg border border-gray-200 p-6 max-w-md shadow-lg" data-testid="mode-confirm-dialog">
            <h3 className="text-lg font-medium text-gray-900 mb-2">Switch authentication mode?</h3>
            <p className="text-sm text-gray-600 mb-4">
              Switching authentication mode will affect how all users sign in. Existing users will remain and can still access their accounts. Continue?
            </p>
            <div className="flex gap-3">
              <button
                onClick={confirmModeChange}
                disabled={modeSaving}
                className="px-4 py-2 bg-blue-600 text-white text-sm rounded hover:bg-blue-700 disabled:opacity-50"
                data-testid="confirm-mode-switch"
              >
                {modeSaving ? 'Switching…' : 'Continue'}
              </button>
              <button
                onClick={() => setShowConfirm(false)}
                className="px-4 py-2 bg-gray-100 text-gray-700 text-sm rounded hover:bg-gray-200"
                data-testid="cancel-mode-switch"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Auth mode selection */}
      <div className="bg-white rounded-lg border border-gray-200 p-6">
        <h2 className="text-lg font-medium text-gray-900 mb-4">Authentication Mode</h2>

        {modeError && (
          <div className="mb-4 p-2 rounded bg-red-50 border border-red-200 text-red-700 text-sm">{modeError}</div>
        )}

        <div className="space-y-3">
          <label className="flex items-start gap-3 p-3 rounded border border-gray-200 cursor-pointer hover:bg-gray-50" data-testid="mode-builtin">
            <input
              type="radio"
              name="auth_mode"
              value="built-in"
              checked={mode === 'built-in'}
              onChange={() => handleModeChange('built-in')}
              className="mt-0.5 h-4 w-4 border-gray-300 text-blue-600 focus:ring-blue-500"
            />
            <div>
              <div className="text-sm font-medium text-gray-900">Built-in</div>
              <p className="text-xs text-gray-500 mt-0.5">
                Email/password authentication with optional social OAuth providers (Google, GitHub, Microsoft, GitLab).
              </p>
            </div>
          </label>
          <label className="flex items-start gap-3 p-3 rounded border border-gray-200 cursor-pointer hover:bg-gray-50" data-testid="mode-external">
            <input
              type="radio"
              name="auth_mode"
              value="external"
              checked={mode === 'external'}
              onChange={() => handleModeChange('external')}
              className="mt-0.5 h-4 w-4 border-gray-300 text-blue-600 focus:ring-blue-500"
            />
            <div>
              <div className="text-sm font-medium text-gray-900">External (OAuth/OIDC)</div>
              <p className="text-xs text-gray-500 mt-0.5">
                Delegate authentication to an external identity provider via OAuth/OIDC. Users sign in through the external provider.
              </p>
            </div>
          </label>
        </div>
      </div>

      {/* Built-in mode settings */}
      {mode === 'built-in' && (
        <div>
          <h2 className="text-lg font-medium text-gray-900 mb-4">Social OAuth Providers</h2>
          <div className="space-y-4">
            {SOCIAL_PROVIDERS.map((p) => (
              <SocialProviderCard
                key={p.key}
                provider={p.key}
                label={p.label}
                enabled={settings[`auth_${p.key}_enabled` as keyof AuthConfigSettings] === 'true'}
                hasCredentials={!!settings[`auth_${p.key}_client_id_present` as keyof AuthConfigSettings]}
              />
            ))}
          </div>
        </div>
      )}

      {/* External mode settings */}
      {mode === 'external' && (
        <div className="bg-white rounded-lg border border-gray-200 p-6" data-testid="external-provider-config">
          <h2 className="text-lg font-medium text-gray-900 mb-4">External Provider Configuration</h2>

          <form action={handleExtSave} className="space-y-4">
            <div>
              <label htmlFor="ext_provider_name" className="block text-sm font-medium text-gray-700 mb-1">
                Provider Name
              </label>
              <input
                id="ext_provider_name"
                name="provider_name"
                type="text"
                defaultValue={settings.auth_external_provider_name}
                placeholder="e.g., SurveyJS SSO"
                className="block w-full rounded border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none"
              />
              <p className="mt-1 text-xs text-gray-500">Display name shown on the login button.</p>
            </div>

            <div>
              <label htmlFor="ext_client_id" className="block text-sm font-medium text-gray-700 mb-1">
                Client ID
              </label>
              <input
                id="ext_client_id"
                name="client_id"
                type="text"
                placeholder={settings.auth_external_client_id_present ? '••••••••' : 'Enter Client ID'}
                className="block w-full rounded border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none"
              />
            </div>

            <div>
              <label htmlFor="ext_client_secret" className="block text-sm font-medium text-gray-700 mb-1">
                Client Secret
              </label>
              <input
                id="ext_client_secret"
                name="client_secret"
                type="password"
                placeholder={settings.auth_external_client_id_present ? '••••••••' : 'Enter Client Secret'}
                className="block w-full rounded border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none"
                data-testid="external-client-secret"
              />
            </div>

            <div>
              <label htmlFor="ext_issuer_url" className="block text-sm font-medium text-gray-700 mb-1">
                Issuer URL
              </label>
              <input
                id="ext_issuer_url"
                name="issuer_url"
                type="url"
                defaultValue={settings.auth_external_issuer_url}
                placeholder="https://auth.example.com"
                className="block w-full rounded border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none"
              />
              <p className="mt-1 text-xs text-gray-500">
                OIDC discovery URL. Must support <code>/.well-known/openid-configuration</code>.
              </p>
            </div>

            <div>
              <label htmlFor="ext_scopes" className="block text-sm font-medium text-gray-700 mb-1">
                Scopes
              </label>
              <input
                id="ext_scopes"
                name="scopes"
                type="text"
                defaultValue={settings.auth_external_scopes}
                placeholder="openid email profile"
                className="block w-full rounded border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none"
              />
              <p className="mt-1 text-xs text-gray-500">Space-separated list of OAuth scopes.</p>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Redirect URI
              </label>
              <div className="flex items-center">
                <input
                  type="text"
                  value={redirectUri}
                  readOnly
                  className="block w-full rounded border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-500"
                  data-testid="redirect-uri"
                />
                <CopyButton text={redirectUri} />
              </div>
              <p className="mt-1 text-xs text-gray-500">Add this URI to your identity provider&apos;s allowed redirect URIs.</p>
            </div>

            <div className="flex items-center gap-2">
              <input
                id="ext_auto_redirect"
                name="auto_redirect"
                type="checkbox"
                value="true"
                defaultChecked={settings.auth_external_auto_redirect === 'true'}
                className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                data-testid="auto-redirect-toggle"
              />
              <label htmlFor="ext_auto_redirect" className="text-sm text-gray-700">
                Auto-redirect to external provider
              </label>
            </div>
            <p className="text-xs text-gray-500 -mt-2 ml-6">
              When enabled, unauthenticated users are automatically redirected to the external login page.
              Access <code>/login?no_redirect=true</code> to bypass.
            </p>

            <div className="flex items-center gap-3 pt-2">
              <button
                type="submit"
                disabled={extSaving}
                className="px-4 py-2 bg-blue-600 text-white text-sm rounded hover:bg-blue-700 disabled:opacity-50"
                data-testid="save-external"
              >
                {extSaving ? 'Saving…' : 'Save'}
              </button>
              <button
                type="button"
                onClick={handleExtTest}
                disabled={extTesting}
                className="px-4 py-2 text-sm rounded bg-gray-100 text-gray-700 hover:bg-gray-200 disabled:opacity-50"
                data-testid="test-external"
              >
                {extTesting ? 'Testing…' : 'Test Connection'}
              </button>
            </div>

            {extResult?.error && (
              <div className="p-2 rounded bg-red-50 border border-red-200 text-red-700 text-sm">{extResult.error}</div>
            )}
            {extResult?.success && (
              <div className="p-2 rounded bg-green-50 border border-green-200 text-green-700 text-sm">{extResult.success}</div>
            )}
            {extTestResult && (
              <div className={`p-2 rounded text-sm ${extTestResult.success ? 'bg-green-50 border border-green-200 text-green-700' : 'bg-red-50 border border-red-200 text-red-700'}`}>
                {extTestResult.success ? `✓ ${extTestResult.details}` : `✗ ${extTestResult.error}`}
              </div>
            )}
          </form>
        </div>
      )}
    </div>
  );
}
