import { test as base, expect } from '@playwright/test';

/**
 * Every e2e spec imports `test` from here instead of `@playwright/test`.
 *
 * Next's route announcer (`<next-route-announcer>`) keeps a 1px `role="alert"`
 * div in an open shadow root and, after a client-side navigation, fills it
 * with the new page's `<h1>` text. Playwright pierces open shadow roots, so
 * `getByText('<heading>')` then resolves to two elements (strict-mode
 * violation) and every `getByRole('alert')` matches it. Forcing that one
 * shadow root closed keeps the announcer working for screen readers but out
 * of reach of Playwright's locators.
 */
export const test = base.extend({
  // `provide` is Playwright's `use` (that name trips react-hooks/rules-of-hooks).
  context: async ({ context }, provide) => {
    await context.addInitScript(() => {
      const attachShadow = Element.prototype.attachShadow;
      Element.prototype.attachShadow = function (this: Element, init: ShadowRootInit) {
        return attachShadow.call(
          this,
          this.localName === 'next-route-announcer' ? { ...init, mode: 'closed' } : init,
        );
      };
    });
    await provide(context);
  },
});

export { expect };
export type { Locator, Page } from '@playwright/test';
