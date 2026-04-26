import type { Locator, Page } from '@playwright/test';

function getPage(scope: Page | Locator): Page {
  // A Locator has a .page() method; a Page has neither.
  // Use duck typing.
  const maybe = scope as unknown as { page?: () => Page };
  return typeof maybe.page === 'function' ? maybe.page() : (scope as Page);
}

function question(scope: Page | Locator, name: string): Locator {
  return scope.locator(`.sd-question[data-name="${name}"]`);
}

/**
 * Open a SurveyJS dropdown question and pick an option from the popup list.
 * Works for `dropdown` and `tagbox` question types in survey-react-ui v2.
 */
export async function selectSurveyDropdown(
  scope: Page | Locator,
  name: string,
  optionText: string | RegExp,
): Promise<void> {
  const q = question(scope, name);
  // Make sure no leftover popup is intercepting clicks.
  const page = getPage(scope);
  await page.keyboard.press('Escape').catch(() => {});

  // The clickable trigger inside a SurveyJS v2 dropdown question. Prefer the
  // chevron button so we never accidentally hit the clear (X) icon.
  const trigger = q
    .locator('.sd-dropdown__chevron-button, .sd-dropdown_chevron-button, .sd-dropdown, [role="combobox"]')
    .first();
  await trigger.waitFor({ state: 'visible', timeout: 10000 });
  await trigger.scrollIntoViewIfNeeded().catch(() => {});
  await trigger.click({ force: true });

  // Multiple popup containers exist (one per dropdown). Pick the visible one.
  const visiblePopup = page.locator('.sv-popup__container').filter({ visible: true }).first();
  await visiblePopup.waitFor({ state: 'visible', timeout: 10000 });
  const option = visiblePopup.locator('.sv-list__item').filter({ hasText: optionText }).first();
  await option.waitFor({ state: 'visible', timeout: 10000 });
  await option.scrollIntoViewIfNeeded().catch(() => {});
  await option.click({ force: true });
  // Some popups stay open (tagbox); ensure subsequent reads aren't blocked by overlay.
  await page.keyboard.press('Escape').catch(() => {});
}

/**
 * Add a value to a SurveyJS tagbox by selecting from the popup list.
 * Tagbox popups can render options outside the viewport, so we open the
 * dropdown manually and click via dispatchEvent to bypass actionability
 * checks. If clicking an already-selected option fails (toggle-off), retry
 * once after re-opening the popup.
 */
export async function addSurveyTag(
  scope: Page | Locator,
  name: string,
  optionText: string | RegExp,
): Promise<void> {
  const q = question(scope, name);
  const page = getPage(scope);

  const openAndClick = async (): Promise<boolean> => {
    await page.keyboard.press('Escape').catch(() => {});

    const trigger = q
      .locator('.sd-tagbox, .sd-dropdown, [role="combobox"]')
      .first();
    await trigger.waitFor({ state: 'visible', timeout: 10000 });
    await trigger.scrollIntoViewIfNeeded().catch(() => {});
    await trigger.click({ force: true });

    const popup = page.locator('.sv-popup__container').filter({ visible: true }).first();
    await popup.waitFor({ state: 'visible', timeout: 10000 });

    const option = popup.locator('.sv-list__item').filter({ hasText: optionText }).first();
    await option.waitFor({ state: 'attached', timeout: 10000 });
    await option
      .evaluate((el) => (el as HTMLElement).scrollIntoView({ block: 'center' }))
      .catch(() => {});

    try {
      await option.dispatchEvent('click', undefined, { timeout: 5000 });
      await page.keyboard.press('Escape').catch(() => {});
      return true;
    } catch {
      return false;
    }
  };

  if (await openAndClick()) return;
  // Retry once
  if (await openAndClick()) return;
  throw new Error(`Failed to toggle tagbox option "${optionText}" on field "${name}"`);
}

/**
 * Toggle a SurveyJS boolean question rendered as a checkbox.
 */
export async function toggleSurveyCheckbox(
  scope: Page | Locator,
  name: string,
): Promise<void> {
  await question(scope, name).locator('input[type="checkbox"]').first().click();
}

/**
 * Click the "clear" (X) button on a SurveyJS dropdown question to reset it
 * to an empty value. Useful when the empty-value option in the popup may not
 * reliably fire `onValueChanged`.
 */
export async function clearSurveyDropdown(
  scope: Page | Locator,
  name: string,
): Promise<void> {
  const q = question(scope, name);
  const clearBtn = q
    .locator('.sd-dropdown_clean-button, .sd-action--clear, button[aria-label*="Clear" i]')
    .first();
  await clearBtn.scrollIntoViewIfNeeded().catch(() => {});
  await clearBtn.click({ force: true });
}

/**
 * Wait for the autosave status indicator next to the sidebar survey to either
 * report success or fall back to a small fixed delay.
 */
export async function waitForSidebarSurveyAutosave(page: Page): Promise<void> {
  const status = page.getByTestId('ticket-sidebar-survey-status');
  // Wait for an explicit "Saved" or "Failed" state, with a generous timeout.
  await status
    .filter({ hasText: /Saved|Failed/ })
    .first()
    .waitFor({ timeout: 10000 })
    .catch(() => {});
}
