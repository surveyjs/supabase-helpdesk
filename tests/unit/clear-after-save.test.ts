import { describe, it, expect } from 'vitest';
import { planClearAfterSave } from '@/components/features/survey/clear-after-save';

const KEYS = ['ai_api_key'];

describe('planClearAfterSave', () => {
  const sent = { ai_model: 'm', ai_api_key: 'sk-1' };

  it('clears the field when unchanged since the send', () => {
    const plan = planClearAfterSave(sent, { ...sent }, null, KEYS);
    expect(plan.clear).toEqual(['ai_api_key']);
    expect(plan.savedData).toEqual({ ai_model: 'm', ai_api_key: '' });
  });

  it('does not clear when the user changed it during the save', () => {
    const current = { ai_model: 'm', ai_api_key: 'sk-2' };
    const plan = planClearAfterSave(sent, current, current, KEYS);
    expect(plan.clear).toEqual([]);
    expect(plan.pending).toEqual(current);
  });

  it('keeps a pending edit to another field', () => {
    const current = { ai_model: 'm2', ai_api_key: 'sk-1' };
    const plan = planClearAfterSave(sent, current, current, KEYS);
    expect(plan.clear).toEqual(['ai_api_key']);
    expect(plan.pending).toEqual({ ai_model: 'm2', ai_api_key: '' });
  });

  it('drops a pending save that only repeats the cleared field', () => {
    const plan = planClearAfterSave(sent, { ...sent }, { ...sent }, KEYS);
    expect(plan.pending).toBeNull();
  });

  it('clears nothing when the sent value was blank', () => {
    const blank = { ai_model: 'm', ai_api_key: '  ' };
    expect(planClearAfterSave(blank, blank, null, KEYS).clear).toEqual([]);
  });
});
