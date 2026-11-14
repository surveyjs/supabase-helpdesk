'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { RealtimeChannel } from '@supabase/supabase-js';
import { createBrowserClient } from '@/lib/supabase/client';
import { authorizeRealtime } from '@/lib/supabase/realtime';

export function RealtimeDashboard() {
  const router = useRouter();
  const [status, setStatus] = useState<string>('connecting');

  useEffect(() => {
    const supabase = createBrowserClient();
    let cancelled = false;
    let channel: RealtimeChannel | null = null;
    let wasSubscribed = false;
    let lastStatus = 'connecting';
    const refreshDashboard = () => {
      router.refresh();
    };

    async function start() {
      await authorizeRealtime(supabase);
      if (cancelled) return;

      channel = supabase
        .channel('agent-dashboard')
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'tickets' }, refreshDashboard)
        .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'tickets' }, refreshDashboard)
        .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'tickets' }, refreshDashboard)
        .subscribe((next, err) => {
          if (cancelled || next === lastStatus) return;
          lastStatus = next;
          setStatus(next);
          if (next === 'CHANNEL_ERROR' || next === 'TIMED_OUT') {
            console.warn('HelpDesk: dashboard realtime', next, err);
          }
          if (next === 'SUBSCRIBED') {
            // A SUBSCRIBED after an earlier one is a reconnect: backfill missed changes.
            if (wasSubscribed) refreshDashboard();
            wasSubscribed = true;
          }
        });
    }

    start().catch((err) => {
      console.warn('HelpDesk: dashboard realtime', 'setup failed', err);
    });

    return () => {
      cancelled = true;
      if (channel) supabase.removeChannel(channel);
    };
  }, [router]);

  return <span hidden data-testid="dashboard-realtime-status" data-status={status} />;
}
