import { describe, expect, it } from 'vitest';
import { Model } from 'survey-core';
import { uncheckEmptyBooleans } from '../sidebar-survey-model';

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
