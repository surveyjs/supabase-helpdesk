import { test, expect } from './fixtures';
import { createServiceRoleClient } from '../helpers/supabase';
import { loginViaForm } from '../helpers/auth';
import { randomUUID } from 'crypto';

const SLUG = 'e2e-ticket-layout';
const CLOSED_SLUG = 'e2e-ticket-layout-closed';
const LONG_URL = `https://example.com/${'a'.repeat(300)}`;

async function seedClosed() {
  const admin = createServiceRoleClient();
  const { data: stale } = await admin.from('tickets').select('id').eq('slug', CLOSED_SLUG);
  if (stale?.length) {
    const ids = stale.map((t: { id: number }) => t.id);
    await admin.from('activity_log').delete().in('ticket_id', ids);
    await admin.from('posts').delete().in('ticket_id', ids);
    await admin.from('tickets').delete().in('id', ids);
  }
  const { data: alice } = await admin.from('profiles').select('id').eq('email', 'alice@example.com').single();
  const { data: type } = await admin.from('ticket_types').select('id').limit(1).single();
  const { data: ticket } = await admin
    .from('tickets')
    .insert({ title: 'E2E Ticket Layout Closed', slug: CLOSED_SLUG, creator_id: alice!.id, type_id: type!.id, status: 'closed' })
    .select('id, slug')
    .single();
  await admin.from('posts').insert({
    ticket_id: ticket!.id, author_id: alice!.id, body: 'Closed original.', is_original: true, post_type: 'post',
  });
  return `/tickets/${ticket!.id}/${ticket!.slug}`;
}

async function seed() {
  const admin = createServiceRoleClient();
  const { data: stale } = await admin.from('tickets').select('id').eq('slug', SLUG);
  if (stale?.length) {
    const ids = stale.map((t: { id: number }) => t.id);
    await admin.from('activity_log').delete().in('ticket_id', ids);
    await admin.from('posts').delete().in('ticket_id', ids);
    await admin.from('tickets').delete().in('id', ids);
  }
  const { data: alice } = await admin.from('profiles').select('id').eq('email', 'alice@example.com').single();
  const { data: type } = await admin.from('ticket_types').select('id').limit(1).single();
  const { data: ticket } = await admin
    .from('tickets')
    .insert({ title: 'E2E Ticket Layout', slug: SLUG, creator_id: alice!.id, type_id: type!.id })
    .select('id, slug')
    .single();
  await admin.from('posts').insert({
    ticket_id: ticket!.id, author_id: alice!.id, body: 'Original post.', is_original: true, post_type: 'post',
  });
  const inlineId = randomUUID();
  const { data: reply } = await admin
    .from('posts')
    .insert({
      ticket_id: ticket!.id,
      author_id: alice!.id,
      body: `See ${LONG_URL}\n\n![shot](/attachments/${inlineId})`,
      is_original: false,
      post_type: 'post',
    })
    .select('id')
    .single();
  const { error: attErr } = await admin.from('attachments').insert([
    {
      id: inlineId, post_id: reply!.id, uploader_id: alice!.id, legacy_blob_id: randomUUID(),
      original_filename: 'inline-shot-only.png', file_size: 1234, mime_type: 'image/png',
    },
    {
      id: randomUUID(), post_id: reply!.id, uploader_id: alice!.id, legacy_blob_id: randomUUID(),
      original_filename: `${'long-file-name-'.repeat(12)}.txt`, file_size: 4321, mime_type: 'text/plain',
    },
  ]);
  if (attErr) throw new Error(attErr.message);
  const { data: agent } = await admin.from('profiles').select('id').eq('email', 'agent.smith@example.com').single();
  await admin.from('ticket_followers').upsert({ ticket_id: ticket!.id, user_id: agent!.id });
  return `/tickets/${ticket!.id}/${ticket!.slug}`;
}

test.describe('Ticket thread layout', () => {
  test.describe.configure({ mode: 'serial' });
  let url: string;
  let closedUrl: string;
  test.beforeAll(async () => {
    url = await seed();
    closedUrl = await seedClosed();
  });

  test('ticket number shows in header', async ({ page }) => {
    await loginViaForm(page, 'agent.smith@example.com');
    await page.goto(url);
    const id = url.split('/')[2];
    const num = page.getByTestId('ticket-main-content').getByText(`#${id}`, { exact: true });
    await expect(num).toBeVisible();
    const tabs = await page.getByRole('tab').first().boundingBox();
    const numBox = await num.boundingBox();
    expect(numBox!.y).toBeLessThan(tabs!.y);
    await expect(page.getByTestId('ticket-sidebar').getByText(`#${id}`, { exact: true })).toHaveCount(0);
  });

  test('closed ticket has no delete row', async ({ page }) => {
    await loginViaForm(page, 'admin@example.com');
    await page.goto(closedUrl);
    await expect(page.getByTestId('ticket-sidebar')).toBeVisible();
    await expect(page.getByTestId('delete-ticket-btn-disabled')).toHaveCount(0);
    await expect(page.getByTestId('delete-ticket-btn')).toHaveCount(0);
    await expect(page.getByText(/Closed tickets cannot be deleted/)).toHaveCount(0);
  });

  test('followers count appears once', async ({ page }) => {
    await loginViaForm(page, 'agent.smith@example.com');
    await page.goto(url);
    await expect(page.getByTestId('follow-section')).toBeVisible();
    await expect(page.getByText(/\d+ followers?/)).toHaveCount(1);
  });

  test('advanced actions share one style and are not truncated', async ({ page }) => {
    await loginViaForm(page, 'agent.smith@example.com');
    await page.goto(url);
    const btns = [
      page.getByTestId('mark-duplicate-btn'),
      page.getByTestId('merge-ticket-btn'),
      page.getByTestId('clone-ticket-btn'),
    ];
    const bgs = new Set<string>();
    for (const b of btns) {
      await expect(b).toBeVisible();
      bgs.add(await b.evaluate((el) => getComputedStyle(el).backgroundColor));
      expect(await b.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
    }
    expect(bgs.size).toBe(1);
    await expect(btns[1]).toHaveText('Merge into…');
  });

  test('private and follow checkboxes are close together', async ({ page }) => {
    await loginViaForm(page, 'agent.smith@example.com');
    await page.goto(url);
    const survey = page.getByTestId('ticket-sidebar-survey');
    const priv = survey.getByText('Private ticket', { exact: true });
    const follow = survey.getByText('Follow this ticket', { exact: true });
    await expect(priv).toBeVisible();
    await expect(follow).toBeVisible();
    const a = (await priv.boundingBox())!;
    const b = (await follow.boundingBox())!;
    const gap = b.y >= a.y + a.height - 2 ? b.y - (a.y + a.height) : b.x - (a.x + a.width);
    expect(gap).toBeLessThanOrEqual(12);
  });

  test('post actions are on one row', async ({ page }) => {
    await loginViaForm(page, 'agent.smith@example.com');
    await page.goto(url);
    const post = page.locator('[data-post-kind="post"]').nth(1);
    const edit = await post.getByTestId('edit-post-btn').first().boundingBox();
    const del = await post.getByTestId('delete-post-btn').first().boundingBox();
    expect(edit).not.toBeNull();
    expect(del).not.toBeNull();
    expect(Math.abs(edit!.y - del!.y)).toBeLessThanOrEqual(4);
  });

  test('inline image is not repeated in the attachment list', async ({ page }) => {
    await loginViaForm(page, 'agent.smith@example.com');
    await page.goto(url);
    const list = page.locator('[data-testid="attachment-list"]');
    await expect(list.getByText('long-file-name-', { exact: false })).toBeVisible();
    await expect(list.getByText('inline-shot-only.png')).toHaveCount(0);
  });

  test.describe('phone width', () => {
    test.use({ viewport: { width: 390, height: 844 } });
    test('no horizontal overflow at 390px on a ticket with an attachment and a long link', async ({ page }) => {
      await loginViaForm(page, 'agent.smith@example.com');
      await page.goto(url);
      await expect(page.getByTestId('attachment-list')).toBeVisible();
      const { sw, cw } = await page.evaluate(() => ({
        sw: document.documentElement.scrollWidth,
        cw: document.documentElement.clientWidth,
      }));
      expect(sw).toBeLessThanOrEqual(cw);
    });
  });
});

test.describe('Markdown editor on /tickets/new', () => {
  test('new ticket page has a single h1', async ({ page }) => {
    await loginViaForm(page, 'alice@example.com');
    await page.goto('/tickets/new');
    await expect(page.getByTestId('markdown-editor')).toBeVisible();
    await expect(page.locator('h1')).toHaveCount(1);
  });

  test.describe('preview pane (preference "both")', () => {
    test.use({ viewport: { width: 1440, height: 900 } });
    test('wide: hidden while empty, shown once there is content', async ({ page }) => {
      await loginViaForm(page, 'alice@example.com');
      await page.goto('/tickets/new');
      const editor = page.getByTestId('markdown-editor');
      const textarea = editor.locator('.rc-md-editor textarea').first();
      await expect(textarea).toBeVisible();
      await expect(editor.locator('.sec-html')).toBeHidden();
      await textarea.fill('hello **world**');
      await expect(editor.locator('.sec-html')).toBeVisible();
    });
  });

  test.describe('heading menu keyboard access', () => {
    test.use({ viewport: { width: 1440, height: 900 } });
    test('Enter opens the menu, arrows move, Enter inserts "## "', async ({ page }) => {
      await loginViaForm(page, 'alice@example.com');
      await page.goto('/tickets/new');
      const editor = page.getByTestId('markdown-editor');
      const trigger = editor.locator('.button-type-header [role="button"]');
      await expect(trigger).toBeVisible();
      await trigger.focus();
      await page.keyboard.press('Enter');
      await expect(trigger).toHaveAttribute('aria-expanded', 'true');
      await expect(editor.getByTestId('editor-heading-1')).toBeFocused();
      await page.keyboard.press('ArrowDown');
      await expect(editor.getByTestId('editor-heading-2')).toBeFocused();
      await page.keyboard.press('Enter');
      await expect(editor.locator('.rc-md-editor textarea').first()).toHaveValue(/## /);
      await expect(trigger).toHaveAttribute('aria-expanded', 'false');
    });
    test('Escape closes the menu and returns focus to the trigger', async ({ page }) => {
      await loginViaForm(page, 'alice@example.com');
      await page.goto('/tickets/new');
      const editor = page.getByTestId('markdown-editor');
      const trigger = editor.locator('.button-type-header [role="button"]');
      await trigger.focus();
      await page.keyboard.press('Space');
      await expect(editor.getByTestId('editor-heading-1')).toBeFocused();
      await page.keyboard.press('Escape');
      await expect(trigger).toBeFocused();
      await expect(trigger).toHaveAttribute('aria-expanded', 'false');
    });
  });

  test.describe('phone width', () => {
    test.use({ viewport: { width: 390, height: 844 } });
    test('new ticket page has no horizontal overflow at 390px', async ({ page }) => {
      await loginViaForm(page, 'alice@example.com');
      await page.goto('/tickets/new');
      const editor = page.getByTestId('markdown-editor');
      await expect(editor).toBeVisible();
      await editor.locator('.rc-md-editor textarea').first().fill('typed content');
      await expect(editor.locator('.sec-html')).toBeHidden();
      const { sw, cw } = await page.evaluate(() => ({
        sw: document.documentElement.scrollWidth,
        cw: document.documentElement.clientWidth,
      }));
      expect(sw).toBeLessThanOrEqual(cw);
    });
  });
});
