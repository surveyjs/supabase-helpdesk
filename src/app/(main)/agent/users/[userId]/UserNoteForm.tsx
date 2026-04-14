'use client';

import { useActionState } from 'react';
import { createUserNote, type ProfileActionState } from '@/lib/actions/profile';
import { MarkdownPreview } from '@/components/features/tickets/MarkdownPreview';

const initialState: ProfileActionState = {};

export function UserNoteForm({ targetUserId }: { targetUserId: string }) {
  const [state, formAction, pending] = useActionState(createUserNote, initialState);

  return (
    <form action={formAction} data-testid="add-note-form">
      <input type="hidden" name="target_user_id" value={targetUserId} />
      <MarkdownPreview
        name="body"
        placeholder="Add a note about this user…"
        maxLength={10000}
        rows={3}
        required
      />
      {state.error && (
        <div className="p-2 mt-2 rounded bg-red-50 border border-red-200 text-red-700 text-sm">
          {state.error}
        </div>
      )}
      {state.success && (
        <div className="p-2 mt-2 rounded bg-green-50 border border-green-200 text-green-700 text-sm">
          {state.success}
        </div>
      )}
      <button
        type="submit"
        disabled={pending}
        className="mt-2 px-4 py-2 bg-blue-600 text-white text-sm rounded hover:bg-blue-700 disabled:opacity-50"
        data-testid="submit-note-btn"
      >
        {pending ? 'Adding…' : 'Add Note'}
      </button>
    </form>
  );
}
