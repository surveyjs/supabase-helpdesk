'use client';

import { useState } from 'react';
import { submitCsatRating } from '@/lib/actions/csat';

interface CsatFormProps {
  token: string;
  ticketId: number;
  existingRating?: number;
  existingComment?: string;
}

export function CsatForm({ token, existingRating, existingComment }: CsatFormProps) {
  const [rating, setRating] = useState<number>(existingRating ?? 0);
  const [hoveredStar, setHoveredStar] = useState<number>(0);
  const [comment, setComment] = useState(existingComment ?? '');
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<{ success: boolean; newToken?: string; error?: string } | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (rating < 1 || rating > 5) return;

    setSubmitting(true);
    try {
      const res = await submitCsatRating(token, rating, comment.trim() || undefined);
      setResult(res);
    } catch {
      setResult({ success: false, error: 'An unexpected error occurred.' });
    } finally {
      setSubmitting(false);
    }
  }

  if (result?.success) {
    return (
      <div className="text-center" data-testid="csat-success">
        <div className="text-4xl mb-4">🎉</div>
        <h2 className="text-lg font-semibold text-gray-900 mb-2">
          Thank you for your feedback!
        </h2>
        <div className="flex justify-center gap-1 mb-4" data-testid="csat-submitted-stars">
          {[1, 2, 3, 4, 5].map((star) => (
            <span
              key={star}
              className={`text-2xl ${star <= rating ? 'text-yellow-400' : 'text-gray-300'}`}
            >
              ★
            </span>
          ))}
        </div>
        {comment && (
          <p className="text-sm text-gray-600 mb-4 italic">&quot;{comment}&quot;</p>
        )}
        {result.newToken && (
          <div className="mt-6 p-4 bg-blue-50 rounded-lg text-sm text-blue-800">
            <p className="font-medium mb-1">Want to update your rating later?</p>
            <p>
              Bookmark this link:{' '}
              <a
                href={`/csat/${result.newToken}`}
                className="text-blue-600 hover:text-blue-800 underline break-all"
                data-testid="csat-update-link"
              >
                {typeof window !== 'undefined' ? window.location.origin : ''}/csat/{result.newToken}
              </a>
            </p>
          </div>
        )}
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} data-testid="csat-form">
      {existingRating && (
        <p className="text-sm text-amber-600 mb-4 text-center">
          You previously rated this ticket {existingRating}/5. You can update your rating below.
        </p>
      )}

      {/* Star rating */}
      <div className="flex justify-center gap-2 mb-6">
        {[1, 2, 3, 4, 5].map((star) => (
          <button
            key={star}
            type="button"
            onClick={() => setRating(star)}
            onMouseEnter={() => setHoveredStar(star)}
            onMouseLeave={() => setHoveredStar(0)}
            className={`text-4xl transition-colors cursor-pointer ${
              star <= (hoveredStar || rating)
                ? 'text-yellow-400'
                : 'text-gray-300'
            }`}
            aria-label={`Rate ${star} star${star > 1 ? 's' : ''}`}
            data-testid={`csat-star-${star}`}
          >
            ★
          </button>
        ))}
      </div>

      {rating > 0 && (
        <p className="text-center text-sm text-gray-600 mb-4">
          You selected <strong>{rating}</strong> out of 5 stars
        </p>
      )}

      {/* Comment */}
      <div className="mb-6">
        <label htmlFor="csat-comment" className="block text-sm font-medium text-gray-700 mb-1">
          Comment (optional)
        </label>
        <textarea
          id="csat-comment"
          value={comment}
          onChange={(e) => setComment(e.target.value)}
          maxLength={5000}
          rows={4}
          className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none resize-vertical"
          placeholder="Tell us about your experience..."
          data-testid="csat-comment"
        />
        <p className="text-xs text-gray-400 mt-1">{comment.length}/5000</p>
      </div>

      {result?.error && (
        <p className="text-sm text-red-600 mb-4" data-testid="csat-error">{result.error}</p>
      )}

      <button
        type="submit"
        disabled={rating < 1 || submitting}
        className="w-full px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed text-sm font-medium"
        data-testid="csat-submit"
      >
        {submitting ? 'Submitting...' : existingRating ? 'Update Rating' : 'Submit Rating'}
      </button>
    </form>
  );
}
