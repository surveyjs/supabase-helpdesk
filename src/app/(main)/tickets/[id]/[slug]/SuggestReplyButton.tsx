'use client';

import { useState } from 'react';
import { suggestReply } from '@/lib/actions/ai';

export function SuggestReplyButton({ ticketId }: { ticketId: number }) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleClick() {
    setPending(true);
    setError(null);
    try {
      const fd = new FormData();
      fd.set('ticket_id', String(ticketId));
      const result = await suggestReply(fd);

      if (result.error) {
        setError(result.error);
        return;
      }

      if (result.reply) {
        // Find the reply textarea and insert the suggested text
        const textarea = document.querySelector('textarea[name="body"][aria-label="Reply body"]') as HTMLTextAreaElement | null;
        if (textarea) {
          const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
            window.HTMLTextAreaElement.prototype, 'value',
          )?.set;
          if (nativeInputValueSetter) {
            nativeInputValueSetter.call(textarea, result.reply);
            textarea.dispatchEvent(new Event('input', { bubbles: true }));
          } else {
            textarea.value = result.reply;
          }
          textarea.focus();
        }
      }
    } catch {
      setError('Could not generate suggestion. Please try again or write a manual reply.');
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="inline-flex items-center gap-2">
      <button
        type="button"
        onClick={handleClick}
        disabled={pending}
        className="px-3 py-1.5 text-xs rounded bg-purple-100 text-purple-700 hover:bg-purple-200 disabled:opacity-50"
        data-testid="suggest-reply-btn"
      >
        {pending ? 'Generating…' : 'Suggest Reply'}
      </button>
      {error && (
        <span className="text-xs text-red-600" data-testid="suggest-reply-error">{error}</span>
      )}
    </div>
  );
}
