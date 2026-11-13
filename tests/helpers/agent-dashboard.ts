import { expect, type Page } from '@playwright/test';

/**
 * Make sure the /agent "Views & Filters" panel is expanded. It starts expanded
 * at the `xl` breakpoint (left column, Desktop Chrome's 1280 px included) and
 * collapsed (and unmounted) below it, so only click the header when the panel is hidden.
 */
export async function openViewsFilters(page: Page) {
  const panel = page.getByTestId('views-and-filters-panel');
  // At xl the panel mounts right after hydration; wait for it instead of clicking
  // the header, which would collapse it.
  const atXl = (page.viewportSize()?.width ?? 0) >= 1280;
  if (atXl) await panel.waitFor({ state: 'visible', timeout: 10000 }).catch(() => undefined);
  if (!(await panel.isVisible().catch(() => false))) {
    await page.getByRole('button', { name: /Views & Filters:/ }).click();
  }
  await expect(panel).toBeVisible({ timeout: 10000 });
}
