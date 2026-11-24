/**
 * Spam detection for new tickets (#28). Admin > Spam Rules stores the
 * settings as JSON in app_settings under SPAM_SETTINGS_KEY. Plain module: the
 * pure parts (parse, validate, match) are unit-tested; the side effects live
 * in spam-screen.ts.
 */

export const SPAM_SETTINGS_KEY = 'spam_rules';

export type SpamAction = 'close' | 'flag';

export type SpamSettings = {
  enabled: boolean;
  /** What happens to a ticket caught by a rule or the AI. */
  action: SpamAction;
  /** Exact sender addresses (lower-case). */
  blockedSenders: string[];
  /** Sender domains; a rule for example.com also matches sub.example.com. */
  blockedDomains: string[];
  /** Case-insensitive phrases searched in the title and the first post. */
  keywords: string[];
  /** Case-insensitive regular expressions, same scope as keywords. */
  patterns: string[];
  /** Ask the configured AI provider when no rule matched. */
  aiEnabled: boolean;
  /** AI spam probability (0–1) from which a ticket counts as spam. */
  aiThreshold: number;
};

export const DEFAULT_SPAM_SETTINGS: SpamSettings = {
  enabled: false,
  action: 'flag',
  blockedSenders: [],
  blockedDomains: [],
  keywords: [],
  patterns: [],
  aiEnabled: false,
  aiThreshold: 0.9,
};

/** Name of the tag that flagged tickets get. */
export const SPAM_TAG = 'spam';

const MAX_RULES = 500;

function lines(v: unknown): string[] {
  const raw = Array.isArray(v) ? v.join('\n') : typeof v === 'string' ? v : '';
  return Array.from(
    new Set(raw.split(/\r?\n/).map((s) => s.trim()).filter(Boolean)),
  ).slice(0, MAX_RULES);
}

function validRegex(p: string): boolean {
  try {
    new RegExp(p, 'i');
    return true;
  } catch {
    return false;
  }
}

/** Stored settings with defaults; invalid entries are dropped, never thrown. */
export function parseSpamSettings(raw: string | null | undefined): SpamSettings {
  if (!raw) return { ...DEFAULT_SPAM_SETTINGS };
  let obj: Record<string, unknown>;
  try {
    obj = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return { ...DEFAULT_SPAM_SETTINGS };
  }
  if (!obj || typeof obj !== 'object') return { ...DEFAULT_SPAM_SETTINGS };
  const threshold = Number(obj.aiThreshold);
  return {
    enabled: obj.enabled === true,
    action: obj.action === 'close' ? 'close' : 'flag',
    blockedSenders: lines(obj.blockedSenders).map((s) => s.toLowerCase()),
    blockedDomains: lines(obj.blockedDomains).map((s) => s.toLowerCase().replace(/^@/, '')),
    keywords: lines(obj.keywords),
    patterns: lines(obj.patterns).filter(validRegex),
    aiEnabled: obj.aiEnabled === true,
    aiThreshold: Number.isFinite(threshold) && threshold >= 0.5 && threshold <= 0.99 ? threshold : DEFAULT_SPAM_SETTINGS.aiThreshold,
  };
}

/** Validate the admin form; returns the settings to store or an error. */
export function validateSpamSettings(input: Record<string, unknown>): { settings: SpamSettings } | { error: string } {
  const bad = lines(input.patterns).find((p) => !validRegex(p));
  if (bad) return { error: `Not a valid regular expression: ${bad}` };
  const threshold = input.aiThreshold === undefined || input.aiThreshold === '' ? DEFAULT_SPAM_SETTINGS.aiThreshold : Number(input.aiThreshold);
  if (!Number.isFinite(threshold) || threshold < 0.5 || threshold > 0.99) {
    return { error: 'AI threshold must be between 0.5 and 0.99.' };
  }
  const badDomain = lines(input.blockedDomains).find((d) => !/^@?[a-z0-9.-]+\.[a-z]{2,}$/i.test(d));
  if (badDomain) return { error: `Not a domain: ${badDomain}` };
  const badSender = lines(input.blockedSenders).find((s) => !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(s));
  if (badSender) return { error: `Not an email address: ${badSender}` };
  return {
    settings: parseSpamSettings(
      JSON.stringify({
        enabled: input.enabled === true || input.enabled === 'on' || input.enabled === 'true',
        action: input.action === 'close' ? 'close' : 'flag',
        blockedSenders: lines(input.blockedSenders),
        blockedDomains: lines(input.blockedDomains),
        keywords: lines(input.keywords),
        patterns: lines(input.patterns),
        aiEnabled: input.aiEnabled === true || input.aiEnabled === 'on' || input.aiEnabled === 'true',
        aiThreshold: threshold,
      }),
    ),
  };
}

export type SpamInput = { email: string; title: string; body: string };

/** The first rule a new ticket matches, as a human-readable reason; null if none. */
export function matchSpamRule(settings: SpamSettings, input: SpamInput): string | null {
  if (!settings.enabled) return null;
  const email = input.email.trim().toLowerCase();
  if (email && settings.blockedSenders.includes(email)) return `blocked sender ${email}`;
  const domain = email.split('@')[1] ?? '';
  const blockedDomain = settings.blockedDomains.find((d) => domain === d || domain.endsWith(`.${d}`));
  if (domain && blockedDomain) return `blocked domain ${blockedDomain}`;
  // Bodies can be long; the first 20k characters are plenty for spam.
  const text = `${input.title}\n${input.body}`.slice(0, 20000);
  const lower = text.toLowerCase();
  const keyword = settings.keywords.find((k) => lower.includes(k.toLowerCase()));
  if (keyword) return `keyword "${keyword}"`;
  const pattern = settings.patterns.find((p) => {
    try {
      return new RegExp(p, 'i').test(text);
    } catch {
      return false;
    }
  });
  if (pattern) return `pattern /${pattern}/`;
  return null;
}

/** Read the AI's JSON verdict ({"spam_probability": 0.97, ...}); null if unusable. */
export function parseAiSpamScore(content: string): number | null {
  const json = content.match(/\{[\s\S]*\}/)?.[0];
  if (!json) return null;
  try {
    const v = Number((JSON.parse(json) as Record<string, unknown>).spam_probability);
    return Number.isFinite(v) && v >= 0 && v <= 1 ? v : null;
  } catch {
    return null;
  }
}
