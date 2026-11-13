import { test, expect, Page } from './fixtures';
import { createServiceRoleClient } from '../helpers/supabase';
import { loginViaForm } from '../helpers/auth';

const SEED_PASSWORD = 'Password123';
const MAX_SHIFT_PX = 2;
const CHUNK_DELAY_MS = 1500;

/** Hold every JS chunk back so the editor's lazy chunk loads well after first paint. */
async function delayChunks(page: Page): Promise<void> {
  await page.route('**/_next/static/chunks/**', (route) => {
    setTimeout(() => {
      route.continue().catch(() => {});
    }, CHUNK_DELAY_MS);
  });
}

async function top(page: Page, selector: string): Promise<number> {
  const box = await page.locator(selector).first().boundingBox();
  if (!box) throw new Error(`no bounding box for ${selector}`);
  return box.y;
}

async function bottom(page: Page, selector: string): Promise<number> {
  const box = await page.locator(selector).first().boundingBox();
  if (!box) throw new Error(`no bounding box for ${selector}`);
  return box.y + box.height;
}

async function expectCreateFormStable(page: Page): Promise<void> {
  await page.goto('/tickets/new');
  const create = '[data-testid="create-ticket-btn"]';
  await expect(page.getByTestId('markdown-editor-placeholder').first()).toBeVisible({
    timeout: 15000,
  });
  await expect(page.locator('.rc-md-editor')).toHaveCount(0);
  await expect(page.locator(create)).toBeVisible();
  const y0 = await top(page, create);
  await expect(page.locator('.rc-md-editor').first()).toBeVisible({ timeout: 20000 });
  const y1 = await top(page, create);
  console.log(`create button y: before=${y0} after=${y1} delta=${y1 - y0}`);
  expect(Math.abs(y1 - y0)).toBeLessThanOrEqual(MAX_SHIFT_PX);
}

test.describe('Markdown editor layout shift', () => {
  test('create form does not shift when the Description editor mounts', async ({ page }) => {
    await loginViaForm(page, 'alice@example.com', SEED_PASSWORD);
    await delayChunks(page);
    await expectCreateFormStable(page);
  });

  test.describe('custom min height', () => {
    const USER_ID = '00000000-0000-0000-0000-000912000001';
    const EMAIL = 'editor-shift-e2e@test.local';

    async function deleteUser(): Promise<void> {
      const svc = createServiceRoleClient();
      // profiles → auth.users has no cascade: drop the profile first.
      const { error } = await svc.from('profiles').delete().eq('id', USER_ID);
      if (error) throw new Error(`delete profile: ${error.message}`);
      const { error: authErr } = await svc.auth.admin.deleteUser(USER_ID);
      if (authErr && authErr.status !== 404) throw new Error(`deleteUser: ${authErr.message}`);
    }

    test.beforeAll(async () => {
      await deleteUser();
      const svc = createServiceRoleClient();
      const { error } = await svc.auth.admin.createUser({
        id: USER_ID,
        email: EMAIL,
        password: SEED_PASSWORD,
        email_confirm: true,
        user_metadata: { display_name: 'Editor Shift E2E' },
      });
      if (error) throw new Error(`createUser: ${error.message}`);
      const { error: pErr } = await svc.from('profiles').upsert({
        id: USER_ID,
        email: EMAIL,
        display_name: 'Editor Shift E2E',
        role: 'user',
        editor_view_mode: 'both',
        editor_min_height_px: 350,
        editor_max_height_px: 600,
      });
      if (pErr) throw new Error(`upsert profile: ${pErr.message}`);
    });

    test.afterAll(async () => {
      await deleteUser();
    });

    test('create form does not shift with a 350 px editor min height', async ({ page }) => {
      await loginViaForm(page, EMAIL, SEED_PASSWORD);
      await delayChunks(page);
      await expectCreateFormStable(page);
      const h = await page
        .locator('.rc-md-editor')
        .first()
        .evaluate((el) => el.getBoundingClientRect().height);
      expect(h).toBeGreaterThanOrEqual(346);
      expect(h).toBeLessThanOrEqual(354);
    });
  });

  test('ticket reply editor does not shift when it mounts', async ({ page }) => {
    const svc = createServiceRoleClient();
    const { data: alice, error: aErr } = await svc
      .from('profiles')
      .select('id')
      .eq('email', 'alice@example.com')
      .single();
    if (aErr) throw new Error(aErr.message);
    const { data: post, error } = await svc
      .from('posts')
      .select('ticket_id')
      .eq('author_id', alice.id)
      .eq('is_original', true)
      .limit(1)
      .single();
    if (error) throw new Error(error.message);
    const { data: ticket, error: tErr } = await svc
      .from('tickets')
      .select('id, slug')
      .eq('id', post.ticket_id)
      .single();
    if (tErr) throw new Error(tErr.message);

    await loginViaForm(page, 'alice@example.com', SEED_PASSWORD);
    await page.goto(`/tickets/${ticket.id}/${ticket.slug}`);
    await expect(page.getByTestId('main-reply-btn')).toBeVisible({ timeout: 15000 });
    await delayChunks(page);
    await page.getByTestId('main-reply-btn').click();

    const panel = '[data-testid="main-reply-panel"]';
    await expect(page.getByTestId('main-reply-panel')).toBeVisible();
    await expect(
      page.locator(`${panel} [data-testid="markdown-editor-placeholder"]`),
    ).toBeVisible({ timeout: 15000 });
    await expect(page.locator(`${panel} .rc-md-editor`)).toHaveCount(0);
    const b0 = await bottom(page, panel);
    await expect(page.locator(`${panel} .rc-md-editor`).first()).toBeVisible({ timeout: 20000 });
    const b1 = await bottom(page, panel);
    console.log(`reply panel bottom: before=${b0} after=${b1} delta=${b1 - b0}`);
    expect(Math.abs(b1 - b0)).toBeLessThanOrEqual(MAX_SHIFT_PX);
  });
});
