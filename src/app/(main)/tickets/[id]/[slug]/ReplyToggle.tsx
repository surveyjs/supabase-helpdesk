'use client';

import { CommentForm } from './CommentForm';
import { ComposerToggle } from './ComposerToggle';

export function ReplyToggle({
  parentPostId,
  editorViewMode = 'both',
  editorMinHeightPx,
  editorMaxHeightPx,
}: {
  parentPostId: string;
  editorViewMode?: 'both' | 'preview' | 'editor';
  editorMinHeightPx?: number;
  editorMaxHeightPx?: number;
}) {
  return (
    <ComposerToggle
      triggerLabel="Reply"
      triggerTestId="add-comment-btn"
      triggerClassName="inline-flex items-center gap-1 px-2 py-1 rounded text-xs font-medium text-gray-600 hover:bg-gray-50 hover:text-blue-700"
      triggerIcon={
        <svg
          aria-hidden="true"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="h-3.5 w-3.5"
        >
          <path d="M9 17l-5-5 5-5" />
          <path d="M20 18v-2a4 4 0 0 0-4-4H4" />
        </svg>
      }
    >
      {({ close }) => (
        <CommentForm
          parentPostId={parentPostId}
          editorViewMode={editorViewMode}
          editorMinHeightPx={editorMinHeightPx}
          editorMaxHeightPx={editorMaxHeightPx}
          submitLabel="Add a comment"
          onCancel={close}
        />
      )}
    </ComposerToggle>
  );
}
