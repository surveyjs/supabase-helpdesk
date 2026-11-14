'use client';

import { useRealtimeRefresh } from '@/lib/supabase/use-realtime-refresh';

export function RealtimeDashboard() {
  // Bulk actions update tickets row by row; the hook merges such bursts into one refresh.
  const status = useRealtimeRefresh(
    'agent-dashboard',
    (channel, onChange) =>
      channel
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'tickets' }, onChange)
        .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'tickets' }, onChange)
        .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'tickets' }, onChange),
    'dashboard realtime',
  );

  return <span hidden data-testid="dashboard-realtime-status" data-status={status} />;
}
