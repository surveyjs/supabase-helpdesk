export type EmailStatus = 'configured' | 'not-verified' | 'not-configured';

export function emailStatus(
  cfg: { smtp_host?: string | null; is_verified?: boolean | null } | null | undefined,
): EmailStatus {
  if (!cfg?.smtp_host) return 'not-configured';
  return cfg.is_verified ? 'configured' : 'not-verified';
}

/** Warn about the tier API secret only when tiers exist (null = count unknown). */
export function shouldWarnTierSecret(tierCount: number | null, secretConfigured: boolean): boolean {
  return tierCount !== null && tierCount > 0 && !secretConfigured;
}

/** A failed count (null) renders as a dash, never as 0. */
export function formatCount(n: number | null): string {
  return n === null ? '—' : n.toLocaleString('en-US');
}
