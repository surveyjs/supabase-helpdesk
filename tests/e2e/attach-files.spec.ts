import { test, expect } from '@playwright/test';
import { createServiceRoleClient } from '../helpers/supabase';
import { loginViaForm } from '../helpers/auth';

/**
 * E2E coverage for the new "Attach file(s)" toolbar button + dialog in the
 * Markdown editor. Exercises the non-image attachment path that the previous
 * inline-image-paste flow did not support: a `.txt` file is uploaded as an
 * orphan attachment and re-parented onto the freshly-created post.
 */
test.describe('Attach file(s) editor button', () => {
  test.beforeAll(async () => {
    const admin = createServiceRoleClient();

    // Ensure `.txt` is included in the allowed list without overwriting any
    // other entries other specs (or migration 006 defaults) rely on.
    const { data: allowedRow } = await admin
      .from('app_settings')
      .select('value')
      .eq('key', 'allowed_file_types')
      .single();
    let allowed: string[] = [];
    if (allowedRow?.value) {
      try { allowed = JSON.parse(allowedRow.value); } catch { /* fall through */ }
    }
    if (!Array.isArray(allowed) || allowed.length === 0) {
      allowed = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'pdf', 'txt'];
    }
    if (!allowed.includes('txt')) {
      allowed = [...allowed, 'txt'];
      await admin
        .from('app_settings')
        .update({ value: JSON.stringify(allowed) })
        .eq('key', 'allowed_file_types');
    }

    // Loosen ticket creation rate limit and clear stale fixtures.
    await admin
      .from('app_settings')
      .upsert({ key: 'ticket_creation_rate_limit', value: '100' }, { onConflict: 'key' });

    const { data: alice } = await admin
      .from('profiles')
      .select('id')
      .eq('email', 'alice@example.com')
      .single();
    if (alice) {
      // Scope to this spec's artifact (`spec.txt`) so we don't race with
      // other specs (e.g. inline-image-paste) that also create alice orphans.
      await admin
        .from('attachments')
        .delete()
        .eq('uploader_id', alice.id)
        .is('post_id', null)
        .eq('original_filename', 'spec.txt');
    }

    const { data: stale } = await admin
      .from('tickets')
      .select('id')
      .eq('slug', 'e2e-attach-files-ticket');
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
  });

  test('attach a .txt file via toolbar dialog → claimed onto the new post', async ({ page }) => {
    await loginViaForm(page, 'alice@example.com');
    await page.goto('/tickets/new');

    await expect(page.getByLabel('Title')).toBeVisible({ timeout: 10000 });
    await page.getByLabel('Title').fill('E2E Attach Files Ticket');
    await page.getByLabel('Type').selectOption({ label: 'Issue' });

    const editorTextarea =
      '[data-testid="markdown-editor"] textarea[name="textarea"]';
    await page.locator(editorTextarea).fill('See attached spec. ');

    // The toolbar button is rendered inside the lib's toolbar; clicking it
    // dispatches the `mdeditor:request-attach-files` event, which makes the
    // wrapper trigger the hidden file input. We bypass the OS file chooser by
    // using `setInputFiles` directly on the hidden input.
    const fileInput = page.locator('[data-testid="attach-files-input"]');
    await fileInput.setInputFiles({
      name: 'spec.txt',
      mimeType: 'text/plain',
      buffer: Buffer.from('hello attach', 'utf8'),
    });

    // Dialog should open with the file pre-selected.
    const dialog = page.getByTestId('attach-files-dialog');
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText('spec.txt')).toBeVisible();

    await dialog.getByTestId('attach-files-confirm-btn').click();

    // Wait for the dialog to close and the editor body to receive the link.
    await expect(dialog).toBeHidden({ timeout: 15000 });
    await expect
      .poll(
        async () => (await page.locator(editorTextarea).inputValue()).includes('/attachments/'),
        { timeout: 10000, message: 'editor never received /attachments/<id> URL' },
      )
      .toBe(true);

    const bodyAfter = await page.locator(editorTextarea).inputValue();
    // Non-image → plain link Markdown (no leading `!`).
    expect(bodyAfter).toMatch(/(^|[^!])\[spec\.txt]\(\/attachments\/[0-9a-f-]{36}\)/);

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
      .select('id, post_id, original_filename, mime_type')
      .eq('uploader_id', alice!.id)
      .eq('original_filename', 'spec.txt')
      .is('post_id', null);
    expect(orphans?.length ?? 0).toBeGreaterThan(0);
    expect(orphans!.some((o) => o.original_filename === 'spec.txt')).toBe(true);

    // Submit the ticket — claimInlineAttachments() should re-parent the orphan.
    await page.getByRole('button', { name: 'Create Ticket' }).click();
    await expect(page).toHaveURL(
      /\/tickets\/\d+\/e2e-attach-files-ticket/,
      { timeout: 30000 },
    );

    const { data: stillOrphan } = await admin
      .from('attachments')
      .select('id')
      .eq('uploader_id', alice!.id)
      .eq('original_filename', 'spec.txt')
      .is('post_id', null);
    expect(stillOrphan?.length ?? 0).toBe(0);

    const { data: claimed } = await admin
      .from('attachments')
      .select('id, post_id, original_filename')
      .eq('uploader_id', alice!.id)
      .eq('original_filename', 'spec.txt')
      .not('post_id', 'is', null);
    expect(claimed?.length ?? 0).toBeGreaterThan(0);
  });
});
