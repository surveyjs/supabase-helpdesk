import { describe, it, expect } from 'vitest';
import { brandingCss, DEFAULT_BRANDING, parseBranding, validateBranding } from '@/lib/branding';

// #2: basic branding.
describe('parseBranding', () => {
  it('falls back to the defaults for missing or invalid parts', () => {
    expect(parseBranding(null)).toEqual(DEFAULT_BRANDING);
    expect(parseBranding('nope')).toEqual(DEFAULT_BRANDING);
    expect(parseBranding(JSON.stringify({ productName: 'Acme Support', logoUrl: 'javascript:alert(1)', primaryColor: 'red' })))
      .toEqual({ productName: 'Acme Support', logoUrl: '', primaryColor: '#2563eb' });
    expect(parseBranding(JSON.stringify({ productName: 'X', logoUrl: '/logo.svg', primaryColor: '#19B394' })))
      .toEqual({ productName: 'X', logoUrl: '/logo.svg', primaryColor: '#19b394' });
  });
});

describe('validateBranding', () => {
  it('requires a name and checks the logo URL and colour', () => {
    expect(validateBranding({ productName: '' })).toHaveProperty('error');
    expect(validateBranding({ productName: 'A', logoUrl: 'http://x/logo.png' })).toHaveProperty('error');
    expect(validateBranding({ productName: 'A', logoUrl: '//evil/x.png' })).toHaveProperty('error');
    expect(validateBranding({ productName: 'A', primaryColor: '#12345' })).toHaveProperty('error');
    expect(validateBranding({ productName: ' SurveyJS Help ', logoUrl: 'https://surveyjs.io/logo.svg', primaryColor: '' }))
      .toEqual({ branding: { productName: 'SurveyJS Help', logoUrl: 'https://surveyjs.io/logo.svg', primaryColor: '#2563eb' } });
  });
});

describe('brandingCss', () => {
  it('is empty for the default colour and remaps the blue scale otherwise', () => {
    expect(brandingCss('#2563eb')).toBe('');
    const css = brandingCss('#19b394');
    expect(css).toContain('--color-blue-600:#19b394;');
    expect(css).toContain('--color-blue-700:color-mix(in oklab, #19b394, black 15%);');
    expect(css).toContain('--color-primary:#19b394;');
  });

  it('never emits anything but a hex colour', () => {
    expect(brandingCss('red;}body{display:none')).toBe('');
  });
});
