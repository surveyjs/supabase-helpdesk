import { describe, it, expect } from 'vitest';
import { endExclusive, effectiveGroupBy } from '@/lib/utils/date-range';

describe('endExclusive', () => {
  it('adds one UTC day', () => {
    expect(endExclusive('2026-03-31')).toBe('2026-04-01');
    expect(endExclusive('2026-12-31')).toBe('2027-01-01');
    expect(endExclusive('2024-02-28')).toBe('2024-02-29');
  });
});

describe('effectiveGroupBy', () => {
  it('falls back from day to week when the inclusive range exceeds 366 days', () => {
    expect(effectiveGroupBy('2025-01-01', '2026-03-01', 'day')).toBe('week');
  });
  it('keeps day up to 366 days inclusive', () => {
    expect(effectiveGroupBy('2026-01-01', '2026-12-31', 'day')).toBe('day');
    expect(effectiveGroupBy('2024-01-01', '2024-12-31', 'day')).toBe('day'); // 366 days
    expect(effectiveGroupBy('2024-01-01', '2025-01-01', 'day')).toBe('week'); // 367 days
  });
  it('leaves week and month unchanged', () => {
    expect(effectiveGroupBy('2000-01-01', '2026-03-01', 'week')).toBe('week');
    expect(effectiveGroupBy('2000-01-01', '2026-03-01', 'month')).toBe('month');
  });
});
