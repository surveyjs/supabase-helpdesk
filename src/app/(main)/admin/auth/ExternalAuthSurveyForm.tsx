'use client';

import { updateExternalProvider } from '@/lib/actions/auth-config';
import { AdminSurveyForm } from '@/components/features/survey/AdminSurveyForm';
import authExternalSchema from '@/components/features/survey/form-json/admin/auth-external.json';

type ExternalProviderConfig = {
  provider_name: string;
  issuer_url: string;
  scopes: string;
  auto_redirect: boolean;
};

export function ExternalAuthSurveyForm({ config }: { config: ExternalProviderConfig }) {
  const initial: Record<string, unknown> = {
    provider_name: config.provider_name,
    issuer_url: config.issuer_url,
    scopes: config.scopes,
    auto_redirect: config.auto_redirect,
    client_id: '',
    client_secret: '',
  };

  return (
    <div data-testid="external-provider-survey">
      <AdminSurveyForm
        schema={authExternalSchema as Record<string, unknown>}
        data={initial}
        mode="autosave"
        saveAction={async (fd) => {
          const r = await updateExternalProvider(fd);
          if (r?.error) return { message: `Error: ${r.error}` };
          return undefined;
        }}
        successMessage="Saved."
      />
    </div>
  );
}
