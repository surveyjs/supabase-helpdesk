import { getPublicAuthConfig } from '@/lib/actions/auth-config';
import { LoginForm } from './LoginForm';

export const dynamic = 'force-dynamic';

export default async function LoginPage() {
  const config = await getPublicAuthConfig();

  return <LoginForm config={config} />;
}
