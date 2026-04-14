'use client';

import { useState } from 'react';
import { blockUser, unblockUser, adminDeleteUser } from '@/lib/actions/admin';

export function AdminUserActions({
  userId,
  isBlocked,
  role,
}: {
  userId: string;
  isBlocked: boolean;
  role: string;
}) {
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const isAgentOrAdmin = role === 'agent' || role === 'admin';

  return (
    <div className="flex flex-wrap gap-3">
      {/* Block / Unblock */}
      <form action={isBlocked ? unblockUser : blockUser}>
        <input type="hidden" name="user_id" value={userId} />
        <button
          type="submit"
          className={`px-3 py-1.5 text-sm rounded ${
            isBlocked
              ? 'bg-green-100 text-green-700 hover:bg-green-200'
              : 'bg-yellow-100 text-yellow-700 hover:bg-yellow-200'
          }`}
          data-testid={isBlocked ? 'unblock-user-btn' : 'block-user-btn'}
        >
          {isBlocked ? 'Unblock User' : 'Block User'}
        </button>
      </form>

      {/* Delete account */}
      {!showDeleteConfirm ? (
        <button
          type="button"
          onClick={() => setShowDeleteConfirm(true)}
          disabled={isAgentOrAdmin}
          className="px-3 py-1.5 text-sm rounded bg-red-100 text-red-700 hover:bg-red-200 disabled:opacity-50 disabled:cursor-not-allowed"
          title={isAgentOrAdmin ? 'Demote to user before deleting' : 'Delete user account'}
          data-testid="admin-delete-user-btn"
        >
          Delete Account
        </button>
      ) : (
        <div className="flex items-center gap-2">
          <span className="text-sm text-red-700 font-medium">Are you sure?</span>
          <form action={adminDeleteUser}>
            <input type="hidden" name="user_id" value={userId} />
            <button
              type="submit"
              className="px-3 py-1.5 text-sm rounded bg-red-600 text-white hover:bg-red-700"
              data-testid="confirm-admin-delete"
            >
              Yes, delete
            </button>
          </form>
          <button
            type="button"
            onClick={() => setShowDeleteConfirm(false)}
            className="px-3 py-1.5 text-sm rounded bg-gray-200 text-gray-700 hover:bg-gray-300"
          >
            Cancel
          </button>
        </div>
      )}
    </div>
  );
}
