'use client';

import { useActionState, useEffect } from 'react';
import { login, type AuthState } from '@/lib/actions/auth';
import { createBrowserClient } from '@/lib/supabase/client';
import type { PublicAuthConfig } from '@/lib/actions/auth-config';

const initialState: AuthState = {};

const PROVIDER_LABELS: Record<string, string> = {
  google: 'Google',
  github: 'GitHub',
  microsoft: 'Microsoft',
  gitlab: 'GitLab',
};

// Maps our provider names to Supabase OAuth provider identifiers
const SUPABASE_PROVIDER_MAP: Record<string, string> = {
  google: 'google',
  github: 'github',
  microsoft: 'azure',
  gitlab: 'gitlab',
};

function SocialButton({ provider, label }: { provider: string; label: string }) {
  async function handleClick() {
    const supabase = createBrowserClient();
    const redirectTo = `${window.location.origin}/auth/callback`;
    await supabase.auth.signInWithOAuth({
      provider: SUPABASE_PROVIDER_MAP[provider] as 'google' | 'github' | 'azure' | 'gitlab',
      options: { redirectTo },
    });
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      className="w-full flex items-center justify-center gap-2 border border-gray-300 rounded py-2 px-4 text-sm font-medium text-gray-700 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
      data-testid={`social-login-${provider}`}
    >
      Sign in with {label}
    </button>
  );
}

function ExternalButton({ providerName }: { providerName: string }) {
  async function handleClick() {
    const supabase = createBrowserClient();
    const redirectTo = `${window.location.origin}/auth/callback`;
    await supabase.auth.signInWithOAuth({
      // @ts-expect-error - OIDC provider type not in Supabase types
      provider: 'oidc',
      options: { redirectTo },
    });
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      className="w-full bg-blue-600 text-white rounded py-2 px-4 text-sm font-medium hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
      data-testid="external-login-btn"
    >
      Sign in with {providerName || 'External Provider'}
    </button>
  );
}

export function LoginForm({ config }: { config: PublicAuthConfig }) {
  const [state, formAction, pending] = useActionState(login, initialState);

  // Auto-redirect for external mode
  useEffect(() => {
    if (
      config.authMode === 'external' &&
      config.autoRedirect &&
      typeof window !== 'undefined'
    ) {
      const params = new URLSearchParams(window.location.search);
      if (!params.has('no_redirect')) {
        const supabase = createBrowserClient();
        const redirectTo = `${window.location.origin}/auth/callback`;
        supabase.auth.signInWithOAuth({
          // @ts-expect-error - OIDC provider type not in Supabase types
          provider: 'oidc',
          options: { redirectTo },
        });
      }
    }
  }, [config]);

  // External mode: show only the external provider button
  if (config.authMode === 'external') {
    return (
      <>
        <h1 className="text-2xl font-semibold text-gray-900 mb-6">Log in</h1>
        <p className="text-sm text-gray-600 mb-4">
          Sign in using your organization&apos;s identity provider.
        </p>
        <ExternalButton providerName={config.externalProviderName} />
      </>
    );
  }

  // Built-in mode: email/password + social buttons
  return (
    <>
      <h1 className="text-2xl font-semibold text-gray-900 mb-6">Log in</h1>
      {state.error && (
        <div role="alert" className="mb-4 p-3 rounded bg-red-50 border border-red-200 text-red-700 text-sm">
          {state.error}
        </div>
      )}
      <form action={formAction} className="space-y-4">
        <div>
          <label htmlFor="email" className="block text-sm font-medium text-gray-700 mb-1">
            Email
          </label>
          <input
            id="email"
            name="email"
            type="email"
            required
            maxLength={320}
            autoComplete="email"
            className="block w-full rounded border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none"
          />
        </div>
        <div>
          <label htmlFor="password" className="block text-sm font-medium text-gray-700 mb-1">
            Password
          </label>
          <input
            id="password"
            name="password"
            type="password"
            required
            autoComplete="current-password"
            className="block w-full rounded border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none"
          />
        </div>
        <button
          type="submit"
          disabled={pending}
          className="w-full bg-blue-600 text-white rounded py-2 px-4 text-sm font-medium hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:opacity-50"
        >
          {pending ? 'Logging in…' : 'Log in'}
        </button>
      </form>

      {/* Social provider buttons */}
      {config.enabledSocialProviders.length > 0 && (
        <div className="mt-6">
          <div className="relative mb-4">
            <div className="absolute inset-0 flex items-center">
              <div className="w-full border-t border-gray-200" />
            </div>
            <div className="relative flex justify-center text-xs uppercase">
              <span className="bg-white px-2 text-gray-500">Or continue with</span>
            </div>
          </div>
          <div className="space-y-2">
            {config.enabledSocialProviders.map((provider) => (
              <SocialButton
                key={provider}
                provider={provider}
                label={PROVIDER_LABELS[provider] ?? provider}
              />
            ))}
          </div>
        </div>
      )}

      <div className="mt-4 flex items-center justify-between text-sm">
        <a href="/forgot-password" className="text-blue-600 hover:text-blue-800 underline underline">
          Forgot password?
        </a>
        <a href="/signup" className="text-blue-600 hover:text-blue-800 underline underline">
          Don&apos;t have an account? Sign up
        </a>
      </div>
    </>
  );
}
