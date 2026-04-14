'use client';

import { useActionState, useRef } from 'react';
import { replyToTicket, type TicketActionState } from '@/lib/actions/tickets';
import { CannedResponsePicker } from '@/components/features/canned-responses/CannedResponsePicker';

const initialState: TicketActionState = {};

export function ReplyForm({
  ticketId,
  isAgent = false,
}: {
  ticketId: number;
  isAgent?: boolean;
}) {
  const [state, formAction, pending] = useActionState(replyToTicket, initialState);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  function handleInsertCanned(body: string) {
    const ta = textareaRef.current;
    if (!ta) return;
    const start = ta.selectionStart;
    const end = ta.selectionEnd;
    const current = ta.value;
    const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
      window.HTMLTextAreaElement.prototype, 'value',
    )?.set;
    if (nativeInputValueSetter) {
      nativeInputValueSetter.call(ta, current.slice(0, start) + body + current.slice(end));
      ta.dispatchEvent(new Event('input', { bubbles: true }));
    } else {
      ta.value = current.slice(0, start) + body + current.slice(end);
    }
    ta.focus();
    ta.selectionStart = ta.selectionEnd = start + body.length;
  }

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
      {isAgent && (
        <CannedResponsePicker onInsert={handleInsertCanned} />
      )}
      <textarea
        ref={textareaRef}
        name="body"
        required
        rows={4}
        maxLength={50000}
        placeholder="Write your reply… (Markdown supported)"
        className="block w-full rounded border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none resize-y"
        aria-label="Reply body"
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
