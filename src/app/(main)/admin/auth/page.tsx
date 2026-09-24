import { getAuthConfigSettings, getRedirectUri } from '@/lib/actions/auth-config';
import { AuthModeSelector } from './AuthModeSelector';
import { SocialAuthSurveyForm } from './SocialAuthSurveyForm';
import { ExternalAuthSurveyForm } from './ExternalAuthSurveyForm';
import { ProviderTestButton } from './ProviderTestButton';
import { CopyRedirectUriButton } from './CopyRedirectUriButton';
import { ExternalProviderStatus, RegisterExternalProviderButton } from './ExternalProviderStatus';

const SOCIAL_PROVIDERS = [
  { key: 'google', label: 'Google' },
  { key: 'github', label: 'GitHub' },
  { key: 'microsoft', label: 'Microsoft' },
  { key: 'gitlab', label: 'GitLab' },
] as const;

export default async function AdminAuthPage() {
  const settings = await getAuthConfigSettings();
  const redirectUri = await getRedirectUri();
  const mode = settings.auth_mode;

  return (
    <div className="space-y-8">
      <h1 className="text-2xl font-semibold text-gray-900 mb-6">Authentication</h1>

      <AuthModeSelector initialMode={mode} />

      {/* Configuration does not depend on auth_mode — only login/signup behaviour does. */}
      <div
        className="bg-white rounded-lg border border-gray-200 p-6"
        data-testid="external-provider-config"
      >
        <h2 className="text-lg font-medium text-gray-900 mb-4">External Provider</h2>
        {mode === 'built-in' && (
          <p className="text-sm text-gray-600 mb-4" data-testid="external-provider-intro">
            Configure and register the provider here first, then switch the mode to External.
          </p>
        )}

        <ExternalAuthSurveyForm
          config={{
            preset: settings.auth_external_preset,
            provider_name: settings.auth_external_provider_name,
            issuer_url: settings.auth_external_issuer_url,
            authorization_url: settings.auth_external_authorization_url,
            token_url: settings.auth_external_token_url,
            userinfo_url: settings.auth_external_userinfo_url,
            scopes: settings.auth_external_scopes,
            auto_redirect: settings.auth_external_auto_redirect === 'true',
            credentials_present: settings.auth_external_client_id_present,
          }}
        />

        <ExternalProviderStatus
          registered={settings.auth_external_registered === 'true'}
          lastError={settings.auth_external_last_error}
        />

        <div className="mt-6">
          <label className="block text-sm font-medium text-gray-700 mb-1">Redirect URI</label>
          <div className="flex items-center">
            <input
              type="text"
              value={redirectUri}
              readOnly
              className="block w-full rounded border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-500"
              data-testid="redirect-uri"
            />
            <CopyRedirectUriButton text={redirectUri} />
          </div>
          <p className="mt-1 text-xs text-gray-500">
            Register this URL as the allowed redirect URI at your identity provider.
          </p>
        </div>

        <div className="flex flex-wrap items-start gap-2">
          <ProviderTestButton provider="external" />
          <RegisterExternalProviderButton />
        </div>
      </div>

      {mode === 'built-in' && (
        <div>
          <h2 className="text-lg font-medium text-gray-900 mb-4">Social OAuth Providers</h2>
          <div className="space-y-4">
            {SOCIAL_PROVIDERS.map((p) => (
              <div key={p.key} className="bg-white rounded-lg border border-gray-200 p-6">
                <h3 className="text-base font-medium text-gray-900 mb-4">{p.label}</h3>
                <SocialAuthSurveyForm
                  config={{
                    provider: p.key,
                    enabled: settings[`auth_${p.key}_enabled` as keyof typeof settings] === 'true',
                    tenant_id:
                      p.key === 'microsoft' ? settings.auth_microsoft_tenant_id : undefined,
                    instance_url:
                      p.key === 'gitlab' ? settings.auth_gitlab_instance_url : undefined,
                  }}
                />
                <ProviderTestButton provider={p.key} />
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
