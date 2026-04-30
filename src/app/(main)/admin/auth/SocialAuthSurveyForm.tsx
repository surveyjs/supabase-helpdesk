'use client';

import { updateSocialProvider } from '@/lib/actions/auth-config';
import { AdminSurveyForm } from '@/components/features/survey/AdminSurveyForm';
import authSocialSchema from '@/components/features/survey/form-json/admin/auth-social.json';

type SocialProviderConfig = {
  provider: string;
  enabled: boolean;
  tenant_id?: string;
  instance_url?: string;
};

export function SocialAuthSurveyForm({ config }: { config: SocialProviderConfig }) {
  const initial: Record<string, unknown> = {
    provider: config.provider,
    enabled: config.enabled,
    client_id: '',
    client_secret: '',
  };
  if (config.provider === 'microsoft') {
    initial.tenant_id = config.tenant_id ?? '';
  }
  if (config.provider === 'gitlab') {
    initial.instance_url = config.instance_url ?? '';
  }

  return (
    <div data-testid={`social-provider-${config.provider}`}>
      <AdminSurveyForm
        schema={authSocialSchema as Record<string, unknown>}
        data={initial}
        mode="autosave"
        saveAction={async (fd) => {
          const r = await updateSocialProvider(fd);
          if (r?.error) return { message: `Error: ${r.error}` };
          return undefined;
        }}
        successMessage="Saved."
      />
    </div>
  );
}
