'use client';

import { ReplyForm } from './ReplyForm';
import { SuggestReplyButton } from './SuggestReplyButton';
import { ComposerToggle } from './ComposerToggle';

export function MainReplyToggle({
  ticketId,
  isAgent,
  editorViewMode = 'both',
  aiSuggestedReplyEnabled = false,
}: {
  ticketId: number;
  isAgent: boolean;
  editorViewMode?: 'both' | 'preview' | 'editor';
  aiSuggestedReplyEnabled?: boolean;
}) {
  return (
    <ComposerToggle
      triggerLabel="Add a reply"
      triggerTestId="main-reply-btn"
      panelTestId="main-reply-panel"
      triggerClassName="px-3 py-1 text-xs rounded bg-blue-600 text-white hover:bg-blue-700"
      panelClassName="bg-white rounded-lg border border-gray-200 p-6"
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
            submitLabel="Add a reply"
            onCancel={close}
          />
        </>
      )}
    </ComposerToggle>
  );
}
