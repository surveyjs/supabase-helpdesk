'use client';

import { ReplyForm } from './ReplyForm';
import { SuggestReplyButton } from './SuggestReplyButton';
import { ComposerToggle } from './ComposerToggle';

export function MainReplyToggle({
  ticketId,
  isAgent,
  editorViewMode = 'both',
  editorMinHeightPx,
  editorMaxHeightPx,
  aiSuggestedReplyEnabled = false,
}: {
  ticketId: number;
  isAgent: boolean;
  editorViewMode?: 'both' | 'preview' | 'editor';
  editorMinHeightPx?: number;
  editorMaxHeightPx?: number;
  aiSuggestedReplyEnabled?: boolean;
}) {
  return (
    <ComposerToggle
      panelTestId="main-reply-panel"
      panelClassName="bg-white rounded-lg border border-gray-200 p-6"
      trigger={({ open }) => (
        <button
          type="button"
          onClick={open}
          data-testid="main-reply-btn"
          className="w-full text-left flex items-center gap-3 px-3 py-2.5 rounded-lg border border-gray-300 bg-white text-sm text-gray-500 hover:border-blue-500 hover:text-gray-700"
        >
          <span
            aria-hidden="true"
            className="shrink-0 w-7 h-7 rounded-full bg-teal-100 text-teal-700 flex items-center justify-center text-xs font-semibold"
          >
            ↩
          </span>
          <span>Reply to this ticket…</span>
          <span className="ml-auto text-xs text-gray-400">Markdown supported</span>
        </button>
      )}
    >
      {({ close }) => (
        <>
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-medium text-gray-900">Add a reply</h2>
            {aiSuggestedReplyEnabled && <SuggestReplyButton ticketId={ticketId} />}
          </div>
          <ReplyForm
            ticketId={ticketId}
            isAgent={isAgent}
            editorViewMode={editorViewMode}
            editorMinHeightPx={editorMinHeightPx}
            editorMaxHeightPx={editorMaxHeightPx}
            submitLabel="Add a reply"
            onCancel={close}
          />
        </>
      )}
    </ComposerToggle>
  );
}
