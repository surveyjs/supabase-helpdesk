import { test, expect } from './fixtures';
import { createServiceRoleClient } from '../helpers/supabase';
import { loginViaForm } from '../helpers/auth';
import { randomUUID } from 'crypto';

// #119: a deleted attachment is kept (soft delete). It leaves the post for
// everyone, and an agent can download or restore it from the Logs tab.

const SLUG = 'e2e-deleted-attachment-restore';
const FILE = 'restore-me.png';
const PNG_BYTES = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Zy0ZuYAAAAASUVORK5CYII=',
  'base64',
);

test.describe('Deleted attachments can be restored from Logs', () => {
  test.describe.configure({ mode: 'serial' });

  let url: string;
  let attachmentId: string;
  let storagePath: string;

  test.beforeAll(async () => {
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
    const { data: ticket, error: tErr } = await admin
      .from('tickets')
      .insert({ title: 'E2E Deleted Attachment Restore', slug: SLUG, creator_id: alice!.id, type_id: type!.id })
      .select('id, slug')
      .single();
    if (tErr) throw new Error(tErr.message);
    const { data: post, error: pErr } = await admin
      .from('posts')
      .insert({ ticket_id: ticket!.id, author_id: alice!.id, body: 'Post with a file.', is_original: true, post_type: 'post' })
      .select('id')
      .single();
    if (pErr) throw new Error(pErr.message);

    attachmentId = randomUUID();
    storagePath = `tickets/${ticket!.id}/posts/${post!.id}/${attachmentId}-${FILE}`;
    const { error: upErr } = await admin.storage
      .from('attachments')
      .upload(storagePath, PNG_BYTES, { contentType: 'image/png', upsert: true });
    if (upErr) throw new Error(upErr.message);
    const { error: aErr } = await admin.from('attachments').insert({
      id: attachmentId, post_id: post!.id, uploader_id: alice!.id, storage_path: storagePath,
      original_filename: FILE, file_size: PNG_BYTES.length, mime_type: 'image/png',
    });
    if (aErr) throw new Error(aErr.message);
    url = `/tickets/${ticket!.id}/${ticket!.slug}`;
  });

  test.afterAll(async () => {
    const admin = createServiceRoleClient();
    await admin.storage.from('attachments').remove([storagePath]);
  });

  test('the author deletes the file in edit mode; it is gone for them, storage object kept', async ({ page }) => {
    await loginViaForm(page, 'alice@example.com');
    await page.goto(url);
    const row = page.getByTestId(`attachment-${attachmentId}`);
    await expect(row).toBeVisible();
    await page.getByTestId('edit-post-btn').first().click();
    await row.getByTestId('delete-attachment-btn').click();
    await expect(row).toHaveCount(0);

    // Not served to the author, not even with the Logs flag.
    const res = await page.request.get(`/attachments/${attachmentId}?deleted=1`, { maxRedirects: 0 });
    expect(res.status()).toBe(404);

    const admin = createServiceRoleClient();
    const { data: att } = await admin.from('attachments').select('deleted_at').eq('id', attachmentId).single();
    expect(att!.deleted_at).not.toBeNull();
    const { data: blob, error } = await admin.storage.from('attachments').download(storagePath);
    expect(error).toBeNull();
    expect(blob).not.toBeNull();
  });

  test('an agent downloads and restores it from the Logs tab', async ({ page }) => {
    await loginViaForm(page, 'agent.smith@example.com');
    await page.goto(url);
    // Gone from the post for agents too, and the bare link no longer serves it.
    await expect(page.getByTestId(`attachment-${attachmentId}`)).toHaveCount(0);
    const bare = await page.request.get(`/attachments/${attachmentId}`, { maxRedirects: 0 });
    expect(bare.status()).toBe(404);

    await page.getByTestId('logs-tab').click();
    const actions = page.getByTestId('deleted-file-actions');
    await expect(actions).toHaveCount(1);
    const href = await actions.getByTestId('deleted-file-download').getAttribute('href');
    expect(href).toBe(`/attachments/${attachmentId}?deleted=1`);
    const dl = await page.request.get(href!, { maxRedirects: 0 });
    expect(dl.status()).toBe(302);

    await actions.getByTestId('restore-attachment-btn').click();
    await expect(page.getByText(`restored file "${FILE}"`)).toBeVisible();
    await expect(page.getByTestId('deleted-file-actions')).toHaveCount(0);
  });

  test('after the restore the author sees the file again', async ({ page }) => {
    await loginViaForm(page, 'alice@example.com');
    await page.goto(url);
    await expect(page.getByTestId(`attachment-${attachmentId}`)).toBeVisible();
  });
});
