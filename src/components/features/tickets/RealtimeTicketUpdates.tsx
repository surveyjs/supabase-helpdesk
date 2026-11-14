'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { RealtimeChannel } from '@supabase/supabase-js';
import { createBrowserClient } from '@/lib/supabase/client';
import { authorizeRealtime } from '@/lib/supabase/realtime';

interface RealtimeTicketUpdatesProps {
  ticketId: number;
}

export function RealtimeTicketUpdates({ ticketId }: RealtimeTicketUpdatesProps) {
  const router = useRouter();
  const [status, setStatus] = useState<string>('connecting');

  useEffect(() => {
    const supabase = createBrowserClient();
    let cancelled = false;
    let channel: RealtimeChannel | null = null;
    let wasSubscribed = false;
    let lastStatus = 'connecting';

    async function start() {
      await authorizeRealtime(supabase);
      if (cancelled) return;

      channel = supabase
        .channel(`ticket-${ticketId}`)
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
          },
        )
        .on(
          'postgres_changes',
          {
            event: '*',
            schema: 'public',
            table: 'tickets',
            filter: `id=eq.${ticketId}`,
          },
          () => {
            router.refresh();
          },
        )
        .subscribe((next, err) => {
          if (cancelled || next === lastStatus) return;
          lastStatus = next;
          setStatus(next);
          if (next === 'CHANNEL_ERROR' || next === 'TIMED_OUT') {
            console.warn('HelpDesk: ticket realtime', next, err);
          }
          if (next === 'SUBSCRIBED') {
            // A SUBSCRIBED after an earlier one is a reconnect: events sent while
            // the channel was down are gone, so refetch to backfill them.
            if (wasSubscribed) router.refresh();
            wasSubscribed = true;
          }
        });
    }

    start().catch((err) => {
      console.warn('HelpDesk: ticket realtime', 'setup failed', err);
    });

    return () => {
      cancelled = true;
      if (channel) supabase.removeChannel(channel);
    };
  }, [ticketId, router]);

  return <span hidden data-testid="realtime-status" data-status={status} />;
}
