import { getPublicAuthConfig } from '@/lib/actions/auth-config';
import { LoginForm } from './LoginForm';

export const dynamic = 'force-dynamic';

function first(value: string | string[] | undefined): string {
  return (Array.isArray(value) ? value[0] : value) ?? '';
}

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const config = await getPublicAuthConfig();
  const params = await searchParams;

  return (
    <LoginForm
      config={config}
      callbackError={first(params.error) ? { detail: first(params.error_detail).slice(0, 200) } : null}
    />
  );
}
