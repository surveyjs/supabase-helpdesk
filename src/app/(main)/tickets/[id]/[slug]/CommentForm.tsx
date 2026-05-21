'use client';

import { addComment } from '@/lib/actions/tickets';
import {
  MarkdownActionForm,
  type EditorViewMode,
} from './MarkdownActionForm';

export function CommentForm({
  parentPostId,
  parentCommentId,
  editorViewMode = 'both',
  editorMinHeightPx,
  editorMaxHeightPx,
  submitLabel = 'Add a comment',
  onCancel,
}: {
  parentPostId: string;
  parentCommentId?: string;
  editorViewMode?: EditorViewMode;
  editorMinHeightPx?: number;
  editorMaxHeightPx?: number;
  submitLabel?: string;
  onCancel?: () => void;
}) {
  return (
    <MarkdownActionForm
      action={addComment}
      hiddenFields={
        <>
          <input type="hidden" name="parent_post_id" value={parentPostId} />
          {parentCommentId && (
            <input type="hidden" name="parent_comment_id" value={parentCommentId} />
          )}
        </>
      }
      placeholder="Write a comment… (Markdown supported)"
      editorViewMode={editorViewMode}
      editorMinHeightPx={editorMinHeightPx}
      editorMaxHeightPx={editorMaxHeightPx}
      submitLabel={submitLabel}
      pendingLabel="Posting…"
      onCancel={onCancel}
      formClassName="mt-2 space-y-2"
    />
  );
}
