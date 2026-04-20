'use client';

import { useActionState } from 'react';
import { addNote, type TicketActionState } from '@/lib/actions/tickets';
import { MarkdownEditor } from '@/components/features/tickets/MarkdownEditor';

const initialState: TicketActionState = {};

export function NoteForm({ ticketId }: { ticketId: number }) {
  const [state, formAction, pending] = useActionState(addNote, initialState);

  return (
    <div className="bg-amber-50 rounded-lg border border-amber-200 p-4">
      <h3 className="text-sm font-semibold text-amber-800 mb-2">Add Internal Note</h3>
      <form action={formAction} className="space-y-2">
        <input type="hidden" name="ticket_id" value={ticketId} />
        {state.error && (
          <div className="p-2 rounded bg-red-50 border border-red-200 text-red-700 text-xs">
            {state.error}
          </div>
        )}
        <MarkdownEditor
          name="body"
          required
          maxLength={50000}
          placeholder="Write an internal note… (only visible to agents)"
          compact
        />
        <button
          type="submit"
          disabled={pending}
          className="px-3 py-1 text-xs rounded bg-amber-600 text-white hover:bg-amber-700 disabled:opacity-50"
        >
          {pending ? 'Adding…' : 'Add Note'}
        </button>
      </form>
    </div>
  );
}
