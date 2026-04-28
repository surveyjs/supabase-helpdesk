'use client';

import { CommentForm } from './CommentForm';
import { ComposerToggle } from './ComposerToggle';

export function ReplyToggle({
  parentPostId,
  parentCommentId,
  editorViewMode = 'both',
}: {
  parentPostId: string;
  parentCommentId?: string;
  editorViewMode?: 'both' | 'preview' | 'editor';
}) {
  return (
    <ComposerToggle
      triggerLabel="Add a comment"
      triggerTestId="add-comment-btn"
      triggerClassName="px-3 py-1 text-xs rounded bg-blue-600 text-white hover:bg-blue-700"
    >
      {({ close }) => (
        <CommentForm
          parentPostId={parentPostId}
          parentCommentId={parentCommentId}
          editorViewMode={editorViewMode}
          submitLabel="Add a comment"
          onCancel={close}
        />
      )}
    </ComposerToggle>
  );
}
