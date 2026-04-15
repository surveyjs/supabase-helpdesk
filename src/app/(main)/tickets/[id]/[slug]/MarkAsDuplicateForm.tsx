'use client';

import { useRef, useState, useTransition } from 'react';
import { markAsDuplicate } from '@/lib/actions/duplicate';

export function MarkAsDuplicateForm({ ticketId }: { ticketId: number }) {
  const [isOpen, setIsOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const formRef = useRef<HTMLFormElement>(null);

  return (
    <div>
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className="px-3 py-1 text-xs rounded bg-yellow-100 text-yellow-700 hover:bg-yellow-200"
        data-testid="mark-duplicate-btn"
      >
        Mark as Duplicate
      </button>

      {isOpen && (
        <form
          ref={formRef}
          action={(formData) => {
            startTransition(async () => {
              await markAsDuplicate(formData);
              setIsOpen(false);
            });
          }}
          className="mt-2 flex items-center gap-2"
          data-testid="mark-duplicate-form"
        >
          <input type="hidden" name="ticket_id" value={ticketId} />
          <input
            type="number"
            name="original_ticket_id"
            placeholder="Original ticket ID"
            min={1}
            required
            className="w-40 rounded border border-gray-300 px-2 py-1 text-xs focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none"
            data-testid="original-ticket-id-input"
          />
          <button
            type="submit"
            disabled={isPending}
            className="px-3 py-1 text-xs rounded bg-yellow-600 text-white hover:bg-yellow-700 disabled:opacity-50"
          >
            {isPending ? 'Marking…' : 'Confirm'}
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
    </div>
  );
}
