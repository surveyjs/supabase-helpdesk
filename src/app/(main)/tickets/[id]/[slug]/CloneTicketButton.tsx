import Link from 'next/link';

/**
 * Opens the create-ticket page prefilled as a clone of this ticket. Nothing is
 * written until the agent submits that form; cancelling returns to this ticket.
 */
export function CloneTicketButton({ ticketId }: { ticketId: number }) {
  return (
    <Link
      href={`/tickets/new?clone_from=${ticketId}`}
      className="px-3 py-1 text-xs rounded bg-blue-100 text-blue-700 hover:bg-blue-200"
      data-testid="clone-ticket-btn"
    >
      Clone
    </Link>
  );
}
