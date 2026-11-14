type Data = Record<string, unknown>;

export type ClearPlan = {
  /** Fields to reset to '' in the form. */
  clear: string[];
  /** Data to record as the last-saved snapshot (sent data with cleared fields blank). */
  savedData: Data;
  /** Queued (not yet saved) data after clearing, or null when it holds nothing new. */
  pending: Data | null;
};

const isBlank = (v: unknown) => String(v ?? '').trim() === '';

function without(data: Data, keys: string[]): string {
  const rest = Object.entries(data)
    .filter(([k]) => !keys.includes(k))
    .sort(([a], [b]) => a.localeCompare(b));
  return JSON.stringify(rest);
}

/**
 * After a successful save, decide which write-only fields to reset. A field is
 * cleared only if it still holds what was sent; a queued save is dropped only if
 * it carries no changes beyond the cleared fields.
 */
export function planClearAfterSave(
  sent: Data,
  current: Data,
  pending: Data | null,
  clearKeys: string[],
): ClearPlan {
  const clear = clearKeys.filter(
    (k) => !isBlank(sent[k]) && String(current[k] ?? '') === String(sent[k]),
  );
  const savedData = { ...sent };
  for (const k of clear) savedData[k] = '';
  if (!pending) return { clear, savedData, pending: null };
  const nextPending = { ...pending };
  for (const k of clear) nextPending[k] = '';
  const hasOtherChanges = without(nextPending, clear) !== without(sent, clear);
  return { clear, savedData, pending: hasOtherChanges ? nextPending : null };
}
