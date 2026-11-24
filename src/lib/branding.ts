/**
 * Basic branding (#2): product name, logo and primary colour, set in
 * Admin > Appearance and stored as JSON in app_settings under BRANDING_KEY.
 * Plain module: used by server pages, the admin action and tests.
 */

export const BRANDING_KEY = 'branding';

export type Branding = {
  /** Shown in the header and the browser tab. */
  productName: string;
  /** https:// URL or site path (/...) of a logo image; '' for none. */
  logoUrl: string;
  /** #rrggbb; recolours the app's blue scale and SurveyJS forms. */
  primaryColor: string;
};

export const DEFAULT_BRANDING: Branding = {
  productName: 'HelpDesk',
  logoUrl: '',
  primaryColor: '#2563eb',
};

const HEX = /^#[0-9a-f]{6}$/i;

function validLogoUrl(v: string): boolean {
  if (v.startsWith('/') && !v.startsWith('//')) return true;
  try {
    return new URL(v).protocol === 'https:';
  } catch {
    return false;
  }
}

/** The stored setting with defaults for anything missing or invalid. */
export function parseBranding(raw: string | null | undefined): Branding {
  if (!raw) return { ...DEFAULT_BRANDING };
  let obj: unknown;
  try {
    obj = JSON.parse(raw);
  } catch {
    return { ...DEFAULT_BRANDING };
  }
  const r = (obj && typeof obj === 'object' ? obj : {}) as Record<string, unknown>;
  const name = typeof r.productName === 'string' ? r.productName.trim() : '';
  const logo = typeof r.logoUrl === 'string' ? r.logoUrl.trim() : '';
  const color = typeof r.primaryColor === 'string' ? r.primaryColor.trim() : '';
  return {
    productName: name && name.length <= 60 ? name : DEFAULT_BRANDING.productName,
    logoUrl: logo && logo.length <= 500 && validLogoUrl(logo) ? logo : '',
    primaryColor: HEX.test(color) ? color.toLowerCase() : DEFAULT_BRANDING.primaryColor,
  };
}

/** Validate admin input; returns the setting to store or an error. */
export function validateBranding(input: {
  productName?: unknown;
  logoUrl?: unknown;
  primaryColor?: unknown;
}): { branding: Branding } | { error: string } {
  const name = typeof input.productName === 'string' ? input.productName.trim() : '';
  const logo = typeof input.logoUrl === 'string' ? input.logoUrl.trim() : '';
  const color = typeof input.primaryColor === 'string' ? input.primaryColor.trim() : '';
  if (!name) return { error: 'Product name is required.' };
  if (name.length > 60) return { error: 'Product name: at most 60 characters.' };
  if (logo && (logo.length > 500 || !validLogoUrl(logo))) {
    return { error: 'Logo URL must start with https:// or / (a path on this site).' };
  }
  if (color && !HEX.test(color)) return { error: 'Primary colour must look like #2563eb.' };
  return {
    branding: {
      productName: name,
      logoUrl: logo,
      primaryColor: color ? color.toLowerCase() : DEFAULT_BRANDING.primaryColor,
    },
  };
}

// Mix ratios of the primary with white (lighter) or black (darker) for each
// Tailwind shade; 600 is the primary itself, matching the default blue-600.
const SHADES: Array<[string, string]> = [
  ['50', 'white 92%'],
  ['100', 'white 85%'],
  ['200', 'white 70%'],
  ['300', 'white 50%'],
  ['400', 'white 25%'],
  ['500', 'white 10%'],
  ['600', ''],
  ['700', 'black 15%'],
  ['800', 'black 30%'],
  ['900', 'black 45%'],
  ['950', 'black 60%'],
];

/**
 * CSS that recolours the app for a primary colour: Tailwind's blue scale (the
 * app's accent everywhere) and the semantic --color-primary / --color-ring
 * the SurveyJS adapter reads. Empty for the default colour.
 */
export function brandingCss(primaryColor: string): string {
  const p = HEX.test(primaryColor) ? primaryColor.toLowerCase() : DEFAULT_BRANDING.primaryColor;
  if (p === DEFAULT_BRANDING.primaryColor) return '';
  const vars = SHADES.map(([shade, mix]) =>
    `--color-blue-${shade}:${mix ? `color-mix(in oklab, ${p}, ${mix})` : p};`,
  ).join('');
  return `:root{${vars}--color-primary:${p};--color-ring:${p};}`;
}
