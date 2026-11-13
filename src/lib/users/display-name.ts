/** Cookie set by the display-name prompt's "Not now" button (30 days). */
export const DISPLAY_NAME_DISMISS_COOKIE = 'hd_dn_prompt_dismissed';

/**
 * True when a profile has no meaningful display name: empty, or just the
 * e-mail local part (the fallback assigned at sign-up), compared case-insensitively.
 */
export function needsDisplayName(profile: { display_name: string | null; email: string }): boolean {
  const name = (profile.display_name ?? '').trim().toLowerCase();
  if (!name) return true;
  const localPart = profile.email.split('@')[0].trim().toLowerCase();
  return name === localPart;
}
