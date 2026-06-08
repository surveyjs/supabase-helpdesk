'use client';

import { useState, useTransition } from 'react';
import { cloneTicket } from '@/lib/actions/clone';

export function CloneTicketButton({ ticketId }: { ticketId: number }) {
  const [showConfirm, setShowConfirm] = useState(false);
  const [isPending, startTransition] = useTransition();

  return (
    <div>
      {!showConfirm ? (
        <button
          type="button"
          onClick={() => setShowConfirm(true)}
          className="px-3 py-1 text-xs rounded bg-blue-100 text-blue-700 hover:bg-blue-200"
          data-testid="clone-ticket-btn"
        >
          Clone
        </button>
      ) : (
        <div className="space-y-2" data-testid="clone-ticket-confirm">
          <p className="text-xs text-gray-600">
            Create a copy of this ticket? The copy is owned by the ticket&apos;s creator.
          </p>
          <div className="flex gap-2">
            <form
              action={(formData) => {
                startTransition(async () => {
                  await cloneTicket(formData);
                });
              }}
            >
              <input type="hidden" name="ticket_id" value={ticketId} />
              <button
                type="submit"
                disabled={isPending}
                className="px-3 py-1 text-xs rounded bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50"
                data-testid="clone-ticket-confirm-btn"
              >
                {isPending ? 'Cloning…' : 'Confirm Clone'}
              </button>
            </form>
            <button
              type="button"
              onClick={() => setShowConfirm(false)}
              className="px-3 py-1 text-xs text-gray-500 hover:text-gray-700"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
