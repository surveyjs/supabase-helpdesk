'use client';

import { useState, useActionState } from 'react';
import { editPost, type TicketActionState } from '@/lib/actions/tickets';
import { MarkdownEditor } from '@/components/features/tickets/MarkdownEditor';

const initialState: TicketActionState = {};

export function EditablePost({
  postId,
  htmlBody,
  rawBody,
  canEdit,
  editorViewMode = 'both',
}: {
  postId: string;
  htmlBody: string;
  rawBody: string;
  canEdit: boolean;
  editorViewMode?: 'both' | 'preview' | 'editor';
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
        <MarkdownEditor
          name="body"
          defaultValue={rawBody}
          required
          maxLength={50000}
          viewMode={editorViewMode}
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
