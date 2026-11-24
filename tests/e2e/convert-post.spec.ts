import { test, expect } from './fixtures';
import { createServiceRoleClient } from '../helpers/supabase';
import { loginViaForm } from '../helpers/auth';

// #106: agents convert a comment to an answer and back.

const SLUG = 'e2e-convert-post-kind';

test.describe('Convert answers and comments', () => {
  test.describe.configure({ mode: 'serial' });
  let url: string;
  let commentId: string;

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
    const { data: agent } = await admin.from('profiles').select('id').eq('email', 'agent.smith@example.com').single();
    const { data: type } = await admin.from('ticket_types').select('id').limit(1).single();
    const { data: ticket, error } = await admin
      .from('tickets')
      .insert({ title: 'E2E Convert Post Kind', slug: SLUG, creator_id: alice!.id, type_id: type!.id })
      .select('id, slug')
      .single();
    if (error) throw new Error(error.message);
    const { data: original, error: oErr } = await admin
      .from('posts')
      .insert({ ticket_id: ticket!.id, author_id: alice!.id, body: 'Question here.', is_original: true, post_type: 'post' })
      .select('id')
      .single();
    if (oErr) throw new Error(oErr.message);
    const { data: comment, error: cErr } = await admin
      .from('posts')
      .insert({
        ticket_id: ticket!.id, author_id: agent!.id, body: 'This is really the answer.',
        post_type: 'comment', parent_post_id: original!.id,
      })
      .select('id')
      .single();
    if (cErr) throw new Error(cErr.message);
    commentId = comment!.id;
    url = `/tickets/${ticket!.id}/${ticket!.slug}`;
  });

  test('customers get no Convert action', async ({ page }) => {
    await loginViaForm(page, 'alice@example.com');
    await page.goto(url);
    await expect(page.getByTestId(`post-${commentId}`)).toBeVisible();
    await expect(page.getByTestId('convert-post-btn')).toHaveCount(0);
  });

  test('an agent turns the comment into an answer and back', async ({ page }) => {
    await loginViaForm(page, 'agent.smith@example.com');
    await page.goto(url);
    const post = page.getByTestId(`post-${commentId}`);
    await expect(post).toHaveAttribute('data-post-kind', 'comment');

    await post.getByTestId('convert-post-btn').click();
    await expect(page.getByTestId(`post-${commentId}`)).toHaveAttribute('data-post-kind', 'post', { timeout: 15000 });
    const asAnswer = page.getByTestId(`post-${commentId}`);
    await expect(asAnswer.getByTestId('convert-post-btn').first()).toHaveText('Convert to comment');

    await asAnswer.getByTestId('convert-post-btn').first().click();
    await expect(page.getByTestId(`post-${commentId}`)).toHaveAttribute('data-post-kind', 'comment', { timeout: 15000 });

    await page.getByTestId('logs-tab').click();
    await expect(page.locator('[data-testid^="activity-"]').filter({ hasText: 'converted a comment to an answer' })).toHaveCount(1);
    await expect(page.locator('[data-testid^="activity-"]').filter({ hasText: 'converted an answer to a comment' })).toHaveCount(1);
  });
});
