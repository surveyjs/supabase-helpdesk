import { describe, it, expect } from 'vitest';
import {
  DEFAULT_SPAM_SETTINGS,
  matchSpamRule,
  parseAiSpamScore,
  parseSpamSettings,
  validateSpamSettings,
  type SpamSettings,
} from '@/lib/spam';

// #28: spam rules for new tickets.
const on = (over: Partial<SpamSettings>): SpamSettings => ({ ...DEFAULT_SPAM_SETTINGS, enabled: true, ...over });
const t = (email: string, title = 'Question', body = 'How do I use the matrix?') => ({ email, title, body });

describe('matchSpamRule', () => {
  it('matches senders, domains (incl. subdomains), keywords and patterns', () => {
    expect(matchSpamRule(on({ blockedSenders: ['bad@x.com'] }), t('BAD@x.com'))).toBe('blocked sender bad@x.com');
    expect(matchSpamRule(on({ blockedDomains: ['spam.io'] }), t('a@mail.spam.io'))).toBe('blocked domain spam.io');
    expect(matchSpamRule(on({ blockedDomains: ['spam.io'] }), t('a@notspam.io'))).toBeNull();
    expect(matchSpamRule(on({ keywords: ['Backlinks'] }), t('a@b.com', 'Cheap BACKLINKS'))).toBe('keyword "Backlinks"');
    const seo = /\bseo\b.*offer/.source;
    expect(matchSpamRule(on({ patterns: [seo] }), t('a@b.com', 'Hi', 'Our SEO special offer'))).toBe(`pattern /${seo}/`);
    expect(matchSpamRule(on({ patterns: [seo] }), t('a@b.com', 'Hi', 'Our seoul office'))).toBeNull();
  });

  it('does nothing when disabled or nothing matches', () => {
    expect(matchSpamRule({ ...on({ keywords: ['matrix'] }), enabled: false }, t('a@b.com'))).toBeNull();
    expect(matchSpamRule(on({ keywords: ['casino'] }), t('a@b.com'))).toBeNull();
  });
});

describe('validateSpamSettings / parseSpamSettings', () => {
  it('turns the form into clean lists and checks every line', () => {
    const r = validateSpamSettings({
      enabled: 'on', action: 'close',
      blockedSenders: ' bad@x.com \n\nbad@x.com', blockedDomains: '@Spam.io', keywords: 'casino\n',
      patterns: 'seo.*offer', aiEnabled: 'on', aiThreshold: '0.8',
    });
    expect(r).toEqual({ settings: {
      enabled: true, action: 'close', blockedSenders: ['bad@x.com'], blockedDomains: ['spam.io'],
      keywords: ['casino'], patterns: ['seo.*offer'], aiEnabled: true, aiThreshold: 0.8,
    } });
    expect(validateSpamSettings({ patterns: '(unclosed' })).toHaveProperty('error');
    expect(validateSpamSettings({ blockedDomains: 'not a domain' })).toHaveProperty('error');
    expect(validateSpamSettings({ blockedSenders: 'nobody' })).toHaveProperty('error');
    expect(validateSpamSettings({ aiThreshold: '0.2' })).toHaveProperty('error');
  });

  it('parses junk to the defaults (off)', () => {
    expect(parseSpamSettings(null)).toEqual(DEFAULT_SPAM_SETTINGS);
    expect(parseSpamSettings('{')).toEqual(DEFAULT_SPAM_SETTINGS);
  });
});

describe('parseAiSpamScore', () => {
  it('reads the JSON verdict, even wrapped in prose or code fences', () => {
    expect(parseAiSpamScore('{"spam_probability": 0.97, "reason": "SEO offer"}')).toBe(0.97);
    expect(parseAiSpamScore('```json\n{"spam_probability":0.1}\n```')).toBe(0.1);
    expect(parseAiSpamScore('no idea')).toBeNull();
    expect(parseAiSpamScore('{"spam_probability": 7}')).toBeNull();
  });
});
