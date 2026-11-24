import { describe, it, expect } from 'vitest';
import {
  createdRange,
  dataToUrlParams,
  generateSqlFromJson,
  normalizeFilterData,
  urlParamsToData,
} from '@/lib/filters/ticket-filter';
import { findInvalidAgentDashboardQuestionNames } from '@/lib/constants/survey-ui-config';
import template from '@/components/features/survey/form-json/admin/agent-dashboard-template.json';

// #113: Created date range and Private/Public filters on the agent dashboard.
const NOW = new Date('2026-11-24T15:30:00Z');

describe('createdRange', () => {
  it('maps presets to UTC windows', () => {
    expect(createdRange({ created: 'today' }, NOW)).toEqual({ gte: '2026-11-24T00:00:00.000Z' });
    expect(createdRange({ created: 'yesterday' }, NOW)).toEqual({
      gte: '2026-11-23T00:00:00.000Z',
      lt: '2026-11-24T00:00:00.000Z',
    });
    expect(createdRange({ created: '7d' }, NOW)).toEqual({ gte: '2026-11-17T15:30:00.000Z' });
    expect(createdRange({ created: '6m' }, NOW)).toEqual({ gte: '2026-05-24T15:30:00.000Z' });
    expect(createdRange({ created: '1y' }, NOW)).toEqual({ gte: '2025-11-24T15:30:00.000Z' });
  });

  it('a custom range includes both end days; either end may be open', () => {
    expect(createdRange({ created: 'custom', created_from: '2026-01-01', created_to: '2026-01-31' }, NOW)).toEqual({
      gte: '2026-01-01T00:00:00.000Z',
      lt: '2026-02-01T00:00:00.000Z',
    });
    expect(createdRange({ created: 'custom', created_to: '2026-01-31' }, NOW)).toEqual({ lt: '2026-02-01T00:00:00.000Z' });
    expect(createdRange({ created: 'custom' }, NOW)).toEqual({});
  });

  it('dates without the custom preset, or no preset, mean no filter', () => {
    expect(createdRange({ created_from: '2026-01-01' }, NOW)).toEqual({});
    expect(createdRange({}, NOW)).toEqual({});
  });
});

describe('normalize / URL round trip', () => {
  it('keeps valid values and drops junk', () => {
    expect(normalizeFilterData({ created: 'custom', created_from: '2026-01-01', created_to: 'nope', privacy: 'public' }))
      .toEqual({ created: 'custom', created_from: '2026-01-01', privacy: 'public' });
    expect(normalizeFilterData({ created: '7d', created_from: '2026-01-01', privacy: 'secret' })).toEqual({ created: '7d' });
    expect(normalizeFilterData({ created: 'forever' })).toEqual({});
  });

  it('survives encoding into and out of URL params', () => {
    const data = { created: 'custom' as const, created_from: '2026-01-01', created_to: '2026-01-31', privacy: 'private' as const };
    const params = Object.fromEntries(dataToUrlParams(data));
    expect(urlParamsToData(params)).toEqual(data);
  });

  it('shows up in the generated SQL text', () => {
    const sql = generateSqlFromJson({ created: 'custom', created_from: '2026-01-01', privacy: 'private' });
    expect(sql).toContain("created_at >= '2026-01-01T00:00:00.000Z'");
    expect(sql).toContain('is_private = true');
  });
});

describe('bundled agent-dashboard template', () => {
  it('only uses allowed question names, including the new ones', () => {
    expect(findInvalidAgentDashboardQuestionNames(template)).toEqual([]);
  });
});
