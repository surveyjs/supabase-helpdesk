'use client';

import { useState, useTransition } from 'react';
import { mergeTickets } from '@/lib/actions/merge';

export function MergeTicketForm({ ticketId }: { ticketId: number }) {
  const [isOpen, setIsOpen] = useState(false);
  const [isPending, startTransition] = useTransition();

  return (
    <div>
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className="px-3 py-1 text-xs rounded bg-purple-100 text-purple-700 hover:bg-purple-200"
        data-testid="merge-ticket-btn"
      >
        Merge into…
      </button>

      {isOpen && (
        <form
          action={(formData) => {
            startTransition(async () => {
              await mergeTickets(formData);
              setIsOpen(false);
            });
          }}
          className="mt-2 space-y-2"
          data-testid="merge-ticket-form"
        >
          <input type="hidden" name="source_ticket_id" value={ticketId} />
          <div className="flex items-center gap-2">
            <input
              type="number"
              name="target_ticket_id"
              placeholder="Target ticket ID"
              min={1}
              required
              className="w-40 rounded border border-gray-300 px-2 py-1 text-xs focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none"
              data-testid="target-ticket-id-input"
            />
            <button
              type="submit"
              disabled={isPending}
              className="px-3 py-1 text-xs rounded bg-purple-600 text-white hover:bg-purple-700 disabled:opacity-50"
            >
              {isPending ? 'Merging…' : 'Merge'}
            </button>
            <button
              type="button"
              onClick={() => setIsOpen(false)}
              className="px-3 py-1 text-xs text-gray-500 hover:text-gray-700"
            >
              Cancel
            </button>
          </div>
          <p className="text-xs text-red-600">
            ⚠ This action is irreversible. All posts, comments, notes, attachments, and followers will be moved to the target ticket.
          </p>
        </form>
      )}
    </div>
  );
}
