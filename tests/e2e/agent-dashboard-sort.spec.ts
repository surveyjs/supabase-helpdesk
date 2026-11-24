import { test, expect } from './fixtures';
import { createServiceRoleClient } from '../helpers/supabase';
import { loginViaForm } from '../helpers/auth';

// #7: Auto ranking and oldest-first sorts on /agent.

const MARK = `SortMode${Date.now()}${Math.floor(Math.random() * 1000)}`;
const URGENT = `E2E ${MARK} urgent`;
const ENTERPRISE = `E2E ${MARK} enterprise`;
const PLAIN = `E2E ${MARK} plain`;

test.describe('Agent dashboard sort modes', () => {
  test.beforeAll(async () => {
    const admin = createServiceRoleClient();
    const { data: alice } = await admin.from('profiles').select('id').eq('email', 'alice@example.com').single();
    const { data: type } = await admin.from('ticket_types').select('id').limit(1).single();
    const base = { creator_id: alice!.id, type_id: type!.id, severity: 'low' };
    const { error } = await admin.from('tickets').insert([
      { ...base, title: URGENT, slug: `e2e-${MARK.toLowerCase()}-u`, urgency: 'critical', custom_fields: {}, updated_at: '2026-03-03T00:00:00Z' },
      { ...base, title: ENTERPRISE, slug: `e2e-${MARK.toLowerCase()}-e`, urgency: 'low', custom_fields: { 'License Status': 'Enterprise' }, updated_at: '2026-03-01T00:00:00Z' },
      { ...base, title: PLAIN, slug: `e2e-${MARK.toLowerCase()}-p`, urgency: 'low', custom_fields: {}, updated_at: '2026-03-02T00:00:00Z' },
    ]);
    if (error) throw new Error(error.message);
  });

  test.afterAll(async () => {
    const admin = createServiceRoleClient();
    await admin.from('tickets').delete().in('title', [URGENT, ENTERPRISE, PLAIN]);
  });

  async function order(page: import('@playwright/test').Page, sort: string) {
    await page.goto(`/agent?q=${MARK}&sort=${sort}`);
    const rows = page.getByTestId('agent-ticket-table').locator('tbody tr');
    await expect(rows).toHaveCount(3, { timeout: 20000 });
    return (await rows.locator('td:nth-child(2) a').allTextContents()).map((t) => t.trim());
  }

  test('Auto: Enterprise first, then priority, then recent; oldest-first reverses Last Modified', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await loginViaForm(page, 'agent.smith@example.com');
    expect(await order(page, 'auto')).toEqual([ENTERPRISE, URGENT, PLAIN]);
    expect(await order(page, 'updated')).toEqual([URGENT, PLAIN, ENTERPRISE]);
    expect(await order(page, 'updated_asc')).toEqual([ENTERPRISE, PLAIN, URGENT]);
  });
});
