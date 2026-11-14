import { test, expect, Page } from './fixtures';
import { loginViaForm } from '../helpers/auth';
import { createServiceRoleClient } from '../helpers/supabase';

/**
 * C4: ticket rows, user links and pager links on list pages must not be
 * prefetched on viewport entry (a 20-row page fired dozens of RSC requests);
 * they prefetch on hover / focus / touch instead. Prefetch requests are
 * identified by the `next-router-prefetch` header (`_rsc` is on every RSC
 * request, so it is not a marker). Prefetch only happens in production
 * builds, which is what the e2e server runs.
 */
function recordPrefetches(page: Page): string[] {
  const urls: string[] = [];
  page.on('request', (req) => {
    if (req.headers()['next-router-prefetch']) urls.push(req.url());
  });
  return urls;
}

// More than one page of this spec's own tickets under a unique title prefix, so
// /agent?q=<prefix> always renders a pager (the seed alone fits on one page).
const prefix = `PF-${Math.random().toString(36).slice(2, 8)}`;
const OLD_MS = 25 * 3600_000;

async function openAgentDashboard(page: Page) {
  await loginViaForm(page, 'agent.smith@example.com', 'Password123');
  await page.goto(`/agent?q=${prefix}`);
  await expect(page.getByTestId('result-count')).toBeVisible();
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(1000);
}

test.beforeAll(async () => {
  const svc = createServiceRoleClient();
  const { data: size, error: sErr } = await svc
    .from('app_settings')
    .select('value')
    .eq('key', 'agent_dashboard_page_size')
    .maybeSingle();
  if (sErr) throw new Error(sErr.message);
  const pageSize = parseInt(size?.value ?? '20', 10) || 20;
  const { data: alice, error: aErr } = await svc.from('profiles').select('id').eq('email', 'alice@example.com').single();
  if (aErr) throw new Error(aErr.message);
  const { data: type, error: tErr } = await svc.from('ticket_types').select('id').limit(1).single();
  if (tErr) throw new Error(tErr.message);
  const rows = Array.from({ length: pageSize + 5 }, (_, i) => ({
    title: `${prefix} ticket ${String(i).padStart(3, '0')}`,
    slug: `${prefix.toLowerCase()}-ticket-${i}`,
    creator_id: alice.id,
    type_id: type.id,
    // Older than 24 h: alice's 24 h ticket rate limit is shared with parallel specs.
    created_at: new Date(Date.now() - OLD_MS - i * 60_000).toISOString(),
    updated_at: new Date(Date.now() - OLD_MS - i * 60_000).toISOString(),
  }));
  const { error } = await svc.from('tickets').insert(rows);
  if (error) throw new Error(error.message);
});

test.afterAll(async () => {
  const { error } = await createServiceRoleClient().from('tickets').delete().like('title', `${prefix} %`);
  if (error) throw new Error(error.message);
});

test.describe('Agent list intent prefetch', () => {
  test('/agent does not prefetch ticket rows, user links or pager links on load', async ({ page }) => {
    const urls = recordPrefetches(page);
    await openAgentDashboard(page);
    // Sanity: the recorder works (top-nav links still prefetch on viewport entry),
    // and the page has pager links whose prefetch the `page=` check would catch.
    expect(urls.length).toBeGreaterThan(0);
    await expect(page.getByRole('navigation', { name: 'Pagination' }).locator('a[href*="page="]').first()).toBeAttached();
    const offenders = urls.filter((u) => /\/tickets\/\d/.test(u) || /\/agent\/users\//.test(u) || /[?&]page=/.test(u));
    expect(offenders, offenders.join('\n')).toEqual([]);
  });

  test('hovering a ticket row prefetches that ticket', async ({ page }) => {
    const urls = recordPrefetches(page);
    await openAgentDashboard(page);
    const link = page.getByTestId('agent-ticket-table').locator('a[href^="/tickets/"]').first();
    await expect(link).toBeVisible();
    const href = (await link.getAttribute('href'))!;
    const path = href.split('?')[0];
    expect(urls.filter((u) => u.includes(path))).toEqual([]);
    await link.hover();
    await expect.poll(() => urls.some((u) => u.includes(path)), { timeout: 5000 }).toBe(true);
  });

  test('focusing a pager link prefetches it', async ({ page }) => {
    const urls = recordPrefetches(page);
    await openAgentDashboard(page);
    const pager = page.getByRole('navigation', { name: 'Pagination' }).locator('a[href*="page="]').first();
    await expect(pager).toBeAttached();
    const href = (await pager.getAttribute('href'))!;
    const query = href.split('?')[1].split('&').find((p) => p.startsWith('page='))!;
    expect(urls.filter((u) => u.includes(query))).toEqual([]);
    await pager.focus();
    await expect.poll(() => urls.some((u) => u.includes(query)), { timeout: 5000 }).toBe(true);
  });
});
