import { describe, it, expect } from 'vitest';
import { formatMinutes } from '../format-minutes';

describe('formatMinutes', () => {
  it('renders null as an em dash', () => expect(formatMinutes(null)).toBe('—'));
  it('renders 0 as 0m', () => expect(formatMinutes(0)).toBe('0m'));
  it('renders minutes under an hour', () => expect(formatMinutes(45)).toBe('45m'));
  it('renders hours and minutes', () => expect(formatMinutes(135)).toBe('2h 15m'));
});
