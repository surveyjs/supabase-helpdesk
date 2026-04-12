'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { createBrowserClient } from '@/lib/supabase/client';

interface RealtimeTicketUpdatesProps {
  ticketId: number;
}

export default function RealtimeTicketUpdates({ ticketId }: RealtimeTicketUpdatesProps) {
  const router = useRouter();

  useEffect(() => {
    const supabase = createBrowserClient();

    const channel = supabase
      .channel('ticket-updates')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'posts',
          filter: `ticket_id=eq.${ticketId}`,
        },
        () => {
          router.refresh();
        }
      )
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'tickets',
          filter: `id=eq.${ticketId}`,
        },
        () => {
          router.refresh();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [ticketId, router]);

  return null;
}
