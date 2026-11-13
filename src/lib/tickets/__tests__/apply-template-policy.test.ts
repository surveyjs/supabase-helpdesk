import { describe, expect, it } from 'vitest';
import { hasVisibleQuestion } from '../apply-template-policy';

describe('hasVisibleQuestion', () => {
  const tpl = (elements: unknown[]) => ({ pages: [{ name: 'p', elements }] });

  it('finds a question by name, also inside panels', () => {
    expect(hasVisibleQuestion(tpl([{ type: 'tagbox', name: 'tag_ids' }]), 'tag_ids')).toBe(true);
    expect(
      hasVisibleQuestion(tpl([{ type: 'panel', name: 'p1', elements: [{ type: 'tagbox', name: 'tag_ids' }] }]), 'tag_ids'),
    ).toBe(true);
  });

  it('is false when the question is missing or hidden (itself or via its panel)', () => {
    expect(hasVisibleQuestion(tpl([{ type: 'dropdown', name: 'status' }]), 'tag_ids')).toBe(false);
    expect(hasVisibleQuestion(tpl([{ type: 'tagbox', name: 'tag_ids', visible: false }]), 'tag_ids')).toBe(false);
    expect(
      hasVisibleQuestion(
        tpl([{ type: 'panel', name: 'p1', visible: false, elements: [{ type: 'tagbox', name: 'tag_ids' }] }]),
        'tag_ids',
      ),
    ).toBe(false);
  });

  it('supports top-level elements', () => {
    expect(hasVisibleQuestion({ elements: [{ type: 'tagbox', name: 'tag_ids' }] }, 'tag_ids')).toBe(true);
  });
});
