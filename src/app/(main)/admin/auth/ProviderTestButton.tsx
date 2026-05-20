'use client';

import { useState } from 'react';
import { testAuthConnection } from '@/lib/actions/auth-config';

export function ProviderTestButton({ provider }: { provider: string }) {
  const [testing, setTesting] = useState(false);
  const [result, setResult] = useState<{ success?: boolean; error?: string; details?: string } | null>(
    null,
  );

  async function handleTest() {
    setTesting(true);
    setResult(null);
    const fd = new FormData();
    fd.set('provider', provider);
    const res = await testAuthConnection(fd);
    setResult(res);
    setTesting(false);
  }

  return (
    <div className="mt-2">
      <button
        type="button"
        onClick={handleTest}
        disabled={testing}
        className="px-4 py-2 text-sm rounded bg-gray-100 text-gray-700 hover:bg-gray-200 disabled:opacity-50"
        data-testid={provider === 'external' ? 'test-external' : `test-${provider}`}
      >
        {testing ? 'Testing…' : 'Test Connection'}
      </button>
      {result && (
        <div
          className={`mt-2 p-2 rounded text-sm ${
            result.success
              ? 'bg-green-50 border border-green-200 text-green-700'
              : 'bg-red-50 border border-red-200 text-red-700'
          }`}
        >
          {result.success ? result.details : result.error}
        </div>
      )}
    </div>
  );
}
