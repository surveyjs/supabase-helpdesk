import { test, expect, Page } from '@playwright/test';
import { createServiceRoleClient } from '../helpers/supabase';
import { loginViaForm } from '../helpers/auth';

// Tiny 1×1 transparent PNG, base64-encoded. Reused by all tests to simulate a
// clipboard image without touching the filesystem.
const PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Zy0ZuYAAAAASUVORK5CYII=';

async function loginAs(page: Page, email: string, password = 'Password123') {
  await loginViaForm(page, email, password);
}

/**
 * Dispatch a synthetic `paste` event on the given selector, carrying a single
 * PNG file inside `clipboardData.items`. This is how `react-markdown-editor-lite`
 * triggers `onImageUpload` in the browser, so we exercise the real wiring
 * without depending on OS-level clipboard access.
 */
async function pasteImageInto(
  page: Page,
  selector: string,
  base64: string,
  filename = 'pasted.png',
  mime = 'image/png',
) {
  await page.locator(selector).focus();
  await page.evaluate(
    async ({ sel, b64, name, type }) => {
      const target = document.querySelector(sel) as HTMLTextAreaElement | null;
      if (!target) throw new Error(`paste target ${sel} not found`);

      const bin = atob(b64);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      const file = new File([bytes], name, { type });

      const dt = new DataTransfer();
      dt.items.add(file);

      target.dispatchEvent(
        new ClipboardEvent('paste', {
          bubbles: true,
          cancelable: true,
          clipboardData: dt,
        }),
      );
    },
    { sel: selector, b64: base64, name: filename, type: mime },
  );
}

test.describe('Inline image paste in post editor', () => {
  test.describe.configure({ mode: 'serial' });

  let ticketUrl: string;

  test.beforeAll(async () => {
    const admin = createServiceRoleClient();

    // Clean previous orphan inline uploads for alice so the test starts fresh.
    const { data: alice } = await admin
      .from('profiles')
      .select('id')
      .eq('email', 'alice@example.com')
      .single();
    if (alice) {
      await admin.from('attachments').delete().eq('uploader_id', alice.id).is('post_id', null);
    }

    // Tear down any stale test ticket from a previous run.
    const { data: stale } = await admin
      .from('tickets')
      .select('id')
      .eq('slug', 'e2e-inline-image-paste-ticket');
    if (stale && stale.length > 0) {
      const ids = stale.map((t: { id: number }) => t.id);
      await admin.from('ticket_followers').delete().in('ticket_id', ids);
      await admin.from('activity_log').delete().in('ticket_id', ids);
      const { data: posts } = await admin.from('posts').select('id').in('ticket_id', ids);
      if (posts && posts.length > 0) {
        await admin
          .from('attachments')
          .delete()
          .in('post_id', posts.map((p: { id: string }) => p.id));
      }
      await admin.from('posts').delete().in('ticket_id', ids);
      await admin.from('tickets').delete().in('id', ids);
    }

    // Loosen ticket creation rate limit for the suite.
    await admin
      .from('app_settings')
      .upsert({ key: 'ticket_creation_rate_limit', value: '100' }, { onConflict: 'key' });
  });

  test('paste image into new-ticket editor → orphan attachment created', async ({ page }) => {
    await loginAs(page, 'alice@example.com');
    await page.goto('/tickets/new');

    await expect(page.getByLabel('Title')).toBeVisible({ timeout: 10000 });
    await page.getByLabel('Title').fill('E2E Inline Image Paste Ticket');
    await page.getByLabel('Type').selectOption({ label: 'Issue' });

    const editorTextarea =
      '[data-testid="markdown-editor"] textarea[name="textarea"]';
    await page.locator(editorTextarea).fill('Before image. ');

    await pasteImageInto(page, editorTextarea, PNG_BASE64);

    // The editor first inserts an `Uploading_…` placeholder, then replaces it
    // with the real Markdown image once the Promise resolves.
    await expect
      .poll(
        async () =>
          (await page.locator(editorTextarea).inputValue()).includes('/attachments/'),
        { timeout: 15000, message: 'editor never received /attachments/<id> URL' },
      )
      .toBe(true);

    const bodyAfterPaste = await page.locator(editorTextarea).inputValue();
    expect(bodyAfterPaste).toMatch(/!\[.*]\(\/attachments\/[0-9a-f-]{36}\)/);

    // Verify the orphan attachment row exists for alice.
    const admin = createServiceRoleClient();
    const { data: alice } = await admin
      .from('profiles')
      .select('id')
      .eq('email', 'alice@example.com')
      .single();
    expect(alice).toBeTruthy();

    const { data: orphans } = await admin
      .from('attachments')
      .select('id, post_id, uploader_id, original_filename, mime_type')
      .eq('uploader_id', alice!.id)
      .eq('mime_type', 'image/png')
      .is('post_id', null);
    expect(orphans && orphans.length).toBeGreaterThan(0);
    expect(orphans![0].mime_type).toBe('image/png');

    // Submit the ticket — claimInlineAttachments() should re-parent the orphan.
    await page.getByRole('button', { name: 'Create Ticket' }).click();
    await expect(page).toHaveURL(
      /\/tickets\/\d+\/e2e-inline-image-paste-ticket/,
      { timeout: 30000 },
    );
    ticketUrl = page.url();

    const { data: claimed } = await admin
      .from('attachments')
      .select('id, post_id')
      .eq('uploader_id', alice!.id)
      .is('post_id', null);
    expect(claimed?.length ?? 0).toBe(0);

    // The attachment now belongs to the original post and renders inline.
    await expect(page.locator('[data-testid="attachment-thumbnail"]').first()).toBeVisible({
      timeout: 10000,
    });
  });

  test('paste image into reply editor → claimed onto the new reply post', async ({
    page,
  }) => {
    test.skip(!ticketUrl, 'depends on previous test ticket');
    const admin = createServiceRoleClient();
    const { data: alice } = await admin
      .from('profiles')
      .select('id')
      .eq('email', 'alice@example.com')
      .single();

    // Snapshot the post ids before the reply so we can isolate the new one.
    const { data: ticketRow } = await admin
      .from('tickets')
      .select('id')
      .eq('slug', 'e2e-inline-image-paste-ticket')
      .single();
    const ticketDbId = ticketRow!.id;

    const { data: postsBefore } = await admin
      .from('posts')
      .select('id')
      .eq('ticket_id', ticketDbId);
    const beforeIds = new Set((postsBefore ?? []).map((p: { id: string }) => p.id));

    await loginAs(page, 'alice@example.com');
    await page.goto(ticketUrl);

    await page.getByTestId('main-reply-btn').click();
    const replyPanel = page.getByTestId('main-reply-panel');
    await expect(replyPanel).toBeVisible({ timeout: 5000 });

    const replyTextarea =
      '[data-testid="main-reply-panel"] [data-testid="markdown-editor"] textarea[name="textarea"]';
    await page.locator(replyTextarea).fill('See screenshot: ');
    await pasteImageInto(page, replyTextarea, PNG_BASE64, 'reply-shot.png');

    await expect
      .poll(
        async () =>
          (await page.locator(replyTextarea).inputValue()).includes('/attachments/'),
        { timeout: 15000 },
      )
      .toBe(true);

    await replyPanel.getByRole('button', { name: 'Add a reply' }).click();

    // The reply text should show in the timeline.
    await expect(page.getByText('See screenshot:').first()).toBeVisible({
      timeout: 15000,
    });

    // Find the newly-created post and confirm the orphan was claimed onto it.
    const { data: postsAfter } = await admin
      .from('posts')
      .select('id, body')
      .eq('ticket_id', ticketDbId);
    const newPost = (postsAfter ?? []).find(
      (p: { id: string }) => !beforeIds.has(p.id),
    );
    expect(newPost).toBeTruthy();

    const { data: linked } = await admin
      .from('attachments')
      .select('id, post_id, original_filename')
      .eq('uploader_id', alice!.id)
      .eq('post_id', newPost!.id);
    expect(linked && linked.length).toBeGreaterThan(0);
    expect(linked![0].original_filename).toBe('reply-shot.png');

    const { data: stillOrphan } = await admin
      .from('attachments')
      .select('id')
      .eq('uploader_id', alice!.id)
      .is('post_id', null);
    expect(stillOrphan?.length ?? 0).toBe(0);
  });
});
