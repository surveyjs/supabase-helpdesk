'use client';

import { useActionState, useState } from 'react';
import { replyToTicket, type TicketActionState } from '@/lib/actions/tickets';
import { MarkdownEditor } from '@/components/features/tickets/MarkdownEditor';

const initialState: TicketActionState = {};

export function ReplyForm({
  ticketId,
  isAgent = false,
  editorViewMode = 'both',
}: {
  ticketId: number;
  isAgent?: boolean;
  editorViewMode?: 'both' | 'preview' | 'editor';
}) {
  const [state, formAction, pending] = useActionState(replyToTicket, initialState);
  const [body, setBody] = useState('');

  return (
    <form action={formAction} className="space-y-4">
      <input type="hidden" name="ticket_id" value={ticketId} />
      {state.error && (
        <div
          role="alert"
          className="p-3 rounded bg-red-50 border border-red-200 text-red-700 text-sm"
        >
          {state.error}
        </div>
      )}
      <MarkdownEditor
        name="body"
        required
        maxLength={50000}
        placeholder="Write your reply… (Markdown supported)"
        defaultValue={body}
        onValueChange={setBody}
        viewMode={editorViewMode}
        extraToolbarPlugins={isAgent ? ['canned-response'] : undefined}
      />
      <button
        type="submit"
        disabled={pending}
        className="bg-blue-600 text-white rounded px-4 py-2 text-sm font-medium hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:opacity-50"
      >
        {pending ? 'Sending…' : 'Reply'}
      </button>
    </form>
  );
}
