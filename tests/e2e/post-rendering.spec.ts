import { test, expect } from './fixtures';
import { createServiceRoleClient } from '../helpers/supabase';
import { gotoAuthed, loginViaForm } from '../helpers/auth';

test.describe('Post rendering', () => {
  test('remote images become links and long links do not widen the page (390px)', async ({ page }) => {
    const admin = createServiceRoleClient();
    const { data: alice } = await admin.from('profiles').select('id').eq('email', 'alice@example.com').single();
    const { data: type } = await admin.from('ticket_types').select('id').limit(1).single();
    const slug = `e2e-post-render-${Date.now()}`;
    const { data: ticket } = await admin
      .from('tickets')
      .insert({ title: 'E2E Post Render', slug, creator_id: alice!.id, type_id: type!.id })
      .select('id, slug')
      .single();
    const longUrl = `https://example.org/${'a'.repeat(300)}`;
    await admin.from('posts').insert({
      ticket_id: ticket!.id,
      author_id: alice!.id,
      body: `![logo](https://tracker.example.net/logo.png)\n\n${longUrl}`,
      is_original: true,
      post_type: 'post',
    });

    await page.setViewportSize({ width: 390, height: 800 });
    await loginViaForm(page, 'alice@example.com', 'Password123');
    await gotoAuthed(page, `/tickets/${ticket!.id}/${ticket!.slug}`, () =>
      loginViaForm(page, 'alice@example.com', 'Password123'),
    );

    await expect(page.locator('a[data-external-image]')).toContainText('External image: logo');
    await expect(page.locator('.prose img[src^="https://tracker.example.net"]')).toHaveCount(0);
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
  });
});
