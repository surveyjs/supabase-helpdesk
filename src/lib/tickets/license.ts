/**
 * Name of the per-ticket custom field holding the customer's license status
 * ("Licensed" / "Unlicensed" / "Enterprise"), created by the AnswerDesk import
 * (scripts/answerdesk). The Agent Dashboard shows it next to the submitter
 * (#104); deployments without the field simply show nothing.
 */
export const LICENSE_STATUS_FIELD = 'License Status';

/** The ticket's license status, or null when unset / not a string. */
export function ticketLicenseStatus(customFields: unknown): string | null {
  if (!customFields || typeof customFields !== 'object') return null;
  const v = (customFields as Record<string, unknown>)[LICENSE_STATUS_FIELD];
  return typeof v === 'string' && v.trim() ? v : null;
}
