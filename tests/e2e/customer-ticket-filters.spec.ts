import { test, expect } from './fixtures';
import { createServiceRoleClient } from '../helpers/supabase';
import { loginViaForm } from '../helpers/auth';

// #120: customers can filter My Tickets and Public Tickets by product (category).

const SUFFIX = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
const TITLE_A = `E2E Product Filter A ${SUFFIX}`;
const TITLE_B = `E2E Product Filter B ${SUFFIX}`;

test.describe('Customer ticket product filter', () => {
  let catA: { id: string; name: string };

  test.beforeAll(async () => {
    const admin = createServiceRoleClient();
    const { data: cats, error: cErr } = await admin.from('categories').select('id, name').order('name').limit(2);
    if (cErr) throw new Error(cErr.message);
    if (!cats || cats.length < 2) throw new Error('needs two seeded categories');
    catA = cats[0];
    const { data: alice } = await admin.from('profiles').select('id').eq('email', 'alice@example.com').single();
    const { data: type } = await admin.from('ticket_types').select('id').limit(1).single();
    const { error } = await admin.from('tickets').insert([
      { title: TITLE_A, slug: `e2e-product-filter-a-${SUFFIX}`, creator_id: alice!.id, type_id: type!.id, category_id: cats[0].id, is_private: false },
      { title: TITLE_B, slug: `e2e-product-filter-b-${SUFFIX}`, creator_id: alice!.id, type_id: type!.id, category_id: cats[1].id, is_private: false },
    ]);
    if (error) throw new Error(error.message);
  });

  test.afterAll(async () => {
    const admin = createServiceRoleClient();
    await admin.from('tickets').delete().in('title', [TITLE_A, TITLE_B]);
  });

  test('My Tickets: choosing a product narrows the list and keeps the search', async ({ page }) => {
    await loginViaForm(page, 'alice@example.com');
    await page.goto(`/tickets?q=${encodeURIComponent('Product Filter')}`);
    await expect(page.getByText(TITLE_A)).toBeVisible();
    await expect(page.getByText(TITLE_B)).toBeVisible();

    await page.getByTestId('category-filter').selectOption(catA.id);
    await expect(page).toHaveURL(new RegExp(`category=${catA.id}`));
    await expect(page).toHaveURL(/q=Product\+Filter|q=Product%20Filter/);
    await expect(page.getByText(TITLE_A)).toBeVisible();
    await expect(page.getByText(TITLE_B)).toHaveCount(0);

    // The status tabs keep the product filter.
    await page.getByRole('link', { name: 'Open', exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`category=${catA.id}`));
  });

  test('Public Tickets: product filter and the category shown on each row', async ({ page }) => {
    await loginViaForm(page, 'bob@example.com');
    await page.goto(`/tickets/public?category=${catA.id}&q=${encodeURIComponent('Product Filter')}`);
    await expect(page.getByTestId('category-filter')).toHaveValue(catA.id);
    const row = page.getByRole('listitem').filter({ hasText: TITLE_A });
    await expect(row).toBeVisible();
    await expect(row.getByTestId('ticket-category')).toHaveText(catA.name);
    await expect(page.getByText(TITLE_B)).toHaveCount(0);

    await page.getByTestId('category-filter').selectOption('');
    await expect(page.getByText(TITLE_B)).toBeVisible();
  });
});
