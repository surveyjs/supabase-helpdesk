import { describe, it, expect } from 'vitest';
import { buildAiSettingsDiff } from '@/lib/ai/settings-diff';

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
});
