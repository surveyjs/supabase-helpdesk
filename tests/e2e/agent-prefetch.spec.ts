import { test, expect, Page } from './fixtures';
import { loginViaForm } from '../helpers/auth';

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

async function openAgentDashboard(page: Page) {
  await loginViaForm(page, 'agent.smith@example.com', 'Password123');
  await page.goto('/agent');
  await expect(page.getByTestId('result-count')).toBeVisible();
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(1000);
}

test.describe('Agent list intent prefetch', () => {
  test('/agent does not prefetch ticket rows, user links or pager links on load', async ({ page }) => {
    const urls = recordPrefetches(page);
    await openAgentDashboard(page);
    // Sanity: the recorder works (top-nav links still prefetch on viewport entry).
    expect(urls.length).toBeGreaterThan(0);
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
