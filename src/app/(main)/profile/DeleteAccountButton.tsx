'use client';

import { useState } from 'react';
import { deleteOwnAccount } from '@/lib/actions/profile';

export function DeleteAccountButton() {
  const [showConfirm, setShowConfirm] = useState(false);
  const [pending, setPending] = useState(false);

  async function handleDelete() {
    setPending(true);
    await deleteOwnAccount();
    setPending(false);
  }

  if (!showConfirm) {
    return (
      <div>
        <p className="text-sm text-gray-500 mb-3">
          Permanently delete your account. This action cannot be undone.
        </p>
        <button
          type="button"
          onClick={() => setShowConfirm(true)}
          className="px-4 py-2 bg-red-600 text-white text-sm rounded hover:bg-red-700"
          data-testid="delete-account-btn"
        >
          Delete my account
        </button>
      </div>
    );
  }

  return (
    <div className="p-4 rounded bg-red-50 border border-red-200">
      <p className="text-sm text-red-800 font-medium mb-3">
        This action is irreversible. Your account will be anonymized.
      </p>
      <p className="text-sm text-red-700 mb-4">
        Your tickets and posts will be preserved but your identity will be removed.
      </p>
      <div className="flex gap-2">
        <button
          type="button"
          onClick={handleDelete}
          disabled={pending}
          className="px-4 py-2 bg-red-600 text-white text-sm rounded hover:bg-red-700 disabled:opacity-50"
          data-testid="confirm-delete-account"
        >
          {pending ? 'Deleting…' : 'Yes, delete my account'}
        </button>
        <button
          type="button"
          onClick={() => setShowConfirm(false)}
          className="px-4 py-2 bg-gray-200 text-gray-700 text-sm rounded hover:bg-gray-300"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
