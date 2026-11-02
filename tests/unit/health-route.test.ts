import { describe, it, expect, afterEach, vi } from 'vitest';
import { GET } from '@/app/api/health/route';

describe('GET /api/health', () => {
  afterEach(() => vi.unstubAllEnvs());

  it('reports the image version', async () => {
    vi.stubEnv('HELPDESK_VERSION', '1.4.0');
    expect(await GET().json()).toMatchObject({ status: 'ok', version: '1.4.0' });
  });

  it('reports dev outside an image', async () => {
    vi.stubEnv('HELPDESK_VERSION', undefined);
    expect(await GET().json()).toMatchObject({ version: 'dev' });
  });
});
