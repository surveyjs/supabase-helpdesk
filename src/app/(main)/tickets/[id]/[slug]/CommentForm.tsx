'use client';

import { useActionState } from 'react';
import { addComment, type TicketActionState } from '@/lib/actions/tickets';

const initialState: TicketActionState = {};

export function CommentForm({
  parentPostId,
  parentCommentId,
}: {
  parentPostId: string;
  parentCommentId?: string;
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
      <textarea
        name="body"
        required
        rows={2}
        maxLength={50000}
        placeholder="Write a comment… (Markdown supported)"
        className="block w-full rounded border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none resize-y"
        aria-label="Comment body"
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
