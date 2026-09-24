'use client';

import { useActionState, useEffect, useState } from 'react';
import { login, type AuthState } from '@/lib/actions/auth';
import { createBrowserClient } from '@/lib/supabase/client';
import { signInWithExternalProvider } from '@/lib/supabase/external-sign-in';
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

function ExternalButton({
  providerName,
  onError,
}: {
  providerName: string;
  onError: (message: string) => void;
}) {
  async function handleClick() {
    const { error } = await signInWithExternalProvider(createBrowserClient());
    if (error) onError(error);
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

function CallbackError({ providerName, detail }: { providerName: string; detail: string }) {
  return (
    <div
      role="alert"
      className="mb-4 p-3 rounded bg-red-50 border border-red-200 text-red-700 text-sm"
      data-testid="auth-callback-error"
    >
      Sign-in with {providerName} failed.{detail ? ` ${detail}` : ''}
    </div>
  );
}

export function LoginForm({
  config,
  callbackError,
}: {
  config: PublicAuthConfig;
  /** Set when `/auth/callback` redirected here after a failed sign-in. */
  callbackError: { detail: string } | null;
}) {
  const [state, formAction, pending] = useActionState(login, initialState);
  const [externalError, setExternalError] = useState('');

  const externalActive = config.authMode === 'external' && config.externalRegistered;
  const externalLabel = config.externalProviderName || 'External Provider';

  // Auto-redirect for external mode. Never from a page that is showing an
  // error — a failed callback would otherwise restart the flow in a loop.
  useEffect(() => {
    if (!externalActive || !config.autoRedirect) return;
    const params = new URLSearchParams(window.location.search);
    if (params.has('no_redirect') || params.has('error')) return;
    signInWithExternalProvider(createBrowserClient()).then(({ error }) => {
      if (error) setExternalError(error);
    });
  }, [externalActive, config.autoRedirect]);

  const callbackErrorBanner = callbackError && (
    <CallbackError
      providerName={config.authMode === 'external' ? externalLabel : 'the external provider'}
      detail={callbackError.detail}
    />
  );

  // External mode: show only the external provider button
  if (config.authMode === 'external') {
    if (!config.externalRegistered) {
      return (
        <>
          <h1 className="text-2xl font-semibold text-gray-900 mb-6">Log in</h1>
          {callbackErrorBanner}
          <p className="text-sm text-gray-600" data-testid="external-not-configured">
            External sign-in is not configured. Contact your administrator.
          </p>
        </>
      );
    }

    return (
      <>
        <h1 className="text-2xl font-semibold text-gray-900 mb-6">Log in</h1>
        {callbackErrorBanner}
        <p className="text-sm text-gray-600 mb-4">
          Sign in using your organization&apos;s identity provider.
        </p>
        {externalError && (
          <div
            role="alert"
            className="mb-4 p-3 rounded bg-red-50 border border-red-200 text-red-700 text-sm"
            data-testid="external-login-error"
          >
            {externalError}
          </div>
        )}
        <ExternalButton providerName={config.externalProviderName} onError={setExternalError} />
      </>
    );
  }

  // Built-in mode: email/password + social buttons
  return (
    <>
      <h1 className="text-2xl font-semibold text-gray-900 mb-6">Log in</h1>
      {callbackErrorBanner}
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
        <a href="/forgot-password" className="text-blue-600 hover:text-blue-800 underline">
          Forgot password?
        </a>
        <a href="/signup" className="text-blue-600 hover:text-blue-800 underline">
          Don&apos;t have an account? Sign up
        </a>
      </div>
    </>
  );
}
