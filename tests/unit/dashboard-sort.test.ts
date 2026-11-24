import { describe, it, expect } from 'vitest';
import { generateSqlFromJson, sortOrder } from '@/lib/filters/ticket-filter';
import { findInvalidAgentDashboardQuestionNames } from '@/lib/constants/survey-ui-config';
import template from '@/components/features/survey/form-json/admin/agent-dashboard-template.json';

// #7: Auto ranking and asc/desc sort modes on the agent dashboard.
describe('sortOrder', () => {
  it('maps each mode to view columns; unknown modes fall back to Last Modified', () => {
    expect(sortOrder('updated_asc')).toEqual([{ column: 'updated_at', ascending: true }]);
    expect(sortOrder('activated')).toEqual([{ column: 'last_user_activity_at', ascending: false }]);
    expect(sortOrder('activated_asc')).toEqual([{ column: 'last_user_activity_at', ascending: true }]);
    expect(sortOrder(undefined)).toEqual(sortOrder('updated'));
    expect(sortOrder('nonsense')).toEqual(sortOrder('updated'));
  });

  it('Auto ranks Enterprise first, then priority, then the most recent', () => {
    expect(sortOrder('auto').map((o) => o.column)).toEqual(['is_enterprise', 'priority_rank', 'updated_at']);
    expect(generateSqlFromJson({ sort: 'auto' })).toContain(
      'ORDER BY is_enterprise DESC NULLS LAST, priority_rank DESC NULLS LAST, updated_at DESC',
    );
  });
});

describe('bundled template sort choices', () => {
  it('offers every mode sortOrder knows, plus SLA', () => {
    const sort = (template.pages[0].elements as Array<{ name: string; choices?: Array<{ value: string }> }>)
      .find((e) => e.name === 'sort')!;
    expect(sort.choices!.map((c) => c.value).sort()).toEqual(
      ['activated', 'activated_asc', 'auto', 'created', 'sla', 'updated', 'updated_asc'],
    );
    expect(findInvalidAgentDashboardQuestionNames(template)).toEqual([]);
  });
});
