'use client';

import { useActionState } from 'react';
import { changePassword, type ProfileActionState } from '@/lib/actions/profile';

const initialState: ProfileActionState = {};

export function ChangePasswordForm() {
  const [state, formAction, pending] = useActionState(changePassword, initialState);

  return (
    <form action={formAction}>
      <div className="space-y-3 mb-3">
        <div>
          <label htmlFor="current_password" className="block text-sm font-medium text-gray-700 mb-1">
            Current Password
          </label>
          <input
            id="current_password"
            name="current_password"
            type="password"
            className="w-full rounded border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none"
            required
          />
        </div>
        <div>
          <label htmlFor="new_password" className="block text-sm font-medium text-gray-700 mb-1">
            New Password
          </label>
          <input
            id="new_password"
            name="new_password"
            type="password"
            minLength={8}
            className="w-full rounded border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none"
            required
          />
          <p className="text-xs text-gray-400 mt-1">
            At least 8 characters, with uppercase, lowercase, and a digit.
          </p>
        </div>
        <div>
          <label htmlFor="confirm_password" className="block text-sm font-medium text-gray-700 mb-1">
            Confirm New Password
          </label>
          <input
            id="confirm_password"
            name="confirm_password"
            type="password"
            minLength={8}
            className="w-full rounded border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none"
            required
          />
        </div>
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
        data-testid="change-password-btn"
      >
        {pending ? 'Changing…' : 'Change Password'}
      </button>
    </form>
  );
}
