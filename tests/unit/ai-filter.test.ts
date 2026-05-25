/**
 * Unit tests for the AI filter mode.
 *
 * All external I/O is mocked:
 *   - @/lib/ai/client  (callAi, logAiUsage)
 *   - @/lib/supabase/server (createServerClient)
 *   - next/navigation and next/cache (redirect, revalidatePath)
 */

import { vi, describe, it, expect, beforeEach } from 'vitest';

// ── mocks must be declared before any module imports ─────────

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

import { callAi, logAiUsage } from '@/lib/ai/client';
import { createServerClient } from '@/lib/supabase/server';
import {
  generateSqlFromAi,
  generateSqlFromJson,
  generateSqlFromDefinition,
  normalizeFilterData,
} from '@/lib/filters/ticket-filter';

// ─────────────────────────────────────────────────────────────
// generateSqlFromAi
// ─────────────────────────────────────────────────────────────

describe('generateSqlFromAi', () => {
  it('produces identical SQL to generateSqlFromJson for the same data', () => {
    const data = { status: ['open' as const], urgency: 'high' };
    expect(generateSqlFromAi(data)).toBe(generateSqlFromJson(data));
  });

  it('returns a bare SELECT with no WHERE for empty data', () => {
    const sql = generateSqlFromAi({});
    expect(sql).toMatch(/^SELECT \* FROM agent_tickets/);
    expect(sql).not.toContain('WHERE');
  });

  it('handles status filter', () => {
    const sql = generateSqlFromAi({ status: ['open' as const, 'pending' as const] });
    expect(sql).toContain("status IN ('open', 'pending')");
  });

  it('handles urgency filter', () => {
    const sql = generateSqlFromAi({ urgency: 'critical' });
    expect(sql).toContain("urgency = 'critical'");
  });

  it('omits WHERE when all statuses selected', () => {
    const sql = generateSqlFromAi({ status: ['open', 'pending', 'closed'] as ('open' | 'pending' | 'closed')[] });
    expect(sql).not.toContain('WHERE');
  });
});

// ─────────────────────────────────────────────────────────────
// generateSqlFromDefinition with type='ai'
// ─────────────────────────────────────────────────────────────

describe('generateSqlFromDefinition with type=ai', () => {
  it('does not throw for an ai-type definition', () => {
    const def = {
      name: 'Test',
      type: 'ai' as const,
      data: { urgency: 'critical' },
      sql: '',
      prompt: 'critical tickets',
    };
    expect(() => generateSqlFromDefinition(def)).not.toThrow();
  });

  it('delegates to generateSqlFromAi and includes the data conditions', () => {
    const def = {
      name: 'Test',
      type: 'ai' as const,
      data: { urgency: 'critical' },
      sql: '',
    };
    expect(generateSqlFromDefinition(def)).toContain("urgency = 'critical'");
  });

  it('handles json type unchanged', () => {
    const def = {
      name: 'Default',
      type: 'json' as const,
      data: { urgency: 'low' },
      sql: '',
    };
    expect(generateSqlFromDefinition(def)).toContain("urgency = 'low'");
  });
});

// ─────────────────────────────────────────────────────────────
// Helpers for mocking Supabase and auth
// ─────────────────────────────────────────────────────────────

function makeSettingsQueryMock(rows: { key: string; value: string }[]) {
  return {
    select: vi.fn().mockReturnValue({
      in: vi.fn().mockResolvedValue({ data: rows }),
    }),
  };
}

function makeProfileQueryMock(role: string) {
  return {
    select: vi.fn().mockReturnValue({
      eq: vi.fn().mockReturnValue({
        single: vi.fn().mockResolvedValue({ data: { id: 'agent-uuid', role } }),
      }),
    }),
  };
}

function makeSupabaseMock({
  aiFilterEnabled = 'true',
  role = 'agent',
}: { aiFilterEnabled?: string; role?: string } = {}) {
  const settingsMock = makeSettingsQueryMock([
    { key: 'ai_filter_enabled', value: aiFilterEnabled },
  ]);
  const profileMock = makeProfileQueryMock(role);

  return {
    auth: {
      getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'agent-uuid' } } }),
    },
    from: vi.fn((table: string) => {
      if (table === 'profiles') return profileMock;
      return settingsMock;
    }),
  };
}

// ─────────────────────────────────────────────────────────────
// translateAiFilterPrompt
// ─────────────────────────────────────────────────────────────

describe('translateAiFilterPrompt', () => {
  // Import dynamically so mocks are registered first
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let translateAiFilterPrompt: (...args: any[]) => Promise<{ data: Record<string, unknown>; error?: string }>;

  beforeEach(async () => {
    vi.clearAllMocks();
    const mod = await import('@/lib/actions/ai');
    translateAiFilterPrompt = mod.translateAiFilterPrompt;
  });

  it('returns empty data without calling AI for a blank prompt', async () => {
    (createServerClient as ReturnType<typeof vi.fn>).mockResolvedValue(
      makeSupabaseMock(),
    );
    const fd = new FormData();
    fd.set('prompt', '   ');
    const result = await translateAiFilterPrompt(fd);
    expect(result.data).toEqual({});
    expect(callAi).not.toHaveBeenCalled();
  });

  it('returns an error (not a throw) when ai_filter_enabled is false', async () => {
    (createServerClient as ReturnType<typeof vi.fn>).mockResolvedValue(
      makeSupabaseMock({ aiFilterEnabled: 'false' }),
    );
    const fd = new FormData();
    fd.set('prompt', 'urgent open tickets');
    const result = await translateAiFilterPrompt(fd);
    expect(result.error).toBeTruthy();
    expect(callAi).not.toHaveBeenCalled();
  });

  it('parses a well-formed AI JSON response into TicketFilterData', async () => {
    (createServerClient as ReturnType<typeof vi.fn>).mockResolvedValue(
      makeSupabaseMock(),
    );
    (callAi as ReturnType<typeof vi.fn>).mockResolvedValue({
      content: JSON.stringify({ status: ['open'], urgency: 'high' }),
      tokensUsed: 120,
    });
    const fd = new FormData();
    fd.set('prompt', 'high urgency open tickets');
    const result = await translateAiFilterPrompt(fd);

    expect(result.error).toBeUndefined();
    expect(result.data.status).toEqual(['open']);
    expect(result.data.urgency).toBe('high');
    expect(logAiUsage).toHaveBeenCalledWith('agent-uuid', 'ai_filter', 120);
  });

  it('returns an error string (not a throw) when callAi rejects', async () => {
    (createServerClient as ReturnType<typeof vi.fn>).mockResolvedValue(
      makeSupabaseMock(),
    );
    (callAi as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('timeout'));
    const fd = new FormData();
    fd.set('prompt', 'something');
    const result = await translateAiFilterPrompt(fd);

    expect(result.error).toBeTruthy();
    expect(result.data).toEqual({});
  });

  it('returns an error when callAi returns unparseable JSON', async () => {
    (createServerClient as ReturnType<typeof vi.fn>).mockResolvedValue(
      makeSupabaseMock(),
    );
    (callAi as ReturnType<typeof vi.fn>).mockResolvedValue({
      content: 'Sure! Here are some filter suggestions for you...',
      tokensUsed: 50,
    });
    const fd = new FormData();
    fd.set('prompt', 'something');
    const result = await translateAiFilterPrompt(fd);

    expect(result.error).toBeTruthy();
    expect(result.data).toEqual({});
  });

  it('strips unknown fields from the AI response via normalizeFilterData', async () => {
    (createServerClient as ReturnType<typeof vi.fn>).mockResolvedValue(
      makeSupabaseMock(),
    );
    (callAi as ReturnType<typeof vi.fn>).mockResolvedValue({
      content: JSON.stringify({ urgency: 'low', unknownProp: 'should-vanish' }),
      tokensUsed: 80,
    });
    const fd = new FormData();
    fd.set('prompt', 'low urgency');
    const result = await translateAiFilterPrompt(fd);

    expect(result.data.urgency).toBe('low');
    expect((result.data as Record<string, unknown>)['unknownProp']).toBeUndefined();
  });

  it('rejects invalid status values from the AI response', async () => {
    (createServerClient as ReturnType<typeof vi.fn>).mockResolvedValue(
      makeSupabaseMock(),
    );
    (callAi as ReturnType<typeof vi.fn>).mockResolvedValue({
      content: JSON.stringify({ status: ['open', 'bogus-status'] }),
      tokensUsed: 60,
    });
    const fd = new FormData();
    fd.set('prompt', 'open tickets');
    const result = await translateAiFilterPrompt(fd);

    expect(result.data.status).toEqual(['open']);
  });

  it('logs usage on success', async () => {
    (createServerClient as ReturnType<typeof vi.fn>).mockResolvedValue(
      makeSupabaseMock(),
    );
    (callAi as ReturnType<typeof vi.fn>).mockResolvedValue({
      content: JSON.stringify({ sort: 'sla' }),
      tokensUsed: 200,
    });
    const fd = new FormData();
    fd.set('prompt', 'tickets near SLA breach');
    await translateAiFilterPrompt(fd);

    expect(logAiUsage).toHaveBeenCalledWith('agent-uuid', 'ai_filter', 200);
  });

  it('does not log usage on failure', async () => {
    (createServerClient as ReturnType<typeof vi.fn>).mockResolvedValue(
      makeSupabaseMock(),
    );
    (callAi as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('network error'));
    const fd = new FormData();
    fd.set('prompt', 'anything');
    await translateAiFilterPrompt(fd);

    expect(logAiUsage).not.toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────
// normalizeFilterData (used by translateAiFilterPrompt)
// ─────────────────────────────────────────────────────────────

describe('normalizeFilterData', () => {
  it('handles null / undefined input safely', () => {
    expect(normalizeFilterData(null)).toEqual({});
    expect(normalizeFilterData(undefined)).toEqual({});
  });

  it('coerces legacy single-string status "active" to [open, pending]', () => {
    const result = normalizeFilterData({ status: 'active' });
    expect(result.status).toEqual(['open', 'pending']);
  });

  it('rejects non-string values for string fields', () => {
    const result = normalizeFilterData({ urgency: 42 });
    expect(result.urgency).toBeUndefined();
  });

  it('handles comma-separated tags string', () => {
    const result = normalizeFilterData({ tags: 'billing,refund' });
    expect(result.tags).toEqual(['billing', 'refund']);
  });
});
