'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { registerExternalProvider } from '@/lib/actions/auth-config';

export function ExternalProviderStatus({
  registered,
  lastError,
}: {
  registered: boolean;
  lastError: string;
}) {
  return (
    <div className="mt-4 text-sm" data-testid="external-provider-status">
      {registered ? (
        <span className="text-green-700">Registered with Supabase Auth ✓</span>
      ) : (
        <span className="text-gray-600">Not registered</span>
      )}
      {lastError && (
        <p className="mt-1 text-red-700" data-testid="external-provider-last-error">
          {lastError}
        </p>
      )}
    </div>
  );
}

/**
 * Re-runs registration from the saved settings. The form skips a submit that
 * equals the last saved snapshot, so this is the retry path after a transient
 * failure without changing any field.
 */
export function RegisterExternalProviderButton() {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [result, setResult] = useState<{ error?: string } | null>(null);

  function handleClick() {
    setResult(null);
    startTransition(async () => {
      const res = await registerExternalProvider();
      setResult(res);
      router.refresh();
    });
  }

  return (
    <div className="mt-2">
      <button
        type="button"
        onClick={handleClick}
        disabled={isPending}
        className="px-4 py-2 text-sm rounded bg-gray-100 text-gray-700 hover:bg-gray-200 disabled:opacity-50"
        data-testid="external-provider-register"
      >
        {isPending ? 'Registering…' : 'Register with Supabase Auth'}
      </button>
      {result && (
        <div
          className={`mt-2 p-2 rounded text-sm ${
            result.error
              ? 'bg-red-50 border border-red-200 text-red-700'
              : 'bg-green-50 border border-green-200 text-green-700'
          }`}
        >
          {result.error ?? 'Registered with Supabase Auth.'}
        </div>
      )}
    </div>
  );
}
