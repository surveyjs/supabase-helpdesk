import { describe, it, expect } from 'vitest';
import { stripEmailSignature, extractTicketIdFromSubject } from '../../src/lib/utils/email-parser';

// ============================================================
// stripEmailSignature
// ============================================================

describe('stripEmailSignature', () => {
  it('strips standard "-- " signature delimiter', () => {
    const body = 'Hello, I need help.\n\n-- \nJohn Doe\njohn@company.com';
    expect(stripEmailSignature(body)).toBe('Hello, I need help.');
  });

  it('strips "--" (no trailing space) signature delimiter', () => {
    const body = 'Hello world\n--\nSignature content here';
    expect(stripEmailSignature(body)).toBe('Hello world');
  });

  it('strips "___" delimiter (3+ underscores)', () => {
    const body = 'Important message\n\n___\nFooter content';
    expect(stripEmailSignature(body)).toBe('Important message');
  });

  it('strips "Sent from my iPhone" footer', () => {
    const body = 'Quick reply here.\n\nSent from my iPhone';
    expect(stripEmailSignature(body)).toBe('Quick reply here.');
  });

  it('strips "Sent from my iPad" footer', () => {
    const body = 'Reply content.\n\nSent from my iPad';
    expect(stripEmailSignature(body)).toBe('Reply content.');
  });

  it('strips "Sent from my Android" footer', () => {
    const body = 'Hello.\n\nSent from my Android device';
    expect(stripEmailSignature(body)).toBe('Hello.');
  });

  it('strips "Get Outlook for" footer', () => {
    const body = 'Message content.\n\nGet Outlook for iOS';
    expect(stripEmailSignature(body)).toBe('Message content.');
  });

  it('strips quoted reply blocks (> lines)', () => {
    const body = 'My reply here.\n\n> Original message content\n> More original content';
    expect(stripEmailSignature(body)).toBe('My reply here.');
  });

  it('strips forwarded message headers', () => {
    const body = 'FYI see below.\n\n---------- Forwarded message ----------\nFrom: someone@test.com';
    expect(stripEmailSignature(body)).toBe('FYI see below.');
  });

  it('returns original body if stripping results in empty content', () => {
    const body = '-- \nOnly signature, no content';
    const result = stripEmailSignature(body);
    expect(result).toBe(body.trim());
  });

  it('handles empty body gracefully', () => {
    expect(stripEmailSignature('')).toBe('');
  });

  it('handles body with only whitespace', () => {
    expect(stripEmailSignature('   \n  \n   ')).toBe('');
  });

  it('preserves content when no signature is found', () => {
    const body = 'Just a normal email body.\nWith multiple lines.\nNo signature.';
    expect(stripEmailSignature(body)).toBe(body);
  });

  it('handles multiple delimiters, cuts at the first one', () => {
    const body = 'Content\n\n-- \nFirst sig\n___\nSecond sig';
    expect(stripEmailSignature(body)).toBe('Content');
  });
});

// ============================================================
// extractTicketIdFromSubject
// ============================================================

describe('extractTicketIdFromSubject', () => {
  it('extracts ticket ID from [Ticket #123] pattern', () => {
    expect(extractTicketIdFromSubject('Re: [Ticket #123] My Issue')).toBe(123);
  });

  it('extracts ticket ID with large numbers', () => {
    expect(extractTicketIdFromSubject('[Ticket #99999] Big ticket')).toBe(99999);
  });

  it('returns null for subjects without ticket reference', () => {
    expect(extractTicketIdFromSubject('Just a normal subject')).toBeNull();
  });

  it('returns null for empty subject', () => {
    expect(extractTicketIdFromSubject('')).toBeNull();
  });

  it('handles subjects with extra brackets', () => {
    expect(extractTicketIdFromSubject('Re: [URGENT] [Ticket #42] Help!')).toBe(42);
  });

  it('handles [Ticket #0] edge case', () => {
    expect(extractTicketIdFromSubject('[Ticket #0] Test')).toBe(0);
  });

  it('returns null when pattern is malformed', () => {
    expect(extractTicketIdFromSubject('[Ticket #] No Number')).toBeNull();
    expect(extractTicketIdFromSubject('[Ticket ] No Hash')).toBeNull();
    expect(extractTicketIdFromSubject('Ticket #123 No Brackets')).toBeNull();
  });
});
