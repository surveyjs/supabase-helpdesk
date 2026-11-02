import { describe, it, expect } from 'vitest';
import { resolveSupabaseEnv } from './env.mjs';

const base = {
  APP_URL: 'https://help.example.com',
  SUPABASE_ANON_KEY: 'anon',
  SUPABASE_SERVICE_ROLE_KEY: 'svc',
};

describe('resolveSupabaseEnv', () => {
  it('external Supabase: browser and server both use SUPABASE_URL', () => {
    const c = resolveSupabaseEnv({ ...base, SUPABASE_URL: 'https://abc.supabase.co/', SUPABASE_INTERNAL_URL: 'http://kong:8000' });
    expect(c.browserSupabaseUrl).toBe('https://abc.supabase.co');
    expect(c.serverSupabaseUrl).toBe('https://abc.supabase.co');
  });

  it('bundled stack: browser uses APP_URL, server uses SUPABASE_INTERNAL_URL', () => {
    const c = resolveSupabaseEnv({ ...base, SUPABASE_INTERNAL_URL: 'http://kong:8000/' });
    expect(c.browserSupabaseUrl).toBe('https://help.example.com');
    expect(c.serverSupabaseUrl).toBe('http://kong:8000');
  });

  it('derives the auth cookie name from the browser URL so both sides share the session', () => {
    expect(resolveSupabaseEnv({ ...base, SUPABASE_INTERNAL_URL: 'http://kong:8000' }).authCookieName)
      .toBe('sb-help-auth-token');
  });

  it('keeps the cookie name current instances already use', () => {
    expect(resolveSupabaseEnv({ ...base, SUPABASE_URL: 'http://127.0.0.1:54321' }).authCookieName)
      .toBe('sb-127-auth-token');
  });

  it('names every missing variable', () => {
    expect(() => resolveSupabaseEnv({})).toThrow(/APP_URL[\s\S]*SUPABASE_URL[\s\S]*SUPABASE_ANON_KEY/);
  });

  it('treats blank values as missing', () => {
    expect(() => resolveSupabaseEnv({ ...base, SUPABASE_URL: '  ' })).toThrow(/SUPABASE_URL/);
  });

  it('names the variable when a URL is invalid', () => {
    expect(() => resolveSupabaseEnv({ ...base, APP_URL: 'not a url', SUPABASE_INTERNAL_URL: 'http://kong:8000' }))
      .toThrow('Invalid URL in APP_URL: not a url');
    expect(() => resolveSupabaseEnv({ ...base, SUPABASE_URL: 'abc.supabase.co' }))
      .toThrow('Invalid URL in SUPABASE_URL: abc.supabase.co');
  });

  it('rejects an APP_URL with a path when Supabase is served on the same domain', () => {
    expect(() => resolveSupabaseEnv({ ...base, APP_URL: 'https://corp.example.com/helpdesk', SUPABASE_INTERNAL_URL: 'http://kong:8000' }))
      .toThrow(/APP_URL must not contain a path/);
  });
});
