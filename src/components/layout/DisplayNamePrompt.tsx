'use client';

import { useActionState, useEffect, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { DISPLAY_NAME_DISMISS_COOKIE } from '@/lib/users/display-name';
import { updateDisplayName, type ProfileActionState } from '@/lib/actions/profile';

const THIRTY_DAYS = 60 * 60 * 24 * 30;
const initialState: ProfileActionState = {};

/** Amber callout asking users with a fallback display name to set a real one. */
export function DisplayNamePrompt({ currentName }: { currentName: string }) {
  const pathname = usePathname();
  const router = useRouter();
  const [state, formAction, pending] = useActionState(updateDisplayName, initialState);
  const [dismissed, setDismissed] = useState(false);
  const saved = Boolean(state.success);

  useEffect(() => {
    if (saved) router.refresh();
  }, [saved, router]);

  if (dismissed || saved || pathname === '/profile') return null;

  function notNow() {
    document.cookie = `${DISPLAY_NAME_DISMISS_COOKIE}=1; path=/; max-age=${THIRTY_DAYS}; samesite=lax`;
    setDismissed(true);
  }

  return (
    <div
      className="bg-amber-50 border-b border-amber-200 px-4 py-3"
      data-testid="display-name-prompt"
    >
      <form action={formAction} className="max-w-5xl mx-auto flex flex-wrap items-end gap-x-3 gap-y-2">
        <p className="w-full text-sm text-amber-900">
          Add your name so others know who they&apos;re talking to.
        </p>
        <div className="flex-1 min-w-0 basis-48">
          <label htmlFor="dn-prompt-name" className="block text-xs font-medium text-amber-900 mb-1">
            Your name
          </label>
          <input
            id="dn-prompt-name"
            name="display_name"
            type="text"
            maxLength={100}
            required
            placeholder={currentName}
            className="block w-full form-input"
          />
        </div>
        <button
          type="submit"
          disabled={pending}
          className="h-[36px] px-4 rounded bg-blue-600 text-white text-sm font-medium hover:bg-blue-700 disabled:opacity-50 focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 focus-visible:outline-none"
        >
          {pending ? 'Saving…' : 'Save'}
        </button>
        <button
          type="button"
          onClick={notNow}
          className="h-[36px] px-3 rounded text-sm text-amber-900 hover:bg-amber-100 focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:outline-none"
        >
          Not now
        </button>
        {state.error && (
          <p role="alert" className="w-full text-sm text-red-700">
            {state.error}
          </p>
        )}
      </form>
    </div>
  );
}
