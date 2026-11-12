// Small pure rules used by prepare.mjs (unit-tested in tests/unit/answerdesk-rules.test.ts).

const DMARC_REPORT = /^(\[Preview\]\s*)?Report Domain:\s*\S+\s+Submitter:\s*\S+\s+Report-ID:/i;

/**
 * True for automated DMARC aggregate-report e-mails that AnswerDesk turned into tickets.
 * @param {string} subject
 * @returns {boolean}
 */
export function isAutomatedReport(subject) {
  return DMARC_REPORT.test(subject ?? '');
}

/**
 * Tickets.FriendlyId ('T4502', 't4502' or '4502') -> 4502; anything else -> null.
 * @param {string} value
 * @returns {number | null}
 */
export function friendlyNo(value) {
  const m = /^[tT]?(\d+)$/.exec(value ?? '');
  return m ? Number(m[1]) : null;
}

/**
 * Value counts, most frequent first; '' / null / undefined count as '(none)'.
 * @param {Iterable<string | null | undefined>} values
 * @returns {Array<[string, number]>}
 */
export function distribution(values) {
  /** @type {Map<string, number>} */
  const counts = new Map();
  for (const v of values) {
    const k = v === null || v === undefined || v === '' ? '(none)' : v;
    counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  return [...counts].sort((a, b) => b[1] - a[1]);
}
