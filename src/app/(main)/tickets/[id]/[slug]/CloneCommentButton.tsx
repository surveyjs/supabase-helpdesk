'use client';

import { useState, useTransition } from 'react';
import { cloneCommentToTicket } from '@/lib/actions/clone';

export function CloneCommentButton({
  postId,
  defaultTitle,
}: {
  postId: string;
  defaultTitle: string;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [isPending, startTransition] = useTransition();

  return (
    <span className="inline-block">
      <button
        type="button"
        onClick={() => setIsOpen((v) => !v)}
        className="text-xs text-blue-600 hover:text-blue-800"
        data-testid="clone-comment-btn"
      >
        Clone to new ticket
      </button>

      {isOpen && (
        <form
          action={(formData) => {
            startTransition(async () => {
              await cloneCommentToTicket(formData);
              setIsOpen(false);
            });
          }}
          className="mt-2 flex items-center gap-2"
          data-testid="clone-comment-form"
        >
          <input type="hidden" name="post_id" value={postId} />
          <input
            type="text"
            name="title"
            defaultValue={defaultTitle}
            placeholder="New ticket title"
            maxLength={300}
            className="w-56 rounded border border-gray-300 px-2 py-1 text-xs focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none"
            data-testid="clone-comment-title-input"
          />
          <button
            type="submit"
            disabled={isPending}
            className="px-3 py-1 text-xs rounded bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50"
            data-testid="clone-comment-confirm-btn"
          >
            {isPending ? 'Cloning…' : 'Confirm'}
          </button>
          <button
            type="button"
            onClick={() => setIsOpen(false)}
            className="px-3 py-1 text-xs text-gray-500 hover:text-gray-700"
          >
            Cancel
          </button>
        </form>
      )}
    </span>
  );
}
