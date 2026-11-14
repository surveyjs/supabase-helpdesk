import { vi, describe, it, expect, beforeEach } from 'vitest';

vi.mock('@/lib/ai/client', () => ({
  callAi: vi.fn(),
  callAiText: vi.fn(),
  logAiUsage: vi.fn(),
  getAiConfig: vi.fn(),
}));
vi.mock('@/lib/supabase/server', () => ({
  createServerClient: vi.fn(),
  createServiceRoleClient: vi.fn(),
}));
vi.mock('next/navigation', () => ({ redirect: vi.fn() }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

import { createServerClient, createServiceRoleClient } from '@/lib/supabase/server';
import { saveAiSettings } from '@/lib/actions/ai';

let updates: { key: string; value: string }[];
let audits: { details: { updated_keys: string[] } }[];
let rpc: ReturnType<typeof vi.fn>;

function setup(role: string) {
  updates = [];
  audits = [];
  rpc = vi.fn().mockResolvedValue({ error: null });
  vi.mocked(createServiceRoleClient).mockReturnValue({ rpc } as never);
  const client = {
    auth: { getUser: async () => ({ data: { user: { id: 'u1' } } }) },
    from: (table: string) => {
      if (table === 'profiles') {
        const chain = {
          select: () => chain,
          eq: () => chain,
          single: async () => ({ data: { id: 'u1', role }, error: null }),
        };
        return chain;
      }
      if (table === 'app_settings') {
        return {
          update: ({ value }: { value: string }) => ({
            eq: async (_c: string, key: string) => {
              updates.push({ key, value });
              return { error: null };
            },
          }),
        };
      }
      return {
        insert: async (row: { details: { updated_keys: string[] } }) => {
          audits.push(row);
          return { error: null };
        },
      };
    },
  };
  vi.mocked(createServerClient).mockResolvedValue(client as never);
}

function fd(obj: Record<string, string>) {
  const f = new FormData();
  for (const [k, v] of Object.entries(obj)) f.set(k, v);
  return f;
}
const val = (k: string) => updates.find((u) => u.key === k)?.value;

describe('saveAiSettings', () => {
  beforeEach(() => setup('admin'));

  it('only updates keys present in FormData', async () => {
    await saveAiSettings(fd({ ai_filter_enabled: 'true' }));
    expect(updates).toEqual([{ key: 'ai_filter_enabled', value: 'true' }]);
  });

  it('absent boolean is not reset', async () => {
    await saveAiSettings(fd({ ai_model: 'gpt-4o' }));
    expect(updates.filter((u) => u.key.endsWith('_enabled'))).toEqual([]);
    expect(val('ai_model')).toBe('gpt-4o');
  });

  it('explicit false is written', async () => {
    await saveAiSettings(fd({ ai_filter_enabled: 'false' }));
    expect(val('ai_filter_enabled')).toBe('false');
  });

  it("legacy 'on' still means true", async () => {
    await saveAiSettings(fd({ ai_filter_enabled: 'on' }));
    expect(val('ai_filter_enabled')).toBe('true');
  });

  it('validation preserved', async () => {
    await saveAiSettings(fd({
      ai_request_timeout: '9999',
      ai_provider: 'bogus',
      ai_duplicate_detection_threshold: 'extreme',
    }));
    expect(val('ai_request_timeout')).toBe('300');
    expect(val('ai_provider')).toBeUndefined();
    expect(val('ai_duplicate_detection_threshold')).toBeUndefined();
  });

  it('blank api key does not touch vault', async () => {
    await saveAiSettings(fd({ ai_api_key: '  ', ai_model: 'm' }));
    expect(rpc).not.toHaveBeenCalled();
  });

  it('non-blank api key is stored in vault', async () => {
    await saveAiSettings(fd({ ai_api_key: 'sk-test' }));
    expect(rpc).toHaveBeenCalledWith('store_ai_api_key', { key_value: 'sk-test' });
  });

  it('audit updated_keys equals written keys', async () => {
    await saveAiSettings(fd({ ai_model: 'm', ai_filter_enabled: 'true', ai_provider: 'bogus' }));
    expect(audits).toHaveLength(1);
    expect(audits[0].details.updated_keys.sort()).toEqual(updates.map((u) => u.key).sort());
    expect(audits[0].details.updated_keys.sort()).toEqual(['ai_filter_enabled', 'ai_model']);
  });

  it('no-op FormData writes nothing', async () => {
    const res = await saveAiSettings(fd({ ai_provider: 'bogus' }));
    expect(res).toEqual({});
    expect(updates).toEqual([]);
    expect(audits).toEqual([]);
  });

  it("provider '' is written as unconfigured", async () => {
    await saveAiSettings(fd({ ai_provider: '' }));
    expect(updates).toEqual([{ key: 'ai_provider', value: '' }]);
  });

  it("text fields '' are written as empty", async () => {
    await saveAiSettings(fd({ ai_model: '', ai_custom_endpoint_url: '' }));
    expect(val('ai_model')).toBe('');
    expect(val('ai_custom_endpoint_url')).toBe('');
  });

  it("numeric '' falls back to each field's default", async () => {
    await saveAiSettings(fd({
      ai_request_timeout: '',
      ai_auto_categorize_min_body_length: '',
      ai_suggested_reply_context_window: '',
      ai_suggested_reply_rate_limit: '',
      ai_ticket_summary_min_posts: '',
    }));
    expect(val('ai_request_timeout')).toBe('60');
    expect(val('ai_auto_categorize_min_body_length')).toBe('20');
    expect(val('ai_suggested_reply_context_window')).toBe('20');
    expect(val('ai_suggested_reply_rate_limit')).toBe('20');
    expect(val('ai_ticket_summary_min_posts')).toBe('10');
  });

  it("threshold '' is ignored and boolean '' means false", async () => {
    await saveAiSettings(fd({ ai_duplicate_detection_threshold: '', ai_filter_enabled: '' }));
    expect(val('ai_duplicate_detection_threshold')).toBeUndefined();
    expect(val('ai_filter_enabled')).toBe('false');
  });

  it('a vault failure is returned as an error, after the settings are written and audited', async () => {
    rpc.mockImplementation(async (name: string) =>
      name === 'store_ai_api_key' ? { error: { message: 'vault down' } } : { error: null });
    const res = await saveAiSettings(fd({ ai_api_key: 'sk-x', ai_model: 'm' }));
    expect(res.error).toMatch(/API key could not be stored/);
    expect(val('ai_model')).toBe('m');
    expect(audits).toHaveLength(1);
  });

  it('non-admin gets Forbidden', async () => {
    setup('user');
    const res = await saveAiSettings(fd({ ai_model: 'm' }));
    expect(res).toEqual({ error: 'Forbidden' });
    expect(updates).toEqual([]);
  });
});
