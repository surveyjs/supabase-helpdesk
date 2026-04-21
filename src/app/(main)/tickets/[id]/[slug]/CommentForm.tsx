'use client';

import { useActionState } from 'react';
import { addComment, type TicketActionState } from '@/lib/actions/tickets';
import { MarkdownEditor } from '@/components/features/tickets/MarkdownEditor';

const initialState: TicketActionState = {};

export function CommentForm({
  parentPostId,
  parentCommentId,
  editorViewMode = 'both',
}: {
  parentPostId: string;
  parentCommentId?: string;
  editorViewMode?: 'both' | 'preview' | 'editor';
}) {
  const [state, formAction, pending] = useActionState(addComment, initialState);

  return (
    <form action={formAction} className="mt-2 space-y-2">
      <input type="hidden" name="parent_post_id" value={parentPostId} />
      {parentCommentId && (
        <input type="hidden" name="parent_comment_id" value={parentCommentId} />
      )}
      {state.error && (
        <div className="p-2 rounded bg-red-50 border border-red-200 text-red-700 text-xs">
          {state.error}
        </div>
      )}
      <MarkdownEditor
        name="body"
        required
        maxLength={50000}
        placeholder="Write a comment… (Markdown supported)"
        compact
        viewMode={editorViewMode}
      />
      <button
        type="submit"
        disabled={pending}
        className="px-3 py-1 text-xs rounded bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50"
      >
        {pending ? 'Posting…' : 'Comment'}
      </button>
    </form>
  );
}
