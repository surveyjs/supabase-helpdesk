'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { RealtimeChannel } from '@supabase/supabase-js';
import { createBrowserClient } from '@/lib/supabase/client';
import { authorizeRealtime } from '@/lib/supabase/realtime';
import { createRefreshCoalescer, type RefreshCoalescer } from '@/lib/supabase/refresh-coalescer';

type ChannelOptions = {
  /** Used in console warnings, e.g. 'ticket realtime'. */
  label: string;
  /** Runs on a SUBSCRIBED after an earlier SUBSCRIBED (a reconnect). */
  onResubscribed?: () => void;
};

/**
 * Subscribes one Realtime channel and returns its status ('connecting', then
 * the channel's SUBSCRIBED / CHANNEL_ERROR / TIMED_OUT / CLOSED). The socket is
 * authorized with the user's JWT before the channel joins. `configure` adds the
 * channel's listeners; the channel is (re)created only when `name` changes, so
 * `name` must identify everything the listeners filter on.
 */
export function useRealtimeChannel(
  name: string,
  configure: (channel: RealtimeChannel) => RealtimeChannel,
  options: ChannelOptions,
): string {
  const [status, setStatus] = useState<string>('connecting');
  const configureRef = useRef(configure);
  const optionsRef = useRef(options);
  useEffect(() => {
    configureRef.current = configure;
    optionsRef.current = options;
  });

  useEffect(() => {
    let supabase: ReturnType<typeof createBrowserClient>;
    try {
      supabase = createBrowserClient();
    } catch (err) {
      // Missing runtime config: render without realtime updates.
      console.warn(`HelpDesk: ${optionsRef.current.label} disabled —`, err);
      return;
    }
    let cancelled = false;
    let channel: RealtimeChannel | null = null;
    let wasSubscribed = false;
    let lastStatus = 'connecting';

    async function start() {
      await authorizeRealtime(supabase);
      if (cancelled) return;

      channel = configureRef.current(supabase.channel(name)).subscribe((next, err) => {
        if (cancelled || next === lastStatus) return;
        lastStatus = next;
        setStatus(next);
        if (next === 'CHANNEL_ERROR' || next === 'TIMED_OUT') {
          console.warn(`HelpDesk: ${optionsRef.current.label}`, next, err);
        }
        if (next === 'SUBSCRIBED') {
          // A SUBSCRIBED after an earlier one is a reconnect: events sent while
          // the channel was down are gone.
          if (wasSubscribed) optionsRef.current.onResubscribed?.();
          wasSubscribed = true;
        }
      });
    }

    start().catch((err) => {
      console.warn(`HelpDesk: ${optionsRef.current.label}`, 'setup failed', err);
    });

    return () => {
      cancelled = true;
      if (channel) supabase.removeChannel(channel);
    };
  }, [name]);

  return status;
}

/**
 * A Realtime channel whose changes re-render the current route. Events are
 * coalesced into one router.refresh() (1 s after the last event, at most 5 s
 * into a continuous stream); nothing refreshes while the tab is hidden, and one
 * refresh runs when it becomes visible if changes arrived meanwhile. A
 * reconnect refreshes once to backfill missed changes. Returns the channel
 * status (see useRealtimeChannel).
 */
export function useRealtimeRefresh(
  name: string,
  bind: (channel: RealtimeChannel, onChange: () => void) => RealtimeChannel,
  label: string,
): string {
  const router = useRouter();
  const coalescerRef = useRef<RefreshCoalescer | null>(null);

  // Declared before useRealtimeChannel so the coalescer exists before the channel subscribes.
  useEffect(() => {
    const coalescer = createRefreshCoalescer({
      refresh: () => router.refresh(),
      isHidden: () => document.visibilityState === 'hidden',
    });
    coalescerRef.current = coalescer;
    const onVisibility = () => coalescer.visibilityChanged();
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      coalescer.dispose();
      if (coalescerRef.current === coalescer) coalescerRef.current = null;
    };
  }, [router]);

  return useRealtimeChannel(
    name,
    (channel) => bind(channel, () => coalescerRef.current?.notify()),
    { label, onResubscribed: () => coalescerRef.current?.refreshNow() },
  );
}
