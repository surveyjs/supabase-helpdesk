'use client';

import { useActionState, useState } from 'react';
import { replyToTicket, type TicketActionState } from '@/lib/actions/tickets';
import { MarkdownEditor } from '@/components/features/tickets/MarkdownEditor';
import { uploadInlineImageFromEditor } from '@/components/features/tickets/inlineImageUpload';

const initialState: TicketActionState = {};

export function ReplyForm({
  ticketId,
  isAgent = false,
  editorViewMode = 'both',
  submitLabel = 'Add a reply',
  onCancel,
}: {
  ticketId: number;
  isAgent?: boolean;
  editorViewMode?: 'both' | 'preview' | 'editor';
  submitLabel?: string;
  onCancel?: () => void;
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
        onImageUpload={uploadInlineImageFromEditor}
        extraToolbarPlugins={isAgent ? ['canned-response'] : undefined}
      />
      <div className="flex gap-2">
        <button
          type="submit"
          disabled={pending}
          className="px-3 py-1 text-xs rounded bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50"
        >
          {pending ? 'Sending…' : submitLabel}
        </button>
        {onCancel && (
          <button
            type="button"
            onClick={onCancel}
            className="px-3 py-1 text-xs rounded bg-gray-100 text-gray-700 hover:bg-gray-200"
            data-testid="cancel-reply-btn"
          >
            Cancel
          </button>
        )}
      </div>
    </form>
  );
}
