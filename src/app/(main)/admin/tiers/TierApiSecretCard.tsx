'use client';

import { useActionState } from 'react';

type Props = {
  configured: boolean;
  masked: string;
  apiEndpoint: string;
  saveTierApiSecret: (formData: FormData) => Promise<{ error?: string }>;
  deleteTierApiSecret: () => Promise<{ error?: string }>;
};

export function TierApiSecretCard({ configured, masked, apiEndpoint, saveTierApiSecret, deleteTierApiSecret }: Props) {
  const [saveResult, saveAction, savePending] = useActionState(
    async (_prev: { error?: string }, formData: FormData) => saveTierApiSecret(formData),
    {},
  );
  const [deleteResult, deleteAction, deletePending] = useActionState(
    async () => deleteTierApiSecret(),
    {},
  );

  return (
    <div className="bg-white rounded-lg border border-gray-200 p-6 min-w-0 max-w-full" data-testid="tier-api-settings">
      <h2 className="text-lg font-semibold text-gray-900 mb-4">External API Settings</h2>

      {/* Current status */}
      <div className="mb-4">
        <span className="text-sm text-gray-700 font-medium">Shared Secret: </span>
        {configured ? (
          <span className="text-sm text-gray-600 font-mono" data-testid="tier-api-masked">{masked}</span>
        ) : (
          <span className="mt-1 flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-800">
            <svg aria-hidden="true" viewBox="0 0 20 20" fill="currentColor" className="mt-0.5 h-4 w-4 shrink-0">
              <path fillRule="evenodd" d="M8.485 2.495c.673-1.167 2.357-1.167 3.03 0l6.28 10.875c.673 1.167-.17 2.625-1.516 2.625H3.72c-1.347 0-2.189-1.458-1.515-2.625L8.485 2.495ZM10 6a.75.75 0 0 1 .75.75v3.5a.75.75 0 0 1-1.5 0v-3.5A.75.75 0 0 1 10 6Zm0 9a1 1 0 1 0 0-2 1 1 0 0 0 0 2Z" clipRule="evenodd" />
            </svg>
            Not configured — external tier assignment is unavailable
          </span>
        )}
      </div>

      {/* Set/Regenerate secret */}
      <form action={saveAction} className="mb-4">
        <div className="flex flex-wrap items-end gap-2">
          <div>
            <label htmlFor="tier-api-secret" className="block text-xs font-medium text-gray-500 mb-1">
              {configured ? 'New Secret (regenerate)' : 'Set Secret'}
            </label>
            <input
              id="tier-api-secret"
              name="secret"
              type="password"
              required
              minLength={16}
              placeholder="Min 16 characters…"
              className="rounded border border-gray-300 px-2 py-1.5 text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none w-full sm:w-64"
            />
          </div>
          <button
            type="submit"
            disabled={savePending}
            className="px-4 py-1.5 bg-blue-600 text-white text-sm rounded hover:bg-blue-700 disabled:opacity-50"
          >
            {configured ? 'Regenerate' : 'Save'}
          </button>
        </div>
        {saveResult?.error && <p className="text-sm text-red-600 mt-1">{saveResult.error}</p>}
      </form>

      {/* Delete secret */}
      {configured && (
        <form action={deleteAction} className="mb-4">
          <button
            type="submit"
            disabled={deletePending}
            className="px-3 py-1 text-xs text-red-600 hover:text-red-800 border border-red-200 rounded hover:bg-red-50 disabled:opacity-50"
          >
            Delete Secret
          </button>
          {deleteResult?.error && <p className="text-sm text-red-600 mt-1">{deleteResult.error}</p>}
        </form>
      )}

      {/* API endpoint info */}
      <div className="mt-4 border-t border-gray-200 pt-4">
        <h3 className="text-sm font-medium text-gray-700 mb-2">API Endpoint</h3>
        <code className="block text-xs bg-gray-50 p-2 rounded text-gray-700 mb-3 overflow-x-auto" data-testid="tier-api-endpoint">
          POST {apiEndpoint}
        </code>

        <h3 className="text-sm font-medium text-gray-700 mb-2">Usage</h3>
        <pre className="text-xs bg-gray-50 p-3 rounded text-gray-700 overflow-x-auto max-w-full">{`curl -X POST ${apiEndpoint} \\
  -H "Content-Type: application/json" \\
  -H "X-API-Key: YOUR_SECRET" \\
  -d '{"email": "user@example.com", "tierKey": "licensed", "expiresAt": "2026-12-31T23:59:59Z"}'`}</pre>
        <p className="text-xs text-gray-500 mt-2">
          Set <code className="bg-gray-100 px-1 rounded">tierKey</code> to <code className="bg-gray-100 px-1 rounded">&quot;none&quot;</code> to remove a user&apos;s tier.
        </p>
      </div>
    </div>
  );
}
