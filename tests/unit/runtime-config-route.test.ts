import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { GET } from '@/app/runtime-config.js/route';

function evaluate(body: string) {
  const win: { __HELPDESK_CONFIG__?: unknown } = {};
  new Function('window', body)(win);
  return win.__HELPDESK_CONFIG__;
}

describe('GET /runtime-config.js', () => {
  beforeEach(() => {
    vi.stubEnv('APP_URL', 'https://help.example.com');
    vi.stubEnv('SUPABASE_URL', '');
    vi.stubEnv('SUPABASE_INTERNAL_URL', 'http://kong:8000');
    vi.stubEnv('SUPABASE_ANON_KEY', 'anon</script><script>alert(1)');
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'secret-service-key');
  });
  afterEach(() => vi.unstubAllEnvs());

  it('exposes only the public values', async () => {
    const body = await GET().text();
    expect(body).not.toContain('secret-service-key');
    expect(body).not.toContain('kong:8000');
    expect(evaluate(body)).toEqual({
      supabaseUrl: 'https://help.example.com',
      supabaseAnonKey: 'anon</script><script>alert(1)',
      authCookieName: 'sb-help-auth-token',
    });
  });

  it('cannot close a script element', async () => {
    expect(await GET().text()).not.toContain('</script>');
  });

  it('is served as uncached JavaScript', () => {
    const res = GET();
    expect(res.headers.get('content-type')).toBe('text/javascript; charset=utf-8');
    expect(res.headers.get('cache-control')).toBe('no-store');
  });
});
