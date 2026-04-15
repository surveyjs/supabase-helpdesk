'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { generateKbArticle } from '@/lib/actions/ai';

export function GenerateKbArticleButton({ ticketId }: { ticketId: number }) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  async function handleClick() {
    setPending(true);
    setError(null);
    try {
      const fd = new FormData();
      fd.set('ticket_id', String(ticketId));
      const result = await generateKbArticle(fd);

      if (result.error) {
        setError(result.error);
        return;
      }

      if (result.redirectUrl) {
        router.push(result.redirectUrl);
      }
    } catch {
      setError('Could not generate KB article. Please try again.');
    } finally {
      setPending(false);
    }
  }

  return (
    <div>
      <button
        type="button"
        onClick={handleClick}
        disabled={pending}
        className="px-3 py-1 text-xs rounded bg-green-100 text-green-700 hover:bg-green-200 disabled:opacity-50"
        data-testid="generate-kb-article-btn"
      >
        {pending ? 'Generating…' : 'Generate KB Article'}
      </button>
      {error && (
        <p className="mt-1 text-xs text-red-600">{error}</p>
      )}
    </div>
  );
}
