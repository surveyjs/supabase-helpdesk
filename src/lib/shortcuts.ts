/**
 * Agent keyboard shortcuts on the ticket page (#1). The admin can change the
 * key combinations in Admin > Keyboard Shortcuts; they are stored as JSON in
 * app_settings under SHORTCUTS_SETTING_KEY. Plain module (no 'use client'), so
 * server pages and client components can both use it.
 */

export const SHORTCUTS_SETTING_KEY = 'agent_keyboard_shortcuts';

export const SHORTCUT_ACTIONS = [
  {
    id: 'save',
    label: 'Save',
    description: 'Submit the reply, comment, note or post edit you are typing.',
  },
  {
    id: 'reply_and_close',
    label: 'Reply and close',
    description: 'Send the reply you are typing and close the ticket.',
  },
  {
    id: 'copy_ticket_info',
    label: 'Copy ticket info',
    description: 'Copy the ticket number, title and link to the clipboard.',
  },
] as const;

export type ShortcutActionId = (typeof SHORTCUT_ACTIONS)[number]['id'];
export type ShortcutMap = Record<ShortcutActionId, string>;

/** The AnswerDesk shortcuts the team is used to. */
export const DEFAULT_SHORTCUTS: ShortcutMap = {
  save: 'Ctrl+S',
  reply_and_close: 'Ctrl+Alt+P',
  copy_ticket_info: 'Alt+C',
};

export type ParsedShortcut = {
  ctrl: boolean;
  alt: boolean;
  shift: boolean;
  /** KeyboardEvent.code, e.g. "KeyS", "Digit1", "Enter", "F2". */
  code: string;
};

const NAMED_KEYS: Record<string, string> = {
  enter: 'Enter',
  space: 'Space',
  tab: 'Tab',
  escape: 'Escape',
  esc: 'Escape',
  backspace: 'Backspace',
  delete: 'Delete',
  up: 'ArrowUp',
  down: 'ArrowDown',
  left: 'ArrowLeft',
  right: 'ArrowRight',
};

/**
 * Parse "Ctrl+Alt+P" style text. Modifiers: Ctrl (also Cmd on macOS), Alt
 * (Option), Shift. The key is a letter, a digit, F1–F12 or a named key
 * (Enter, Space, …). Returns null when the text is not a usable shortcut.
 */
export function parseShortcut(text: string): ParsedShortcut | null {
  const parts = text.split('+').map((p) => p.trim()).filter(Boolean);
  if (parts.length === 0) return null;
  const out: ParsedShortcut = { ctrl: false, alt: false, shift: false, code: '' };
  for (let i = 0; i < parts.length; i++) {
    const raw = parts[i];
    const p = raw.toLowerCase();
    const isLast = i === parts.length - 1;
    if (!isLast) {
      if (p === 'ctrl' || p === 'control' || p === 'cmd' || p === 'meta') out.ctrl = true;
      else if (p === 'alt' || p === 'option') out.alt = true;
      else if (p === 'shift') out.shift = true;
      else return null;
      continue;
    }
    if (/^[a-z]$/.test(p)) out.code = `Key${p.toUpperCase()}`;
    else if (/^[0-9]$/.test(p)) out.code = `Digit${p}`;
    else if (/^f([1-9]|1[0-2])$/.test(p)) out.code = p.toUpperCase();
    else if (NAMED_KEYS[p]) out.code = NAMED_KEYS[p];
    else return null;
  }
  // A bare letter or digit would fire while typing; require a modifier then.
  const isCharacter = out.code.startsWith('Key') || out.code.startsWith('Digit');
  if (isCharacter && !out.ctrl && !out.alt) return null;
  return out;
}

/** Canonical display text, e.g. "ctrl + alt+p" -> "Ctrl+Alt+P". */
export function formatShortcut(s: ParsedShortcut): string {
  const key = s.code.startsWith('Key') ? s.code.slice(3)
    : s.code.startsWith('Digit') ? s.code.slice(5)
    : s.code.replace(/^Arrow/, '');
  return [s.ctrl && 'Ctrl', s.alt && 'Alt', s.shift && 'Shift', key].filter(Boolean).join('+');
}

/** Whether a keydown event matches. Ctrl matches Ctrl or Cmd. */
export function matchesShortcut(
  e: Pick<KeyboardEvent, 'ctrlKey' | 'metaKey' | 'altKey' | 'shiftKey' | 'code'>,
  s: ParsedShortcut,
): boolean {
  return (
    e.code === s.code
    && (e.ctrlKey || e.metaKey) === s.ctrl
    && e.altKey === s.alt
    && e.shiftKey === s.shift
  );
}

/**
 * The effective shortcuts from the stored setting: each action's stored combo
 * if it parses, else its default. An empty string disables the action.
 */
export function resolveShortcuts(raw: string | null | undefined): ShortcutMap {
  const out: ShortcutMap = { ...DEFAULT_SHORTCUTS };
  if (!raw) return out;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return out;
  }
  if (!parsed || typeof parsed !== 'object') return out;
  for (const { id } of SHORTCUT_ACTIONS) {
    const v = (parsed as Record<string, unknown>)[id];
    if (typeof v !== 'string') continue;
    if (v.trim() === '') out[id] = '';
    else {
      const p = parseShortcut(v);
      if (p) out[id] = formatShortcut(p);
    }
  }
  return out;
}

/**
 * Validate admin input: every non-empty combo must parse and be unique.
 * Returns the canonical map or an error message.
 */
export function validateShortcuts(
  input: Record<string, unknown>,
): { map: ShortcutMap } | { error: string } {
  const map = { ...DEFAULT_SHORTCUTS };
  const seen = new Map<string, string>();
  for (const { id, label } of SHORTCUT_ACTIONS) {
    const v = input[id];
    const text = typeof v === 'string' ? v.trim() : '';
    if (!text) {
      map[id] = '';
      continue;
    }
    const p = parseShortcut(text);
    if (!p) {
      return { error: `"${text}" (${label}) is not a valid shortcut. Use e.g. Ctrl+S, Alt+C, Ctrl+Shift+F2.` };
    }
    const canonical = formatShortcut(p);
    const clash = seen.get(canonical);
    if (clash) return { error: `${canonical} is used for both ${clash} and ${label}.` };
    seen.set(canonical, label);
    map[id] = canonical;
  }
  return { map };
}
