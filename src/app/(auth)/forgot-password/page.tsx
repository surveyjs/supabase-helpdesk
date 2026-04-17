'use client';

import { useActionState } from 'react';
import { forgotPassword, type AuthState } from '@/lib/actions/auth';

const initialState: AuthState = {};

export default function ForgotPasswordPage() {
  const [state, formAction, pending] = useActionState(forgotPassword, initialState);

  return (
    <>
      <h1 className="text-2xl font-semibold text-gray-900 mb-6">Forgot password</h1>
      {state.error && (
        <div role="alert" className="mb-4 p-3 rounded bg-red-50 border border-red-200 text-red-700 text-sm">
          {state.error}
        </div>
      )}
      {state.message && (
        <div role="status" className="mb-4 p-3 rounded bg-green-50 border border-green-200 text-green-700 text-sm">
          {state.message}
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
        <button
          type="submit"
          disabled={pending}
          className="w-full bg-blue-600 text-white rounded py-2 px-4 text-sm font-medium hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:opacity-50"
        >
          {pending ? 'Sending…' : 'Send reset link'}
        </button>
      </form>
      <p className="mt-4 text-sm text-center text-gray-600">
        <a href="/login" className="text-blue-600 hover:text-blue-800 underline underline">Back to log in</a>
      </p>
    </>
  );
}
