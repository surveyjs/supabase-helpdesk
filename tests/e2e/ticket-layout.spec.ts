import { test, expect } from './fixtures';
import { createServiceRoleClient } from '../helpers/supabase';
import { loginViaForm } from '../helpers/auth';
import { randomUUID } from 'crypto';

const SLUG = 'e2e-ticket-layout';
const LONG_URL = `https://example.com/${'a'.repeat(300)}`;

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
  return `/tickets/${ticket!.id}/${ticket!.slug}`;
}

test.describe('Ticket thread layout', () => {
  test.describe.configure({ mode: 'serial' });
  let url: string;
  test.beforeAll(async () => {
    url = await seed();
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
