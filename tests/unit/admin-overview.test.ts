import { describe, it, expect } from 'vitest';
import { emailStatus, shouldWarnTierSecret, formatCount } from '@/lib/admin/overview';
import { NOTIFICATION_EVENT_LABELS } from '@/lib/notifications/event-labels';

describe('emailStatus', () => {
  it('is not-configured without a host', () => {
    expect(emailStatus(null)).toBe('not-configured');
    expect(emailStatus({ smtp_host: '', is_verified: true })).toBe('not-configured');
    expect(emailStatus({ smtp_host: null, is_verified: false })).toBe('not-configured');
  });
  it('is not-verified with a host but no verification', () => {
    expect(emailStatus({ smtp_host: 'smtp.example.com', is_verified: false })).toBe('not-verified');
    expect(emailStatus({ smtp_host: 'smtp.example.com', is_verified: null })).toBe('not-verified');
  });
  it('is configured only with host and verification', () => {
    expect(emailStatus({ smtp_host: 'smtp.example.com', is_verified: true })).toBe('configured');
  });
});

describe('shouldWarnTierSecret', () => {
  it('warns only when tiers exist and the secret is missing', () => {
    expect(shouldWarnTierSecret(0, false)).toBe(false);
    expect(shouldWarnTierSecret(3, false)).toBe(true);
    expect(shouldWarnTierSecret(3, true)).toBe(false);
  });
  it('does not warn when the tier count is unknown', () => {
    expect(shouldWarnTierSecret(null, false)).toBe(false);
  });
});

describe('formatCount', () => {
  it('shows a dash for a failed count, never 0', () => {
    expect(formatCount(null)).toBe('—');
    expect(formatCount(0)).toBe('0');
    expect(formatCount(1234)).toBe('1,234');
  });
});

describe('NOTIFICATION_EVENT_LABELS', () => {
  it('marks agent-only events with (agents)', () => {
    expect(NOTIFICATION_EVENT_LABELS.agent_assigned_to_agent).toMatch(/\(agents\)$/);
    expect(NOTIFICATION_EVENT_LABELS.user_reply_to_agent).toMatch(/\(agents\)$/);
  });
});
