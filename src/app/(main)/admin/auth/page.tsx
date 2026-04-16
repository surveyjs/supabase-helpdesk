import { getAuthConfigSettings, getRedirectUri } from '@/lib/actions/auth-config';
import { AuthConfigForm } from './AuthConfigForm';

export default async function AdminAuthPage() {
  const settings = await getAuthConfigSettings();
  const redirectUri = await getRedirectUri();

  return (
    <div>
      <h1 className="text-2xl font-semibold text-gray-900 mb-6">Authentication</h1>
      <AuthConfigForm settings={settings} redirectUri={redirectUri} />
    </div>
  );
}
