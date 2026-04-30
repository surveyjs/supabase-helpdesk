'use client';

import { useState } from 'react';
import { updateAuthMode } from '@/lib/actions/auth-config';

export function AuthModeSelector({ initialMode }: { initialMode: string }) {
  const [mode, setMode] = useState(initialMode);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [pendingMode, setPendingMode] = useState('');

  function handleModeChange(newMode: string) {
    if (newMode !== mode) {
      setPendingMode(newMode);
      setShowConfirm(true);
    }
  }

  async function confirmModeChange() {
    setShowConfirm(false);
    setSaving(true);
    setError('');
    const fd = new FormData();
    fd.set('mode', pendingMode);
    const res = await updateAuthMode(fd);
    if (res.error) {
      setError(res.error);
    } else {
      setMode(pendingMode);
      // Force a full reload so server-rendered sections re-evaluate.
      window.location.reload();
    }
    setSaving(false);
  }

  return (
    <div className="bg-white rounded-lg border border-gray-200 p-6">
      <h2 className="text-lg font-medium text-gray-900 mb-4">Authentication Mode</h2>

      {error && (
        <div className="mb-4 p-2 rounded bg-red-50 border border-red-200 text-red-700 text-sm">
          {error}
        </div>
      )}

      <div className="space-y-3">
        <label
          className="flex items-start gap-3 p-3 rounded border border-gray-200 cursor-pointer hover:bg-gray-50"
          data-testid="mode-builtin"
        >
          <input
            type="radio"
            name="auth_mode"
            value="built-in"
            checked={mode === 'built-in'}
            onChange={() => handleModeChange('built-in')}
            className="mt-0.5 h-4 w-4 border-gray-300 text-blue-600 focus:ring-blue-500"
          />
          <div>
            <div className="text-sm font-medium text-gray-900">Built-in</div>
            <p className="text-xs text-gray-500 mt-0.5">
              Email/password authentication with optional social OAuth providers (Google, GitHub,
              Microsoft, GitLab).
            </p>
          </div>
        </label>
        <label
          className="flex items-start gap-3 p-3 rounded border border-gray-200 cursor-pointer hover:bg-gray-50"
          data-testid="mode-external"
        >
          <input
            type="radio"
            name="auth_mode"
            value="external"
            checked={mode === 'external'}
            onChange={() => handleModeChange('external')}
            className="mt-0.5 h-4 w-4 border-gray-300 text-blue-600 focus:ring-blue-500"
          />
          <div>
            <div className="text-sm font-medium text-gray-900">External (OAuth/OIDC)</div>
            <p className="text-xs text-gray-500 mt-0.5">
              Delegate authentication to an external identity provider via OAuth/OIDC. Users sign in
              through the external provider.
            </p>
          </div>
        </label>
      </div>

      {showConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30">
          <div
            className="bg-white rounded-lg border border-gray-200 p-6 max-w-md shadow-lg"
            data-testid="mode-confirm-dialog"
          >
            <h3 className="text-lg font-medium text-gray-900 mb-2">Switch authentication mode?</h3>
            <p className="text-sm text-gray-600 mb-4">
              Switching authentication mode will affect how all users sign in. Existing users will
              remain and can still access their accounts. Continue?
            </p>
            <div className="flex gap-3">
              <button
                onClick={confirmModeChange}
                disabled={saving}
                className="px-4 py-2 bg-blue-600 text-white text-sm rounded hover:bg-blue-700 disabled:opacity-50"
                data-testid="confirm-mode-switch"
              >
                {saving ? 'Switching…' : 'Continue'}
              </button>
              <button
                onClick={() => setShowConfirm(false)}
                className="px-4 py-2 bg-gray-100 text-gray-700 text-sm rounded hover:bg-gray-200"
                data-testid="cancel-mode-switch"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
