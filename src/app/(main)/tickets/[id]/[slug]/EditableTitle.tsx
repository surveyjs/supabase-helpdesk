'use client';

import { useState, useActionState } from 'react';
import { editTicketTitle, type TicketActionState } from '@/lib/actions/tickets';

const initialState: TicketActionState = {};

export function EditableTitle({
  ticketId,
  title,
  canEdit,
}: {
  ticketId: number;
  title: string;
  canEdit: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [state, formAction, pending] = useActionState(editTicketTitle, initialState);

  if (!canEdit || !editing) {
    return (
      <div className="flex items-center gap-2">
        <h1 className="text-xl font-semibold text-gray-900">{title}</h1>
        {canEdit && (
          <button
            type="button"
            onClick={() => setEditing(true)}
            className="text-xs text-blue-600 hover:text-blue-800"
            data-testid="edit-title-btn"
            aria-label="Edit title"
          >
            ✎
          </button>
        )}
      </div>
    );
  }

  return (
    <form action={formAction} className="space-y-2">
      <input type="hidden" name="ticket_id" value={ticketId} />
      {state.error && (
        <div className="p-2 rounded bg-red-50 border border-red-200 text-red-700 text-xs">
          {state.error}
        </div>
      )}
      <input
        type="text"
        name="title"
        defaultValue={title}
        required
        maxLength={300}
        className="block w-full rounded border border-gray-300 px-3 py-2 text-lg font-semibold focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none"
        autoFocus
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
