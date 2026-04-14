'use client';

import { useActionState } from 'react';
import { updateDisplayName, type ProfileActionState } from '@/lib/actions/profile';

const initialState: ProfileActionState = {};

export function DisplayNameForm({
  currentName,
  enforceUniqueness,
}: {
  currentName: string;
  enforceUniqueness: boolean;
}) {
  const [state, formAction, pending] = useActionState(updateDisplayName, initialState);

  return (
    <form action={formAction}>
      <div className="mb-3">
        <label htmlFor="display_name" className="block text-sm font-medium text-gray-700 mb-1">
          Display Name
        </label>
        <input
          id="display_name"
          name="display_name"
          type="text"
          maxLength={100}
          defaultValue={currentName}
          className="w-full rounded border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none"
          required
        />
        {enforceUniqueness && (
          <p className="text-xs text-gray-400 mt-1">Display names must be unique.</p>
        )}
      </div>
      {state.error && (
        <div className="p-2 mb-3 rounded bg-red-50 border border-red-200 text-red-700 text-sm">
          {state.error}
        </div>
      )}
      {state.success && (
        <div className="p-2 mb-3 rounded bg-green-50 border border-green-200 text-green-700 text-sm">
          {state.success}
        </div>
      )}
      <button
        type="submit"
        disabled={pending}
        className="px-4 py-2 bg-blue-600 text-white text-sm rounded hover:bg-blue-700 disabled:opacity-50"
        data-testid="save-display-name"
      >
        {pending ? 'Saving…' : 'Save'}
      </button>
    </form>
  );
}
