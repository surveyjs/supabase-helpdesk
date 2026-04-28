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
 * Add (toggle) a value in a SurveyJS tagbox by typing into the filter input
 * and pressing Enter. This is far more reliable than clicking list items
 * because it goes through SurveyJS's own keyboard handler and avoids
 * popup/portal/visibility races. Falls back to a click on the matching list
 * item if the keyboard path doesn't take.
 */
export async function addSurveyTag(
  scope: Page | Locator,
  name: string,
  optionText: string | RegExp,
): Promise<void> {
  const q = question(scope, name);
  const page = getPage(scope);
  const optionString =
    typeof optionText === 'string' ? optionText : optionText.source;

  const tryKeyboard = async (): Promise<boolean> => {
    await page.keyboard.press('Escape').catch(() => {});
    await page.waitForTimeout(150);

    const filterInput = q
      .locator('input.sd-tagbox__filter-string-input, input.sd-dropdown__filter-string-input')
      .first();
    if (!(await filterInput.count())) return false;

    try {
      await filterInput.scrollIntoViewIfNeeded().catch(() => {});
      await filterInput.click({ force: true, timeout: 3000 });
      await filterInput.fill('');
      await filterInput.type(optionString, { delay: 30 });
    } catch {
      return false;
    }

    // Wait for popup to filter the list down.
    await page.waitForTimeout(300);

    // If the option is highlighted/focused, Enter selects it. SurveyJS auto-
    // focuses the first match.
    try {
      await filterInput.press('Enter');
    } catch {
      return false;
    }
    await page.waitForTimeout(150);
    await page.keyboard.press('Escape').catch(() => {});
    // Clear the filter so subsequent operations don't see lingering text.
    try {
      await filterInput.fill('');
    } catch { /* ignore */ }
    return true;
  };

  const tryClick = async (): Promise<boolean> => {
    await page.keyboard.press('Escape').catch(() => {});
    await page.waitForTimeout(150);

    const chevron = q
      .locator('.sd-dropdown_chevron-button, .sd-dropdown__chevron-button')
      .first();
    let opened = false;
    if (await chevron.count()) {
      try {
        await chevron.scrollIntoViewIfNeeded().catch(() => {});
        await chevron.click({ force: true, timeout: 3000 });
        opened = true;
      } catch { /* fall through */ }
    }
    if (!opened) {
      const trigger = q
        .locator('.sd-tagbox, .sd-dropdown, [role="combobox"]')
        .first();
      try {
        await trigger.waitFor({ state: 'visible', timeout: 5000 });
        await trigger.scrollIntoViewIfNeeded().catch(() => {});
        await trigger.click({ force: true });
      } catch {
        return false;
      }
    }

    const option = page
      .locator('.sv-popup__container .sv-list__item')
      .filter({ hasText: optionText, visible: true })
      .first();
    try {
      await option.waitFor({ state: 'visible', timeout: 8000 });
    } catch {
      return false;
    }
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

  // Prefer keyboard path; fall back to click. Each path is retried.
  for (let i = 0; i < 3; i++) {
    try {
      if (await tryKeyboard()) return;
    } catch { /* swallow */ }
    try {
      if (await tryClick()) return;
    } catch { /* swallow */ }
  }
  throw new Error(`Failed to toggle tagbox option "${optionText}" on field "${name}"`);
}

/**
 * Toggle a SurveyJS boolean question rendered as a checkbox. The real
 * `<input type="checkbox">` is visually hidden and a styled decorator span
 * intercepts pointer events, so click the wrapping `<label>` instead.
 */
export async function toggleSurveyCheckbox(
  scope: Page | Locator,
  name: string,
): Promise<void> {
  const q = question(scope, name);
  const label = q.locator('label.sd-checkbox__label, label.sd-selectbase__label, label').first();
  if (await label.count()) {
    await label.scrollIntoViewIfNeeded().catch(() => {});
    await label.click();
    return;
  }
  // Fallback: force-click the hidden input.
  await q.locator('input[type="checkbox"]').first().click({ force: true });
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
