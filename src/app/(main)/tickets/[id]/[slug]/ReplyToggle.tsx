'use client';

import { CommentForm } from './CommentForm';
import { ComposerToggle } from './ComposerToggle';

export function ReplyToggle({
  parentPostId,
  editorViewMode = 'both',
  editorMinHeightPx,
  editorMaxHeightPx,
  commentCount,
}: {
  parentPostId: string;
  editorViewMode?: 'both' | 'preview' | 'editor';
  editorMinHeightPx?: number;
  editorMaxHeightPx?: number;
  commentCount?: number;
}) {
  return (
    <ComposerToggle
      panelClassName="w-full"
      trigger={({ open }) => (
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={open}
            data-testid="add-comment-btn"
            className="inline-flex items-center gap-1 px-2 py-1 rounded text-xs font-medium text-gray-600 hover:bg-gray-50 hover:text-blue-700"
          >
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
              <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
            </svg>
            Add comment
          </button>
          {commentCount !== undefined && commentCount > 0 && (
            <span className="text-[11px] text-gray-500">
              · {commentCount} {commentCount === 1 ? 'comment' : 'comments'}
            </span>
          )}
        </div>
      )}
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
