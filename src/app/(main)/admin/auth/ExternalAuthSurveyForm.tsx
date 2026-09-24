'use client';

import { useMemo } from 'react';
import { updateExternalProvider } from '@/lib/actions/auth-config';
import { AdminSurveyForm } from '@/components/features/survey/AdminSurveyForm';
import authExternalSchema from '@/components/features/survey/form-json/admin/auth-external.json';

type ExternalProviderConfig = {
  preset: string;
  provider_name: string;
  issuer_url: string;
  authorization_url: string;
  token_url: string;
  userinfo_url: string;
  scopes: string;
  auto_redirect: boolean;
  credentials_present: boolean;
};

const SAVED_PLACEHOLDER = '•••••• (saved)';

function withCredentialPlaceholders(schema: Record<string, unknown>): Record<string, unknown> {
  const clone = JSON.parse(JSON.stringify(schema));
  const visit = (elements: Record<string, unknown>[] | undefined) => {
    for (const el of elements ?? []) {
      if (el.name === 'client_id' || el.name === 'client_secret') el.placeholder = SAVED_PLACEHOLDER;
      visit(el.elements as Record<string, unknown>[] | undefined);
    }
  };
  for (const page of clone.pages ?? []) visit(page.elements);
  return clone;
}

export function ExternalAuthSurveyForm({ config }: { config: ExternalProviderConfig }) {
  // Stable references: a new schema object would rebuild the SurveyJS model.
  const schema = useMemo(
    () =>
      config.credentials_present
        ? withCredentialPlaceholders(authExternalSchema as Record<string, unknown>)
        : (authExternalSchema as Record<string, unknown>),
    [config.credentials_present],
  );

  const initial = useMemo(() => {
    const data: Record<string, unknown> = {
      preset: config.preset || 'surveyjs',
      issuer_url: config.issuer_url,
      authorization_url: config.authorization_url,
      token_url: config.token_url,
      userinfo_url: config.userinfo_url,
      scopes: config.scopes,
      auto_redirect: config.auto_redirect,
      client_id: '',
      client_secret: '',
    };
    // Seeding `data` bypasses the schema's defaultValueExpression, so apply the
    // SurveyJS default here (the server falls back to it as well).
    const preset = config.preset || 'surveyjs';
    if (config.provider_name) data.provider_name = config.provider_name;
    else if (preset === 'surveyjs') data.provider_name = 'SurveyJS';
    return data;
  }, [
    config.preset,
    config.provider_name,
    config.issuer_url,
    config.authorization_url,
    config.token_url,
    config.userinfo_url,
    config.scopes,
    config.auto_redirect,
  ]);

  return (
    <div data-testid="external-provider-survey">
      <AdminSurveyForm
        schema={schema}
        data={initial}
        mode="complete"
        keepOpen
        // Registering with Supabase Auth on every keystroke would be wrong, so
        // this form saves explicitly. `{ error }` is passed through unchanged so
        // AdminSurveyForm keeps the failed submission retryable.
        saveAction={updateExternalProvider}
        successMessage="Saved and registered with Supabase Auth."
      />
    </div>
  );
}
