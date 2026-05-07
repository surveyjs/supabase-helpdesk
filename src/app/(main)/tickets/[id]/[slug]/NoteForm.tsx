'use client';

import { addNote } from '@/lib/actions/tickets';
import {
  MarkdownActionForm,
  type EditorViewMode,
} from './MarkdownActionForm';

export function NoteForm({
  ticketId,
  editorViewMode = 'both',
  editorMinHeightPx,
  editorMaxHeightPx,
}: {
  ticketId: number;
  editorViewMode?: EditorViewMode;
  editorMinHeightPx?: number;
  editorMaxHeightPx?: number;
}) {
  return (
    <div className="bg-amber-50 rounded-lg border border-amber-200 p-4">
      <h3 className="text-sm font-semibold text-amber-800 mb-2">Add Internal Note</h3>
      <MarkdownActionForm
        action={addNote}
        hiddenFields={<input type="hidden" name="ticket_id" value={ticketId} />}
        placeholder="Write an internal note… (only visible to agents)"
        compact
        editorViewMode={editorViewMode}
        editorMinHeightPx={editorMinHeightPx}
        editorMaxHeightPx={editorMaxHeightPx}
        submitLabel="Add Note"
        pendingLabel="Adding…"
        variant="amber"
      />
    </div>
  );
}
