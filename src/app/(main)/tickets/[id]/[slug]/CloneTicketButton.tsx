import Link from 'next/link';

/**
 * Opens the create-ticket page prefilled as a clone of this ticket. Nothing is
 * written until the agent submits that form; cancelling returns to this ticket.
 */
export function CloneTicketButton({ ticketId }: { ticketId: number }) {
  return (
    <Link
      href={`/tickets/new?clone_from=${ticketId}`}
      className="inline-flex items-center rounded-md border border-gray-300 bg-white px-2.5 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50"
      data-testid="clone-ticket-btn"
    >
      Clone
    </Link>
  );
}
