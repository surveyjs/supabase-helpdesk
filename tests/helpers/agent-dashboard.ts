import { expect, type Page } from '@playwright/test';

/**
 * Make sure the /agent "Views & Filters" panel is expanded, and wait for its content.
 * From the `xl` breakpoint (Desktop Chrome's 1280 px included) it opens by itself right
 * after hydration, so there only wait; clicking the header there would collapse it.
 * Below xl it starts collapsed and unmounted: click the toggle (retrying until the page
 * has hydrated and the click takes effect), then wait for the content.
 */
export async function openViewsFilters(page: Page) {
  const panel = page.getByTestId('views-and-filters-panel');
  const atXl = (page.viewportSize()?.width ?? 0) >= 1280;
  if (!atXl) {
    const toggle = page.getByRole('button', { name: /Views & Filters:/ });
    await expect(async () => {
      if ((await toggle.getAttribute('aria-expanded')) !== 'true') await toggle.click();
      await expect(toggle).toHaveAttribute('aria-expanded', 'true', { timeout: 1000 });
    }).toPass({ timeout: 10000 });
  }
  await expect(panel).toBeVisible({ timeout: 10000 });
}

/**
 * Click "Apply Filters" and wait until the URL carries the filters. Apply first
 * awaits the setAgentActiveView server action, which revalidates and re-renders
 * /agent, and only then navigates. With four e2e workers on one server that
 * round-trip took up to 14 s, past the 5 s default of toHaveURL.
 */
export async function applyFilters(page: Page, url: RegExp) {
  await page.getByRole('button', { name: 'Apply Filters' }).click();
  await expect(page).toHaveURL(url, { timeout: 20000 });
}
