import { describe, it, expect } from 'vitest';
import {
  DEFAULT_SHORTCUTS,
  formatShortcut,
  matchesShortcut,
  parseShortcut,
  resolveShortcuts,
  validateShortcuts,
} from '@/lib/shortcuts';

// #1: configurable agent keyboard shortcuts.
const ev = (code: string, mods: Partial<{ ctrl: boolean; meta: boolean; alt: boolean; shift: boolean }> = {}) => ({
  code,
  ctrlKey: !!mods.ctrl,
  metaKey: !!mods.meta,
  altKey: !!mods.alt,
  shiftKey: !!mods.shift,
});

describe('parseShortcut / formatShortcut', () => {
  it('parses the default combos and normalises spelling', () => {
    expect(parseShortcut('Ctrl+S')).toEqual({ ctrl: true, alt: false, shift: false, code: 'KeyS' });
    expect(formatShortcut(parseShortcut(' alt + ctrl+p ')!)).toBe('Ctrl+Alt+P');
    expect(formatShortcut(parseShortcut('Cmd+Shift+Enter')!)).toBe('Ctrl+Shift+Enter');
    expect(formatShortcut(parseShortcut('Alt+F2')!)).toBe('Alt+F2');
  });

  it('rejects junk and bare characters that would fire while typing', () => {
    expect(parseShortcut('')).toBeNull();
    expect(parseShortcut('S')).toBeNull();
    expect(parseShortcut('Shift+S')).toBeNull();
    expect(parseShortcut('Hyper+S')).toBeNull();
    expect(parseShortcut('Ctrl+Pizza')).toBeNull();
    expect(parseShortcut('F2')).not.toBeNull();
  });
});

describe('matchesShortcut', () => {
  it('matches on the physical key, with Cmd counting as Ctrl', () => {
    const s = parseShortcut('Ctrl+Alt+P')!;
    expect(matchesShortcut(ev('KeyP', { ctrl: true, alt: true }), s)).toBe(true);
    expect(matchesShortcut(ev('KeyP', { meta: true, alt: true }), s)).toBe(true);
    expect(matchesShortcut(ev('KeyP', { ctrl: true }), s)).toBe(false);
    expect(matchesShortcut(ev('KeyP', { ctrl: true, alt: true, shift: true }), s)).toBe(false);
  });
});

describe('resolveShortcuts / validateShortcuts', () => {
  it('falls back to the defaults and lets an empty value disable an action', () => {
    expect(resolveShortcuts(null)).toEqual(DEFAULT_SHORTCUTS);
    expect(resolveShortcuts('not json')).toEqual(DEFAULT_SHORTCUTS);
    expect(resolveShortcuts(JSON.stringify({ save: 'ctrl+enter', copy_ticket_info: '', reply_and_close: 'bad' })))
      .toEqual({ save: 'Ctrl+Enter', copy_ticket_info: '', reply_and_close: 'Ctrl+Alt+P' });
  });

  it('rejects invalid and duplicate combos', () => {
    expect(validateShortcuts({ save: 'Ctrl+S', reply_and_close: 'ctrl+s', copy_ticket_info: 'Alt+C' }))
      .toEqual({ error: 'Ctrl+S is used for both Save and Reply and close.' });
    expect(validateShortcuts({ save: 'S' })).toHaveProperty('error');
    expect(validateShortcuts({ save: 'ctrl+s', reply_and_close: '', copy_ticket_info: 'alt+c' }))
      .toEqual({ map: { save: 'Ctrl+S', reply_and_close: '', copy_ticket_info: 'Alt+C' } });
  });
});
