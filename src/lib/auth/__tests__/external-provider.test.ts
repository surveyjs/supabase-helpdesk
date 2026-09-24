import { describe, it, expect } from 'vitest';
import {
  EXTERNAL_PROVIDER_ID,
  SURVEYJS_PRESET,
  buildCustomProviderParams,
  resolveExternalProvider,
  validateExternalProvider,
  type ExternalProviderSettings,
} from '../external-provider';

function settings(overrides: Partial<ExternalProviderSettings> = {}): ExternalProviderSettings {
  return {
    preset: 'surveyjs',
    provider_name: '',
    issuer_url: '',
    authorization_url: '',
    token_url: '',
    userinfo_url: '',
    scopes: '',
    ...overrides,
  };
}

const creds = { clientId: 'client-1', clientSecret: 'secret-1' };

describe('resolveExternalProvider', () => {
  it('surveyjs preset yields the fixed SurveyJS endpoints regardless of submitted URLs', () => {
    const resolved = resolveExternalProvider(settings({
      preset: 'surveyjs',
      issuer_url: 'https://evil.example.com',
      authorization_url: 'https://evil.example.com/authorize',
      token_url: 'https://evil.example.com/token',
      userinfo_url: 'https://evil.example.com/userinfo',
    }));

    expect(resolved).toEqual({
      preset: 'surveyjs',
      provider_type: 'oauth2',
      provider_name: 'SurveyJS',
      issuer_url: 'https://auth.surveyjs.io',
      authorization_url: 'https://auth.surveyjs.io/OAuth/Authorize',
      token_url: 'https://auth.surveyjs.io/OAuth/Token',
      userinfo_url: 'https://auth.surveyjs.io/OAuth/UserInfo',
      scopes: 'openid email profile',
    });
  });

  it('keeps an admin-edited provider name for the surveyjs preset', () => {
    expect(resolveExternalProvider(settings({ provider_name: 'SurveyJS Account' })).provider_name)
      .toBe('SurveyJS Account');
  });

  it('oidc preset → provider_type oidc', () => {
    const resolved = resolveExternalProvider(settings({ preset: 'oidc', issuer_url: ' https://idp.example.com ' }));
    expect(resolved.provider_type).toBe('oidc');
    expect(resolved.issuer_url).toBe('https://idp.example.com');
  });

  it('oidc preset keeps a trailing slash — issuers are compared exactly', () => {
    const resolved = resolveExternalProvider(settings({ preset: 'oidc', issuer_url: 'https://idp.example.com/' }));
    expect(resolved.issuer_url).toBe('https://idp.example.com/');
    expect(buildCustomProviderParams(resolved, creds).issuer).toBe('https://idp.example.com/');
  });

  it('oauth2 preset → provider_type oauth2 with admin URLs', () => {
    const resolved = resolveExternalProvider(settings({
      preset: 'oauth2',
      authorization_url: 'https://idp.example.com/a',
      token_url: 'https://idp.example.com/t',
      userinfo_url: 'https://idp.example.com/u',
    }));
    expect(resolved.provider_type).toBe('oauth2');
    expect(resolved.authorization_url).toBe('https://idp.example.com/a');
  });
});

describe('buildCustomProviderParams', () => {
  it('surveyjs → oauth2 custom provider with PKCE and explicit endpoints', () => {
    const params = buildCustomProviderParams(resolveExternalProvider(settings()), creds);

    expect(params.identifier).toBe(EXTERNAL_PROVIDER_ID);
    expect(params.identifier).toBe('custom:external');
    expect(params.provider_type).toBe('oauth2');
    expect(params.pkce_enabled).toBe(true);
    expect(params.enabled).toBe(true);
    expect(params.email_optional).toBe(false);
    expect(params.client_id).toBe('client-1');
    expect(params.client_secret).toBe('secret-1');
    expect(params.scopes).toEqual(['openid', 'email', 'profile']);
    expect(params.authorization_url).toBe(SURVEYJS_PRESET.authorization_url);
    expect(params.token_url).toBe(SURVEYJS_PRESET.token_url);
    expect(params.userinfo_url).toBe(SURVEYJS_PRESET.userinfo_url);
    expect(params).not.toHaveProperty('issuer');
  });

  it('oidc → issuer set, no OAuth2 URLs', () => {
    const params = buildCustomProviderParams(
      resolveExternalProvider(settings({ preset: 'oidc', issuer_url: 'https://idp.example.com' })),
      creds,
    );
    expect(params.provider_type).toBe('oidc');
    expect(params.issuer).toBe('https://idp.example.com');
    expect(params).not.toHaveProperty('authorization_url');
    expect(params).not.toHaveProperty('token_url');
    expect(params).not.toHaveProperty('userinfo_url');
  });
});

describe('validateExternalProvider', () => {
  it('requires credentials', () => {
    expect(validateExternalProvider(settings(), false)).toMatch(/Client ID and Client Secret/);
  });

  it('rejects an http: URL for oauth2', () => {
    const error = validateExternalProvider(settings({
      preset: 'oauth2',
      authorization_url: 'http://idp.example.com/a',
      token_url: 'https://idp.example.com/t',
      userinfo_url: 'https://idp.example.com/u',
    }), true);
    expect(error).toMatch(/Authorization URL/);
  });

  it('rejects an invalid oidc issuer', () => {
    expect(validateExternalProvider(settings({ preset: 'oidc', issuer_url: 'not a url' }), true))
      .toMatch(/Issuer URL/);
  });

  it('rejects an unknown preset', () => {
    expect(validateExternalProvider(settings({ preset: 'saml' }), true)).toMatch(/preset/);
  });

  it('accepts surveyjs with credentials', () => {
    expect(validateExternalProvider(settings(), true)).toBeNull();
  });
});
