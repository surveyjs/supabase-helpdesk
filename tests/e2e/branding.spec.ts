import { test, expect } from './fixtures';
import { createServiceRoleClient } from '../helpers/supabase';
import { loginViaForm } from '../helpers/auth';

// #2: product name, logo and primary colour from Admin > Appearance.
// Changes the whole instance's look: runs in global-settings.

const KEY = 'branding';

test.describe('Appearance (branding)', () => {
  test.describe.configure({ mode: 'serial' });
  let original: string | null = null;

  test.beforeAll(async () => {
    const { data } = await createServiceRoleClient().from('app_settings').select('value').eq('key', KEY).maybeSingle();
    original = data?.value ?? null;
  });

  test.afterAll(async () => {
    const admin = createServiceRoleClient();
    if (original === null) await admin.from('app_settings').delete().eq('key', KEY);
    else await admin.from('app_settings').upsert({ key: KEY, value: original });
  });

  test('the admin sets name, logo and colour; every page uses them; a bad logo URL is refused', async ({ page }) => {
    await loginViaForm(page, 'admin@example.com');
    await page.goto('/admin/appearance');
    const form = page.getByTestId('appearance-survey-form');
    const q = (name: string) => form.locator(`.sd-question[data-name="${name}"] input`);

    await q('logo_url').fill('http://insecure.example/logo.png');
    await form.getByRole('button', { name: 'Save' }).click();
    await expect(form).toContainText('Logo URL must start with https://');

    await q('product_name').fill('Acme Support');
    await q('logo_url').fill('/favicon.ico');
    await q('primary_color').fill('#19b394');
    await form.getByRole('button', { name: 'Save' }).click();
    await expect(form).toContainText('Appearance saved.');

    await page.goto('/tickets');
    await expect(page.getByTestId('brand-link')).toHaveText('Acme Support');
    await expect(page.getByTestId('brand-logo')).toHaveAttribute('src', '/favicon.ico');
    await expect(page).toHaveTitle('Acme Support');
    const blue600 = await page.evaluate(() =>
      getComputedStyle(document.documentElement).getPropertyValue('--color-blue-600').trim(),
    );
    expect(blue600).toBe('#19b394');
  });

  test('signed-out pages use the branding too', async ({ page }) => {
    await page.context().clearCookies();
    await page.goto('/login?no_redirect=true');
    await expect(page).toHaveTitle('Acme Support');
  });
});
