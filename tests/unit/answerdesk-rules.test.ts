import { describe, it, expect } from 'vitest';
import { isAutomatedReport, friendlyNo, distribution } from '../../scripts/answerdesk/lib/rules.mjs';

describe('isAutomatedReport', () => {
  it('detects DMARC aggregate reports, with or without the [Preview] prefix', () => {
    expect(isAutomatedReport('[Preview] Report Domain: example.com Submitter: mail.example.net Report-ID: 123')).toBe(true);
    expect(isAutomatedReport('Report Domain: example.com Submitter: x.org Report-ID:2026.03.15.1')).toBe(true);
  });

  it('keeps ordinary subjects', () => {
    expect(isAutomatedReport('Report a bug in matrix')).toBe(false);
    expect(isAutomatedReport('')).toBe(false);
  });
});

describe('friendlyNo', () => {
  it('parses T/t-prefixed and bare ticket numbers', () => {
    expect(friendlyNo('T4502')).toBe(4502);
    expect(friendlyNo('t17')).toBe(17);
    expect(friendlyNo('4502')).toBe(4502);
  });

  it('returns null for anything else', () => {
    expect(friendlyNo('abc')).toBeNull();
    expect(friendlyNo('')).toBeNull();
    expect(friendlyNo('T12x')).toBeNull();
  });
});

describe('distribution', () => {
  it('counts values, maps empty to (none), sorts by count desc', () => {
    expect(distribution(['Closed', 'Closed', 'Active', null])).toEqual([
      ['Closed', 2],
      ['Active', 1],
      ['(none)', 1],
    ]);
    expect(distribution(['', undefined, 'x'])).toEqual([
      ['(none)', 2],
      ['x', 1],
    ]);
  });
});
