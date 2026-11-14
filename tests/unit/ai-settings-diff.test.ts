import { describe, it, expect } from 'vitest';
import {
  advanceAiSettingsBaseline,
  buildAiSettingsDiff,
  createAiSettingsSaveTracker,
} from '@/lib/ai/settings-diff';

function entries(fd: FormData): Record<string, string> {
  return Object.fromEntries(Array.from(fd.entries()).map(([k, v]) => [k, String(v)]));
}

describe('buildAiSettingsDiff', () => {
  const baseline = { ai_model: 'a', ai_filter_enabled: false, ai_request_timeout: 60, ai_api_key: '' };

  it('emits only changed keys', () => {
    const fd = buildAiSettingsDiff({ ...baseline, ai_model: 'b' }, baseline);
    expect(entries(fd)).toEqual({ ai_model: 'b' });
  });

  it('emits booleans as true/false and numbers as strings', () => {
    const on = buildAiSettingsDiff({ ...baseline, ai_filter_enabled: true, ai_request_timeout: 90 }, baseline);
    expect(entries(on)).toEqual({ ai_filter_enabled: 'true', ai_request_timeout: '90' });
    const off = buildAiSettingsDiff({ ...baseline, ai_filter_enabled: false }, { ...baseline, ai_filter_enabled: true });
    expect(entries(off)).toEqual({ ai_filter_enabled: 'false' });
  });

  it('omits a blank api key and includes a non-blank one', () => {
    expect(entries(buildAiSettingsDiff({ ...baseline, ai_api_key: '   ' }, baseline))).toEqual({});
    expect(entries(buildAiSettingsDiff({ ...baseline, ai_api_key: ' sk-1 ' }, baseline))).toEqual({ ai_api_key: 'sk-1' });
  });

  it('does not emit equal arrays or objects', () => {
    const b = { list: ['x', 'y'], obj: { a: 1 } };
    expect(entries(buildAiSettingsDiff({ list: ['x', 'y'], obj: { a: 1 } }, b))).toEqual({});
  });

  it('sends an emptied field as empty string (SurveyJS drops the key)', () => {
    const { ai_model: _m, ...current } = baseline;
    expect(entries(buildAiSettingsDiff(current, { ...baseline, ai_model: 'x' }))).toEqual({ ai_model: '' });
  });

  it('sends null/undefined for a baseline value as empty string', () => {
    expect(entries(buildAiSettingsDiff({ ...baseline, ai_model: null }, baseline))).toEqual({ ai_model: '' });
    expect(entries(buildAiSettingsDiff({ ...baseline, ai_request_timeout: undefined }, baseline)))
      .toEqual({ ai_request_timeout: '' });
  });

  it('does not send a key that is empty in both current and baseline', () => {
    const { ai_model: _m, ...current } = baseline;
    expect(entries(buildAiSettingsDiff(current, { ...baseline, ai_model: '' }))).toEqual({});
  });

  it('never sends the api key just because it is missing from current', () => {
    const { ai_api_key: _k, ...current } = baseline;
    expect(entries(buildAiSettingsDiff(current, { ...baseline, ai_api_key: 'old' }))).toEqual({});
  });

  it('alwaysSend keys are sent even when equal to the baseline', () => {
    expect(entries(buildAiSettingsDiff(baseline, baseline, ['ai_model']))).toEqual({ ai_model: 'a' });
  });
});

describe('advanceAiSettingsBaseline', () => {
  it('moves only the sent keys and drops emptied ones', () => {
    const next = advanceAiSettingsBaseline(
      { ai_model: 'a', ai_provider: 'openai', ai_filter_enabled: false },
      { ai_model: 'b', ai_filter_enabled: true },
      ['ai_model', 'ai_provider', 'ai_api_key'],
    );
    expect(next).toEqual({ ai_model: 'b', ai_filter_enabled: false });
  });
});

describe('createAiSettingsSaveTracker (overlapping saves)', () => {
  const base = { ai_model: 'a', ai_provider: 'openai', ai_filter_enabled: false };

  it('a later failed save is re-sent after an earlier save succeeds', () => {
    const t = createAiSettingsSaveTracker(base);
    const a = t.begin({ ...base, ai_model: 'b' });
    expect(entries(a)).toEqual({ ai_model: 'b' });
    const b = t.begin({ ...base, ai_model: 'b', ai_filter_enabled: true });
    t.settle(a, true);
    t.settle(b, false);
    // B's toggle never reached the DB: the next save must carry it again.
    const c = t.begin({ ...base, ai_model: 'b', ai_filter_enabled: true });
    expect(entries(c)).toEqual({ ai_filter_enabled: 'true' });
  });

  it('a field changed back while its save is in flight is sent again', () => {
    const t = createAiSettingsSaveTracker(base);
    const a = t.begin({ ...base, ai_model: 'b' });
    const b = t.begin({ ...base });
    expect(entries(b)).toEqual({ ai_model: 'a' });
    t.settle(a, true);
    t.settle(b, true);
    expect(t.baseline()).toEqual(base);
    expect(entries(t.begin({ ...base }))).toEqual({});
  });

  it('a failed save keeps the baseline so its fields are re-sent', () => {
    const t = createAiSettingsSaveTracker(base);
    const a = t.begin({ ...base, ai_provider: '' });
    expect(entries(a)).toEqual({ ai_provider: '' });
    t.settle(a, false);
    expect(entries(t.begin({ ...base, ai_provider: '' }))).toEqual({ ai_provider: '' });
  });

  it('clearing a field is persisted once and then not re-sent', () => {
    const t = createAiSettingsSaveTracker(base);
    const { ai_model: _m, ...cleared } = base;
    const a = t.begin(cleared);
    expect(entries(a)).toEqual({ ai_model: '' });
    t.settle(a, true);
    expect(entries(t.begin(cleared))).toEqual({});
  });
});
