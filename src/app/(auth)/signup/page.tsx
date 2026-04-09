'use client';

import { useActionState } from 'react';
import { signup, type AuthState } from '@/lib/actions/auth';

const initialState: AuthState = {};

export default function SignupPage() {
  const [state, formAction, pending] = useActionState(signup, initialState);

  if (state.message) {
    return (
      <>
        <h1 className="text-2xl font-semibold text-gray-900 mb-4">Check your email</h1>
        <p className="text-gray-600 text-sm">{state.message}</p>
        <div className="mt-6">
          <a href="/login" className="text-sm text-blue-600 hover:text-blue-800">
            Back to log in
          </a>
        </div>
      </>
    );
  }

  return (
    <>
      <h1 className="text-2xl font-semibold text-gray-900 mb-6">Sign up</h1>
      {state.error && (
        <div role="alert" className="mb-4 p-3 rounded bg-red-50 border border-red-200 text-red-700 text-sm">
          {state.error}
        </div>
      )}
      <form action={formAction} className="space-y-4">
        <div>
          <label htmlFor="displayName" className="block text-sm font-medium text-gray-700 mb-1">
            Display name
          </label>
          <input
            id="displayName"
            name="displayName"
            type="text"
            maxLength={100}
            autoComplete="name"
            className="block w-full rounded border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none"
          />
        </div>
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
            minLength={8}
            autoComplete="new-password"
            className="block w-full rounded border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none"
          />
          <p className="mt-1 text-xs text-gray-500">
            At least 8 characters, 1 uppercase, 1 lowercase, and 1 digit.
          </p>
        </div>
        <div>
          <label htmlFor="confirmPassword" className="block text-sm font-medium text-gray-700 mb-1">
            Confirm password
          </label>
          <input
            id="confirmPassword"
            name="confirmPassword"
            type="password"
            required
            minLength={8}
            autoComplete="new-password"
            className="block w-full rounded border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none"
          />
        </div>
        <button
          type="submit"
          disabled={pending}
          className="w-full bg-blue-600 text-white rounded py-2 px-4 text-sm font-medium hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:opacity-50"
        >
          {pending ? 'Creating account…' : 'Sign up'}
        </button>
      </form>
      <p className="mt-4 text-sm text-center text-gray-600">
        Already have an account?{' '}
        <a href="/login" className="text-blue-600 hover:text-blue-800">Log in</a>
      </p>
    </>
  );
}
