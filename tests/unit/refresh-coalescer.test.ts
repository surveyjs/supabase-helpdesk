import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRefreshCoalescer } from '@/lib/supabase/refresh-coalescer';

describe('createRefreshCoalescer', () => {
  let hidden: boolean;
  let refresh: ReturnType<typeof vi.fn<() => void>>;

  beforeEach(() => {
    vi.useFakeTimers();
    hidden = false;
    refresh = vi.fn<() => void>();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  const make = () =>
    createRefreshCoalescer({ refresh, isHidden: () => hidden, debounceMs: 1000, maxWaitMs: 5000 });

  it('merges a burst of events into one refresh after the quiet time', () => {
    const c = make();
    for (let i = 0; i < 50; i++) {
      c.notify();
      vi.advanceTimersByTime(10);
    }
    expect(refresh).not.toHaveBeenCalled();
    vi.advanceTimersByTime(999);
    expect(refresh).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(10_000);
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('a continuous stream still refreshes at the max wait', () => {
    const c = make();
    // One event every 500 ms: the debounce alone would never fire.
    for (let t = 0; t < 12_000; t += 500) {
      c.notify();
      vi.advanceTimersByTime(500);
    }
    expect(refresh).toHaveBeenCalledTimes(2); // at 5 s and 10 s
    vi.advanceTimersByTime(1000);
    expect(refresh).toHaveBeenCalledTimes(3); // trailing refresh after the stream stops
  });

  it('does not refresh while hidden, and refreshes once on becoming visible', () => {
    const c = make();
    hidden = true;
    for (let i = 0; i < 10; i++) c.notify();
    vi.advanceTimersByTime(10_000);
    expect(refresh).not.toHaveBeenCalled();

    hidden = false;
    c.visibilityChanged();
    expect(refresh).toHaveBeenCalledTimes(1);
    c.visibilityChanged();
    vi.advanceTimersByTime(10_000);
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('becoming visible without events does not refresh', () => {
    const c = make();
    hidden = true;
    c.visibilityChanged();
    hidden = false;
    c.visibilityChanged();
    expect(refresh).not.toHaveBeenCalled();
  });

  it('a pending refresh is held if the page hides before it fires', () => {
    const c = make();
    c.notify();
    hidden = true;
    vi.advanceTimersByTime(5000);
    expect(refresh).not.toHaveBeenCalled();
    hidden = false;
    c.visibilityChanged();
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('refreshNow refreshes immediately and replaces a pending debounce', () => {
    const c = make();
    c.notify();
    c.refreshNow();
    expect(refresh).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(10_000);
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('refreshNow while hidden waits for visibility', () => {
    const c = make();
    hidden = true;
    c.refreshNow();
    expect(refresh).not.toHaveBeenCalled();
    hidden = false;
    c.visibilityChanged();
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('dispose cancels a pending refresh', () => {
    const c = make();
    c.notify();
    c.dispose();
    vi.advanceTimersByTime(10_000);
    c.notify();
    c.refreshNow();
    expect(refresh).not.toHaveBeenCalled();
  });
});
