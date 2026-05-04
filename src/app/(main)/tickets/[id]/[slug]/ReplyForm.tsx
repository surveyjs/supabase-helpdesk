'use client';

import { replyToTicket } from '@/lib/actions/tickets';
import {
  MarkdownActionForm,
  type EditorViewMode,
} from './MarkdownActionForm';

export function ReplyForm({
  ticketId,
  isAgent = false,
  editorViewMode = 'both',
  submitLabel = 'Add a reply',
  onCancel,
}: {
  ticketId: number;
  isAgent?: boolean;
  editorViewMode?: EditorViewMode;
  submitLabel?: string;
  onCancel?: () => void;
}) {
  return (
    <MarkdownActionForm
      action={replyToTicket}
      hiddenFields={<input type="hidden" name="ticket_id" value={ticketId} />}
      placeholder="Write your reply… (Markdown supported)"
      editorViewMode={editorViewMode}
      extraToolbarPlugins={isAgent ? ['canned-response'] : undefined}
      submitLabel={submitLabel}
      pendingLabel="Sending…"
      onCancel={onCancel}
      cancelTestId="cancel-reply-btn"
      formClassName="space-y-4"
      errorClassName="p-3 rounded bg-red-50 border border-red-200 text-red-700 text-sm"
    />
  );
}
