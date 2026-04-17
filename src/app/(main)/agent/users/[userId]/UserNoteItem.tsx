'use client';

import { useState, useActionState } from 'react';
import { updateUserNote, deleteUserNote, type ProfileActionState } from '@/lib/actions/profile';

const initialState: ProfileActionState = {};

export function UserNoteItem({
  noteId,
  targetUserId,
  htmlBody,
  rawBody,
  authorName,
  authorId,
  currentUserId,
  isAdmin,
  createdAt,
  editedAt,
}: {
  noteId: string;
  targetUserId: string;
  htmlBody: string;
  rawBody: string;
  authorName: string;
  authorId: string;
  currentUserId: string;
  isAdmin: boolean;
  createdAt: string;
  editedAt: string | null;
}) {
  const [editRequested, setEditRequested] = useState(false);
  const [editState, editAction, editPending] = useActionState(updateUserNote, initialState);
  const isOwnNote = authorId === currentUserId;
  const canEdit = isOwnNote;
  const canDelete = isOwnNote || isAdmin;

  // Derive editing state: requested by user, but auto-close on success
  const editing = editRequested && !editState.success;

  function formatTime(dateStr: string) {
    return new Date(dateStr).toLocaleDateString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  }

  return (
    <div className="border border-gray-200 rounded-lg p-4" data-testid={`user-note-${noteId}`}>
      <div className="flex items-center justify-between mb-2">
        <div className="text-sm">
          <span className="font-medium text-gray-900">{authorName}</span>
          <span className="text-gray-500 ml-2">{formatTime(createdAt)}</span>
          {editedAt && (
            <span className="text-gray-500 ml-2 text-xs">(edited)</span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {canEdit && !editing && (
            <button
              type="button"
              onClick={() => setEditRequested(true)}
              className="text-xs text-blue-600 hover:text-blue-800"
              data-testid="edit-note-btn"
            >
              Edit
            </button>
          )}
          {canDelete && (
            <form action={deleteUserNote} className="inline">
              <input type="hidden" name="note_id" value={noteId} />
              <input type="hidden" name="target_user_id" value={targetUserId} />
              <button
                type="submit"
                className="text-xs text-red-600 hover:text-red-800"
                data-testid="delete-note-btn"
              >
                Delete
              </button>
            </form>
          )}
        </div>
      </div>

      {editing ? (
        <form action={editAction}>
          <input type="hidden" name="note_id" value={noteId} />
          <input type="hidden" name="target_user_id" value={targetUserId} />
          <textarea
            name="body"
            defaultValue={rawBody}
            maxLength={10000}
            rows={4}
            className="w-full rounded border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none"
            required
          />
          {editState.error && (
            <div className="p-2 mt-2 rounded bg-red-50 border border-red-200 text-red-700 text-sm">
              {editState.error}
            </div>
          )}
          <div className="flex gap-2 mt-2">
            <button
              type="submit"
              disabled={editPending}
              className="px-3 py-1 bg-blue-600 text-white text-xs rounded hover:bg-blue-700 disabled:opacity-50"
            >
              {editPending ? 'Saving…' : 'Save'}
            </button>
            <button
              type="button"
              onClick={() => setEditRequested(false)}
              className="px-3 py-1 bg-gray-200 text-gray-700 text-xs rounded hover:bg-gray-300"
            >
              Cancel
            </button>
          </div>
        </form>
      ) : (
        <div
          className="prose prose-sm max-w-none text-gray-700"
          dangerouslySetInnerHTML={{ __html: htmlBody }}
        />
      )}
    </div>
  );
}
