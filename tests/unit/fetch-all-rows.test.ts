import { describe, it, expect, vi } from 'vitest';

vi.mock('@/lib/supabase/server', () => ({ createServiceRoleClient: vi.fn() }));

import { fetchAllRows } from '@/lib/queries/reports';

function fakeQuery(total: number) {
  const calls: Array<[number, number]> = [];
  const page = async (from: number, to: number) => {
    calls.push([from, to]);
    const rows = [];
    for (let i = from; i <= Math.min(to, total - 1); i++) rows.push({ id: i });
    return { data: rows };
  };
  return { page, calls };
}

describe('fetchAllRows', () => {
  it('pages until a short page (1000, 1000, 5 = 2005 rows)', async () => {
    const { page, calls } = fakeQuery(2005);
    const rows = await fetchAllRows(page);
    expect(rows).toHaveLength(2005);
    expect(calls).toEqual([[0, 999], [1000, 1999], [2000, 2999]]);
  });

  it('handles empty results and null data', async () => {
    expect(await fetchAllRows(async () => ({ data: null }))).toEqual([]);
  });

  it('does one extra request when the total is an exact multiple of the page size', async () => {
    const { page, calls } = fakeQuery(1000);
    expect(await fetchAllRows(page)).toHaveLength(1000);
    expect(calls).toHaveLength(2);
  });
});
