import { describe, it, expect } from 'vitest';
import { needsDisplayName } from '@/lib/users/display-name';

describe('needsDisplayName', () => {
  it('is true for an empty or null name', () => {
    expect(needsDisplayName({ display_name: '', email: 'a@x.io' })).toBe(true);
    expect(needsDisplayName({ display_name: '  ', email: 'a@x.io' })).toBe(true);
    expect(needsDisplayName({ display_name: null, email: 'a@x.io' })).toBe(true);
  });
  it('is true when the name equals the e-mail local part, case-insensitively', () => {
    expect(needsDisplayName({ display_name: 'alice', email: 'alice@x.io' })).toBe(true);
    expect(needsDisplayName({ display_name: 'Alice', email: 'alice@x.io' })).toBe(true);
  });
  it('is false for a real name', () => {
    expect(needsDisplayName({ display_name: 'Alice Smith', email: 'alice@x.io' })).toBe(false);
  });
});
