'use client';

import { useState, useTransition } from 'react';
import { deleteTicket } from '@/lib/actions/delete-ticket';

export function DeleteTicketButton({
  ticketId,
  isClosed,
}: {
  ticketId: number;
  isClosed: boolean;
}) {
  const [showConfirm, setShowConfirm] = useState(false);
  const [isPending, startTransition] = useTransition();

  if (isClosed) {
    return (
      <div>
        <button
          type="button"
          disabled
          className="px-3 py-1 text-xs rounded bg-red-100 text-red-400 cursor-not-allowed"
          title="Closed tickets cannot be deleted. Re-open the ticket first."
          data-testid="delete-ticket-btn-disabled"
        >
          Delete Ticket
        </button>
        <p className="text-xs text-red-500 mt-1">
          Closed tickets cannot be deleted. Re-open first.
        </p>
      </div>
    );
  }

  return (
    <div>
      {!showConfirm ? (
        <button
          type="button"
          onClick={() => setShowConfirm(true)}
          className="px-3 py-1 text-xs rounded bg-red-100 text-red-700 hover:bg-red-200"
          data-testid="delete-ticket-btn"
        >
          Delete Ticket
        </button>
      ) : (
        <div className="space-y-2" data-testid="delete-confirm">
          <p className="text-xs text-red-600">
            Are you sure you want to delete ticket #{ticketId}? This action cannot be undone.
          </p>
          <div className="flex gap-2">
            <form
              action={(formData) => {
                startTransition(async () => {
                  await deleteTicket(formData);
                });
              }}
            >
              <input type="hidden" name="ticket_id" value={ticketId} />
              <button
                type="submit"
                disabled={isPending}
                className="px-3 py-1 text-xs rounded bg-red-600 text-white hover:bg-red-700 disabled:opacity-50"
                data-testid="delete-confirm-btn"
              >
                {isPending ? 'Deleting…' : 'Confirm Delete'}
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
