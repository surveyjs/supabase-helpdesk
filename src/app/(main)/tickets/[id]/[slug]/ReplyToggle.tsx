'use client';

import { useState } from 'react';
import { CommentForm } from './CommentForm';

export function ReplyToggle({
  parentPostId,
  parentCommentId,
}: {
  parentPostId: string;
  parentCommentId?: string;
}) {
  const [open, setOpen] = useState(false);

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="text-xs text-blue-600 hover:text-blue-800"
        data-testid="reply-btn"
      >
        Reply
      </button>
    );
  }

  return (
    <div>
      <CommentForm parentPostId={parentPostId} parentCommentId={parentCommentId} />
      <button
        type="button"
        onClick={() => setOpen(false)}
        className="mt-1 text-xs text-gray-500 hover:text-gray-700"
      >
        Cancel
      </button>
    </div>
  );
}
