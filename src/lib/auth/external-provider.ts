import type { CreateCustomProviderParams, CustomProviderType } from '@supabase/supabase-js';

/**
 * Pure helpers for the External (OAuth/OIDC) authentication mode.
 *
 * The external provider is registered with Supabase Auth as a *custom provider*
 * under a single fixed identifier; login/signup call
 * `signInWithOAuth({ provider: EXTERNAL_PROVIDER_ID })`.
 *
 * No I/O here — this module is shared by server actions, client components and
 * unit tests.
 */

export const EXTERNAL_PROVIDER_ID = 'custom:external' as const;

export const EXTERNAL_PRESETS = ['surveyjs', 'oidc', 'oauth2'] as const;
export type ExternalPreset = typeof EXTERNAL_PRESETS[number];

export const DEFAULT_EXTERNAL_SCOPES = 'openid email profile';

/**
 * auth.surveyjs.io issues HS256 ID tokens (signed with the client secret) and
 * publishes an empty JWKS, so Supabase's OIDC mode cannot verify them. It is
 * registered as plain OAuth 2.0 and the user is read from the UserInfo endpoint.
 */
export const SURVEYJS_PRESET = {
  provider_name: 'SurveyJS',
  provider_type: 'oauth2',
  authorization_url: 'https://auth.surveyjs.io/OAuth/Authorize',
  token_url: 'https://auth.surveyjs.io/OAuth/Token',
  userinfo_url: 'https://auth.surveyjs.io/OAuth/UserInfo',
  issuer_url: 'https://auth.surveyjs.io',
  scopes: DEFAULT_EXTERNAL_SCOPES,
} as const;

/** The `auth_external_*` settings (without the prefix), as stored strings. */
export type ExternalProviderSettings = {
  preset: string;
  provider_name: string;
  issuer_url: string;
  authorization_url: string;
  token_url: string;
  userinfo_url: string;
  scopes: string;
};

export type ResolvedExternalProvider = {
  preset: ExternalPreset;
  provider_type: CustomProviderType;
  provider_name: string;
  issuer_url: string;
  authorization_url: string;
  token_url: string;
  userinfo_url: string;
  scopes: string;
};

export function isExternalPreset(value: string): value is ExternalPreset {
  return (EXTERNAL_PRESETS as readonly string[]).includes(value);
}

/**
 * Resolves preset → concrete settings, including `provider_type`
 * (surveyjs fills every endpoint and is always oauth2; oidc/oauth2 use admin input).
 * This is the only place the provider type is decided.
 */
export function resolveExternalProvider(s: ExternalProviderSettings): ResolvedExternalProvider {
  const preset: ExternalPreset = isExternalPreset(s.preset) ? s.preset : 'surveyjs';
  const scopes = s.scopes.trim() || DEFAULT_EXTERNAL_SCOPES;
  const providerName = s.provider_name.trim();

  if (preset === 'surveyjs') {
    return {
      preset,
      provider_type: SURVEYJS_PRESET.provider_type,
      provider_name: providerName || SURVEYJS_PRESET.provider_name,
      issuer_url: SURVEYJS_PRESET.issuer_url,
      authorization_url: SURVEYJS_PRESET.authorization_url,
      token_url: SURVEYJS_PRESET.token_url,
      userinfo_url: SURVEYJS_PRESET.userinfo_url,
      scopes,
    };
  }

  if (preset === 'oidc') {
    return {
      preset,
      provider_type: 'oidc',
      provider_name: providerName || 'OpenID Connect',
      // OIDC compares issuers exactly, trailing slash included: keep it as entered.
      issuer_url: s.issuer_url.trim(),
      authorization_url: '',
      token_url: '',
      userinfo_url: '',
      scopes,
    };
  }

  return {
    preset,
    provider_type: 'oauth2',
    provider_name: providerName || 'OAuth 2.0',
    issuer_url: '',
    authorization_url: s.authorization_url.trim(),
    token_url: s.token_url.trim(),
    userinfo_url: s.userinfo_url.trim(),
    scopes,
  };
}

/** Maps resolved settings + credentials to CreateCustomProviderParams for the admin API. */
export function buildCustomProviderParams(
  resolved: ResolvedExternalProvider,
  creds: { clientId: string; clientSecret: string },
): CreateCustomProviderParams {
  const params: CreateCustomProviderParams = {
    provider_type: resolved.provider_type,
    identifier: EXTERNAL_PROVIDER_ID,
    name: resolved.provider_name,
    client_id: creds.clientId,
    client_secret: creds.clientSecret,
    scopes: resolved.scopes.split(/\s+/).filter(Boolean),
    pkce_enabled: true,
    enabled: true,
    email_optional: false,
  };

  if (resolved.provider_type === 'oidc') {
    // GoTrue derives the discovery URL from the issuer; no explicit discovery_url needed.
    params.issuer = resolved.issuer_url;
  } else {
    params.authorization_url = resolved.authorization_url;
    params.token_url = resolved.token_url;
    params.userinfo_url = resolved.userinfo_url;
  }

  return params;
}

function isHttpsUrl(value: string): boolean {
  try {
    return new URL(value).protocol === 'https:';
  } catch {
    return false;
  }
}

/** Validation for the admin form: returns an error string or null. */
export function validateExternalProvider(s: ExternalProviderSettings, hasCreds: boolean): string | null {
  if (!isExternalPreset(s.preset)) {
    return 'Invalid provider preset.';
  }

  const resolved = resolveExternalProvider(s);

  if (resolved.preset === 'oidc' && !isHttpsUrl(resolved.issuer_url)) {
    return 'Issuer URL must be a valid https:// URL.';
  }

  if (resolved.preset === 'oauth2') {
    const urls: [string, string][] = [
      ['Authorization URL', resolved.authorization_url],
      ['Token URL', resolved.token_url],
      ['UserInfo URL', resolved.userinfo_url],
    ];
    for (const [label, url] of urls) {
      if (!isHttpsUrl(url)) return `${label} must be a valid https:// URL.`;
    }
  }

  if (!hasCreds) {
    return 'Client ID and Client Secret are required to register the provider.';
  }

  return null;
}
