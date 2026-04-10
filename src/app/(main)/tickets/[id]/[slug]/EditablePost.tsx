'use client';

import { useState, useActionState } from 'react';
import { editPost, type TicketActionState } from '@/lib/actions/tickets';

const initialState: TicketActionState = {};

export function EditablePost({
  postId,
  htmlBody,
  rawBody,
  canEdit,
}: {
  postId: string;
  htmlBody: string;
  rawBody: string;
  canEdit: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [state, formAction, pending] = useActionState(editPost, initialState);

  if (!canEdit) {
    return (
      <div
        className="prose prose-sm max-w-none"
        dangerouslySetInnerHTML={{ __html: htmlBody }}
      />
    );
  }

  if (editing) {
    return (
      <form action={formAction} className="space-y-2">
        <input type="hidden" name="post_id" value={postId} />
        {state.error && (
          <div className="p-2 rounded bg-red-50 border border-red-200 text-red-700 text-xs">
            {state.error}
          </div>
        )}
        <textarea
          name="body"
          defaultValue={rawBody}
          required
          rows={4}
          maxLength={50000}
          className="block w-full rounded border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none resize-y"
        />
        <div className="flex gap-2">
          <button
            type="submit"
            disabled={pending}
            className="px-3 py-1 text-xs rounded bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {pending ? 'Saving…' : 'Save'}
          </button>
          <button
            type="button"
            onClick={() => setEditing(false)}
            className="px-3 py-1 text-xs rounded bg-gray-100 text-gray-700 hover:bg-gray-200"
          >
            Cancel
          </button>
        </div>
      </form>
    );
  }

  return (
    <div>
      <div
        className="prose prose-sm max-w-none"
        dangerouslySetInnerHTML={{ __html: htmlBody }}
      />
      <button
        type="button"
        onClick={() => setEditing(true)}
        className="mt-2 text-xs text-blue-600 hover:text-blue-800"
        data-testid="edit-post-btn"
      >
        Edit
      </button>
    </div>
  );
}
