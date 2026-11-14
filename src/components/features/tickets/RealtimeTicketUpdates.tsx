'use client';

import { useRealtimeRefresh } from '@/lib/supabase/use-realtime-refresh';

interface RealtimeTicketUpdatesProps {
  ticketId: number;
}

export function RealtimeTicketUpdates({ ticketId }: RealtimeTicketUpdatesProps) {
  // A reply fires a posts INSERT plus a tickets UPDATE (timestamp trigger); the
  // hook merges them into one refresh.
  const status = useRealtimeRefresh(
    `ticket-${ticketId}`,
    (channel, onChange) =>
      channel
        .on(
          'postgres_changes',
          { event: '*', schema: 'public', table: 'posts', filter: `ticket_id=eq.${ticketId}` },
          onChange,
        )
        .on(
          'postgres_changes',
          { event: '*', schema: 'public', table: 'tickets', filter: `id=eq.${ticketId}` },
          onChange,
        ),
    'ticket realtime',
  );

  return <span hidden data-testid="realtime-status" data-status={status} />;
}
