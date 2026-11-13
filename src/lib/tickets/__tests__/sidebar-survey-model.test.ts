import { describe, expect, it } from 'vitest';
import { Model } from 'survey-core';
import { mergeServerValues, uncheckEmptyBooleans } from '../sidebar-survey-model';

describe('uncheckEmptyBooleans', () => {
  function build() {
    const m = new Model({
      elements: [
        { type: 'boolean', name: 'custom_fields.Flag', renderAs: 'checkbox' },
        { type: 'boolean', name: 'is_private', renderAs: 'checkbox' },
        { type: 'text', name: 'custom_fields.Note' },
      ],
    });
    m.data = { is_private: true };
    return m;
  }

  it('turns an unset boolean into an unchecked (non-indeterminate) box', () => {
    const m = build();
    uncheckEmptyBooleans(m);
    const q = m.getQuestionByName('custom_fields.Flag') as unknown as { isIndeterminate: boolean; booleanValue: boolean | null };
    expect(q.isIndeterminate).toBe(false);
    expect(q.booleanValue).toBe(false);
  });

  it('keeps set booleans and leaves non-boolean questions alone', () => {
    const m = build();
    uncheckEmptyBooleans(m);
    expect(m.getValue('is_private')).toBe(true);
    expect(m.getValue('custom_fields.Note')).toBeUndefined();
  });

  it('does not raise onValueChanged (nothing is dispatched for saving)', () => {
    const m = build();
    const fired: string[] = [];
    m.onValueChanged.add((_, o) => fired.push(o.name));
    uncheckEmptyBooleans(m);
    expect(fired).toEqual([]);
  });
});

describe('mergeServerValues', () => {
  function build(initial: Record<string, unknown>) {
    const m = new Model({
      elements: [
        { type: 'text', name: 'custom_fields.Note' },
        { type: 'dropdown', name: 'priority_id', choices: ['a', 'b', 'c'] },
        { type: 'boolean', name: 'custom_fields.Flag', renderAs: 'checkbox' },
        { type: 'tagbox', name: 'tag_ids', choices: ['t1', 't2', 't3'] },
      ],
    });
    m.data = initial;
    return m;
  }
  const none = new Set<string>();

  it('applies changed server values to untouched fields without firing onValueChanged', () => {
    const prev = { 'custom_fields.Note': 'x', priority_id: 'a' };
    const m = build(prev);
    const fired: string[] = [];
    m.onValueChanged.add((_, o) => fired.push(o.name));
    const base = mergeServerValues(m, { 'custom_fields.Note': 'x', priority_id: 'b' }, prev, none);
    expect(m.getValue('priority_id')).toBe('b');
    expect(fired).toEqual([]);
    expect(base.priority_id).toBe('b');
  });

  it("keeps a dirty field's local value", () => {
    const prev = { 'custom_fields.Note': 'x', priority_id: 'a' };
    const m = build(prev);
    m.setValue('custom_fields.Note', 'draft');
    mergeServerValues(m, { 'custom_fields.Note': 'srv', priority_id: 'b' }, prev, new Set(['custom_fields.Note']));
    expect(m.getValue('custom_fields.Note')).toBe('draft');
    expect(m.getValue('priority_id')).toBe('b');
  });

  it('does not advance the baseline for a skipped dirty field', () => {
    const prev = { 'custom_fields.Note': 'x', priority_id: 'a' };
    const m = build(prev);
    const base = mergeServerValues(m, { 'custom_fields.Note': 'srv', priority_id: 'b' }, prev, new Set(['custom_fields.Note']));
    expect(base['custom_fields.Note']).toBe('x');
    expect(base.priority_id).toBe('b');
  });

  it('no-op for deep-equal values (arrays)', () => {
    const prev = { tag_ids: ['t1', 't2'] };
    const m = build(prev);
    m.setValue('tag_ids', ['t1', 't2', 't3']);
    const base = mergeServerValues(m, { tag_ids: ['t1', 't2'] }, prev, none);
    expect(m.getValue('tag_ids')).toEqual(['t1', 't2', 't3']);
    expect(base.tag_ids).toEqual(['t1', 't2']);
  });

  it('applies a field again once it is no longer dirty', () => {
    const prev = { priority_id: 'a' };
    const m = build(prev);
    const incoming = { priority_id: 'c' };
    const base = mergeServerValues(m, incoming, prev, new Set(['priority_id']));
    expect(m.getValue('priority_id')).toBe('a');
    mergeServerValues(m, incoming, base, none);
    expect(m.getValue('priority_id')).toBe('c');
  });

  it('applies a value removed on the server', () => {
    const prev = { priority_id: 'a' };
    const m = build(prev);
    const base = mergeServerValues(m, {}, prev, none);
    expect(m.getValue('priority_id')).toBeUndefined();
    expect(base.priority_id).toBeUndefined();
  });

  it('empty booleans stay unchecked after merge', () => {
    const prev = { 'custom_fields.Flag': true };
    const m = build(prev);
    mergeServerValues(m, {}, prev, none);
    const q = m.getQuestionByName('custom_fields.Flag') as unknown as { isIndeterminate: boolean };
    expect(m.getValue('custom_fields.Flag')).toBe(false);
    expect(q.isIndeterminate).toBe(false);
  });
});
