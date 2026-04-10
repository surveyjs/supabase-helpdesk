import Link from 'next/link';
import { Badge } from '@/components/ui/Badge';

type TicketEntry = {
  id: number;
  title: string;
  slug: string;
  status: string;
  updated_at: string;
};

export function TicketList({ tickets }: { tickets: TicketEntry[] }) {
  if (tickets.length === 0) {
    return (
      <div className="text-center py-12 text-gray-500">
        <p className="text-lg">No tickets found.</p>
        <Link
          href="/tickets/new"
          className="mt-4 inline-block text-blue-600 hover:text-blue-800 text-sm"
        >
          Create your first ticket
        </Link>
      </div>
    );
  }

  return (
    <ul className="divide-y divide-gray-200 bg-white rounded-lg border border-gray-200">
      {tickets.map((ticket) => (
        <li key={ticket.id}>
          <Link
            href={`/tickets/${ticket.id}/${ticket.slug}`}
            className="block px-4 py-3 hover:bg-gray-50 transition-colors"
          >
            <div className="flex items-center justify-between gap-4">
              <div className="flex items-center gap-3 min-w-0">
                <Badge variant="status" value={ticket.status} />
                <span className="text-sm font-medium text-gray-900 truncate">
                  {ticket.title}
                </span>
              </div>
              <time
                dateTime={ticket.updated_at}
                className="text-xs text-gray-500 whitespace-nowrap"
              >
                {new Date(ticket.updated_at).toLocaleDateString()}
              </time>
            </div>
          </Link>
        </li>
      ))}
    </ul>
  );
}
