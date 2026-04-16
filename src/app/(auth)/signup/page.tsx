import { getPublicAuthConfig } from '@/lib/actions/auth-config';
import { SignupForm } from './SignupForm';

export const dynamic = 'force-dynamic';

export default async function SignupPage() {
  const config = await getPublicAuthConfig();

  return <SignupForm config={config} />;
}
