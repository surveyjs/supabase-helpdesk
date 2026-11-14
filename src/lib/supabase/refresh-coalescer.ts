export type RefreshCoalescerOptions = {
  /** Runs the actual refresh (router.refresh()). */
  refresh: () => void;
  /** True while the page is hidden; no refresh runs then. */
  isHidden: () => boolean;
  /** Quiet time after the last event before refreshing. */
  debounceMs?: number;
  /** Longest an event waits during a continuous stream of events. */
  maxWaitMs?: number;
};

export type RefreshCoalescer = {
  /** A change arrived: refresh once the burst settles (or at the max wait). */
  notify(): void;
  /** Refresh now (e.g. after a reconnect), or once visible again if hidden. */
  refreshNow(): void;
  /** Call on visibilitychange: runs one refresh if changes arrived while hidden. */
  visibilityChanged(): void;
  /** Cancels pending timers; later calls do nothing. */
  dispose(): void;
};

/**
 * Merges bursts of realtime events into one refresh: a trailing debounce,
 * capped by a max wait so a continuous stream still refreshes periodically.
 * Nothing refreshes while the page is hidden; one refresh runs when it becomes
 * visible if anything arrived meanwhile.
 */
export function createRefreshCoalescer({
  refresh,
  isHidden,
  debounceMs = 1000,
  maxWaitMs = 5000,
}: RefreshCoalescerOptions): RefreshCoalescer {
  let debounceTimer: ReturnType<typeof setTimeout> | null = null;
  let maxTimer: ReturnType<typeof setTimeout> | null = null;
  let dirty = false;
  let disposed = false;

  function clearTimers() {
    if (debounceTimer) clearTimeout(debounceTimer);
    if (maxTimer) clearTimeout(maxTimer);
    debounceTimer = null;
    maxTimer = null;
  }

  function flush() {
    clearTimers();
    if (disposed || !dirty) return;
    // Hidden: keep `dirty` so becoming visible refreshes once.
    if (isHidden()) return;
    dirty = false;
    refresh();
  }

  return {
    notify() {
      if (disposed) return;
      dirty = true;
      if (isHidden()) {
        clearTimers();
        return;
      }
      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(flush, debounceMs);
      if (!maxTimer) maxTimer = setTimeout(flush, maxWaitMs);
    },
    refreshNow() {
      if (disposed) return;
      dirty = true;
      flush();
    },
    visibilityChanged() {
      if (disposed || isHidden()) return;
      flush();
    },
    dispose() {
      disposed = true;
      clearTimers();
    },
  };
}
