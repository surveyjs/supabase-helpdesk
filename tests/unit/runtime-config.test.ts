import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { toBrowserUrl } from '@/lib/runtime-config';

const SIGNED = '/storage/v1/object/sign/attachments/a.png?token=x';

describe('toBrowserUrl', () => {
  beforeEach(() => {
    vi.stubEnv('APP_URL', 'https://help.example.com');
    vi.stubEnv('SUPABASE_ANON_KEY', 'anon');
  });
  afterEach(() => vi.unstubAllEnvs());

  it('bundled mode: rewrites the internal Kong address to the public URL', () => {
    vi.stubEnv('SUPABASE_URL', '');
    vi.stubEnv('SUPABASE_INTERNAL_URL', 'http://kong:8000');
    expect(toBrowserUrl(`http://kong:8000${SIGNED}`)).toBe(`https://help.example.com${SIGNED}`);
  });

  it('external mode: returns the URL unchanged', () => {
    vi.stubEnv('SUPABASE_URL', 'https://abc.supabase.co');
    expect(toBrowserUrl(`https://abc.supabase.co${SIGNED}`)).toBe(`https://abc.supabase.co${SIGNED}`);
  });

  it('leaves a URL that does not start with the server URL unchanged', () => {
    vi.stubEnv('SUPABASE_URL', '');
    vi.stubEnv('SUPABASE_INTERNAL_URL', 'http://kong:8000');
    expect(toBrowserUrl('https://elsewhere.example.org/x')).toBe('https://elsewhere.example.org/x');
  });
});
