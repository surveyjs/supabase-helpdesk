import { describe, it, expect } from 'vitest';
import { formatPreciseRelativeTime } from '../time';

const NOW = new Date('2026-11-24T12:00:00Z');
const ago = (min: number) => new Date(NOW.getTime() - min * 60000).toISOString();

describe('formatPreciseRelativeTime (#104)', () => {
  it('uses one unit below a day', () => {
    expect(formatPreciseRelativeTime(ago(0), NOW)).toBe('just now');
    expect(formatPreciseRelativeTime(ago(1), NOW)).toBe('1 minute ago');
    expect(formatPreciseRelativeTime(ago(27), NOW)).toBe('27 minutes ago');
    expect(formatPreciseRelativeTime(ago(3 * 60 + 40), NOW)).toBe('3 hours ago');
  });

  it('adds the next unit from a day on', () => {
    expect(formatPreciseRelativeTime(ago(34 * 60), NOW)).toBe('1 day and 10 hours ago');
    expect(formatPreciseRelativeTime(ago(48 * 60), NOW)).toBe('2 days ago');
    expect(formatPreciseRelativeTime(ago(35 * 24 * 60), NOW)).toBe('1 month and 5 days ago');
    expect(formatPreciseRelativeTime(ago(400 * 24 * 60), NOW)).toBe('1 year and 1 month ago');
  });

  it('treats future times as now', () => {
    expect(formatPreciseRelativeTime(ago(-5), NOW)).toBe('just now');
  });
});
