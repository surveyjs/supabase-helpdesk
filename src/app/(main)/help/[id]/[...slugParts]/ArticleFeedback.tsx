'use client';

import { submitArticleFeedback } from '@/lib/actions/kb';

export function ArticleFeedback({
  articleId,
  helpfulCount,
  notHelpfulCount,
  currentVote,
  isAuthenticated,
}: {
  articleId: number;
  helpfulCount: number;
  notHelpfulCount: number;
  currentVote: boolean | null;
  isAuthenticated: boolean;
}) {
  if (!isAuthenticated) {
    return (
      <div className="flex items-center gap-4">
        <span className="text-sm text-gray-500">
          👍 {helpfulCount} · 👎 {notHelpfulCount}
        </span>
        <span className="text-xs text-gray-400">Log in to vote</span>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-3">
      <form action={submitArticleFeedback}>
        <input type="hidden" name="article_id" value={articleId} />
        <input type="hidden" name="is_helpful" value="true" />
        <button
          type="submit"
          className={`px-3 py-1.5 text-sm rounded border ${
            currentVote === true
              ? 'bg-green-100 border-green-300 text-green-700'
              : 'bg-white border-gray-300 text-gray-600 hover:bg-gray-50'
          }`}
        >
          👍 {helpfulCount}
        </button>
      </form>
      <form action={submitArticleFeedback}>
        <input type="hidden" name="article_id" value={articleId} />
        <input type="hidden" name="is_helpful" value="false" />
        <button
          type="submit"
          className={`px-3 py-1.5 text-sm rounded border ${
            currentVote === false
              ? 'bg-red-100 border-red-300 text-red-700'
              : 'bg-white border-gray-300 text-gray-600 hover:bg-gray-50'
          }`}
        >
          👎 {notHelpfulCount}
        </button>
      </form>
    </div>
  );
}
