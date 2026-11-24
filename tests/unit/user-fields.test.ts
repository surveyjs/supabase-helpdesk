import { describe, it, expect } from 'vitest';
import { formatUserFieldValue, parseUserFieldInput } from '@/lib/users/user-fields';

// #103: values of admin-defined user fields.
const def = (field_type: 'text' | 'number' | 'dropdown' | 'checkbox' | 'date', options: string[] | null = null) =>
  ({ name: 'F', field_type, options });

describe('parseUserFieldInput', () => {
  it('parses each type; empty means no value', () => {
    expect(parseUserFieldInput(def('text'), ' hi ')).toEqual({ value: 'hi' });
    expect(parseUserFieldInput(def('text'), '')).toEqual({ value: null });
    expect(parseUserFieldInput(def('number'), '42')).toEqual({ value: 42 });
    expect(parseUserFieldInput(def('checkbox'), 'on')).toEqual({ value: true });
    expect(parseUserFieldInput(def('checkbox'), null)).toEqual({ value: null });
    expect(parseUserFieldInput(def('dropdown', ['Licensed', 'Enterprise']), 'Enterprise')).toEqual({ value: 'Enterprise' });
    expect(parseUserFieldInput(def('date'), '2026-11-24')).toEqual({ value: '2026-11-24' });
  });

  it('refuses invalid input', () => {
    expect(parseUserFieldInput(def('number'), 'abc')).toHaveProperty('error');
    expect(parseUserFieldInput(def('dropdown', ['A']), 'B')).toHaveProperty('error');
    expect(parseUserFieldInput(def('date'), '24.11.2026')).toHaveProperty('error');
    expect(parseUserFieldInput(def('text'), 'x'.repeat(1001))).toHaveProperty('error');
  });
});

describe('formatUserFieldValue', () => {
  it('shows an em dash for no value and Yes for a ticked checkbox', () => {
    expect(formatUserFieldValue({ field_type: 'text' }, null)).toBe('—');
    expect(formatUserFieldValue({ field_type: 'checkbox' }, true)).toBe('Yes');
    expect(formatUserFieldValue({ field_type: 'number' }, 3)).toBe('3');
  });
});
