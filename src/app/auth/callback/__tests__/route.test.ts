import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const exchangeCodeForSession = vi.fn();

vi.mock('@/lib/supabase/server', () => ({
  createServerClient: async () => ({ auth: { exchangeCodeForSession } }),
  createServiceRoleClient: () => ({}),
}));

import { GET } from '../route';

// In the standalone image Next builds request.url from HOSTNAME/PORT, not from
// the Host header the browser sent.
const INTERNAL = 'http://0.0.0.0:3001';

function request(query: string) {
  return new NextRequest(`${INTERNAL}/auth/callback${query}`, { headers: { host: 'localhost:8080' } });
}

describe('GET /auth/callback', () => {
  beforeEach(() => exchangeCodeForSession.mockReset());

  it('redirects to the next path relative to the browser origin, not the internal one', async () => {
    exchangeCodeForSession.mockResolvedValue({
      data: { user: { id: 'u1', app_metadata: { provider: 'email' }, user_metadata: {} } },
      error: null,
    });

    const res = await GET(request('?code=abc&next=/tickets&keep=1'));

    expect(res.status).toBe(307);
    expect(res.headers.get('location')).toBe('/tickets?keep=1');
  });

  it('redirects errors to /login relative to the browser origin', async () => {
    const res = await GET(request('?error=access_denied&error_description=Nope'));

    expect(res.status).toBe(307);
    const location = res.headers.get('location')!;
    expect(location.startsWith('/login?')).toBe(true);
    const params = new URL(location, 'http://x').searchParams;
    expect(params.get('error')).toBe('auth_callback_error');
    expect(params.get('no_redirect')).toBe('true');
    expect(params.get('error_detail')).toBe('Nope');
  });
});
