import { test, expect, Page } from '@playwright/test';
import { createServiceRoleClient } from '../helpers/supabase';

const ALICE_ID = '00000000-0000-0000-0000-000000000014';
const COMMENT_BODY = 'This is a separate problem that deserves its own ticket.';

async function loginAs(page: Page, email: string, password = 'Password123') {
  const svc = createServiceRoleClient();
  await svc.from('login_attempts').delete().eq('email', email.toLowerCase());

  await page.goto('/login');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Log in' }).click();
  await expect(page).toHaveURL('/', { timeout: 10000 });
  await expect(page.locator('summary[aria-haspopup="true"]')).toBeVisible({ timeout: 10000 });
}

test.describe('Clone ticket / comment (issue #49)', () => {
  test.describe.configure({ mode: 'serial' });

  let ticketCloneSourceId: number;
  let commentCloneSourceId: number;
  let commentPostId: string;
  let tagId: string;

  test.beforeAll(async () => {
    const svc = createServiceRoleClient();
    const { data: tt } = await svc.from('ticket_types').select('id').limit(1).single();
    const typeId = tt!.id;

    const { data: tag } = await svc
      .from('tags')
      .insert({ name: `e2e-clone-tag-${Date.now()}`, color: '#3b82f6' })
      .select('id')
      .single();
    tagId = tag!.id;

    // Source ticket for the "clone ticket" flow.
    const { data: t1 } = await svc
      .from('tickets')
      .insert({ title: 'E2E Clone Source', slug: 'e2e-clone-source', creator_id: ALICE_ID, type_id: typeId, urgency: 'high' })
      .select('id')
      .single();
    ticketCloneSourceId = t1!.id;
    await svc.from('posts').insert({
      ticket_id: ticketCloneSourceId,
      author_id: ALICE_ID,
      body: 'Original description for the clone source ticket.',
      post_type: 'post',
      is_original: true,
    });
    await svc.from('ticket_tags').insert({ ticket_id: ticketCloneSourceId, tag_id: tagId });

    // Source ticket for the "clone comment" flow (has a separate user reply).
    const { data: t2 } = await svc
      .from('tickets')
      .insert({ title: 'E2E Comment Clone Source', slug: 'e2e-comment-clone-source', creator_id: ALICE_ID, type_id: typeId })
      .select('id')
      .single();
    commentCloneSourceId = t2!.id;
    await svc.from('posts').insert({
      ticket_id: commentCloneSourceId,
      author_id: ALICE_ID,
      body: 'Original description for the comment clone source.',
      post_type: 'post',
      is_original: true,
    });
    const { data: reply } = await svc
      .from('posts')
      .insert({
        ticket_id: commentCloneSourceId,
        author_id: ALICE_ID,
        body: COMMENT_BODY,
        post_type: 'post',
        is_original: false,
      })
      .select('id')
      .single();
    commentPostId = reply!.id;
  });

  test.afterAll(async () => {
    const svc = createServiceRoleClient();
    const sourceIds = [ticketCloneSourceId, commentCloneSourceId].filter(Boolean);

    // Collect cloned tickets created during the run.
    const { data: clones } = await svc.from('tickets').select('id').in('cloned_from_id', sourceIds);
    const cloneIds = (clones ?? []).map((c) => c.id);
    const allIds = [...sourceIds, ...cloneIds];

    if (allIds.length > 0) {
      await svc.from('notifications').delete().in('ticket_id', allIds);
      await svc.from('activity_log').delete().in('ticket_id', allIds);
      await svc.from('ticket_tags').delete().in('ticket_id', allIds);
      await svc.from('ticket_followers').delete().in('ticket_id', allIds);
      await svc.from('sla_timers').delete().in('ticket_id', allIds);
      await svc.from('posts').delete().in('ticket_id', allIds);
      // Clear lineage FKs before deleting to keep delete order independent.
      await svc.from('tickets').update({ cloned_from_id: null, cloned_from_post_id: null }).in('id', allIds);
      await svc.from('tickets').delete().in('id', allIds);
    }
    if (tagId) await svc.from('tags').delete().eq('id', tagId);
  });

  test('clone ticket → Cancel returns to the source and creates nothing', async ({ page }) => {
    await loginAs(page, 'agent.smith@example.com');
    await page.goto(`/tickets/${ticketCloneSourceId}/e2e-clone-source`);

    // The Clone control is a link to the prefilled create page (no write yet).
    await expect(page.getByTestId('clone-ticket-btn')).toBeVisible({ timeout: 10000 });
    await page.getByTestId('clone-ticket-btn').click();

    await page.waitForURL(/\/tickets\/new/, { timeout: 10000 });
    await expect(page.locator('#title')).toHaveValue(/^Copy of /);

    await page.getByTestId('cancel-ticket-btn').click();
    await expect(page).toHaveURL(new RegExp(`/tickets/${ticketCloneSourceId}/`), { timeout: 10000 });

    // Nothing was created.
    const svc = createServiceRoleClient();
    const { data: clones } = await svc.from('tickets').select('id').eq('cloned_from_id', ticketCloneSourceId);
    expect(clones?.length ?? 0).toBe(0);
  });

  test('clone ticket → Create makes a new ticket owned by the creator with origin note and tags', async ({ page }) => {
    await loginAs(page, 'agent.smith@example.com');
    await page.goto(`/tickets/${ticketCloneSourceId}/e2e-clone-source`);

    await page.getByTestId('clone-ticket-btn').click();
    await page.waitForURL(/\/tickets\/new/, { timeout: 10000 });
    await expect(page.locator('#title')).toHaveValue(/^Copy of /);

    await page.getByTestId('create-ticket-btn').click();

    // Redirected to the newly created ticket (away from /tickets/new).
    await page.waitForURL(/\/tickets\/\d+\//, { timeout: 20000 });
    await expect(page).not.toHaveURL(/\/tickets\/new/);

    // Verify server state: clone owned by alice, tags + origin note copied.
    const svc = createServiceRoleClient();
    const { data: clone } = await svc
      .from('tickets')
      .select('id, creator_id, title')
      .eq('cloned_from_id', ticketCloneSourceId)
      .order('id', { ascending: false })
      .limit(1)
      .maybeSingle();
    expect(clone?.creator_id).toBe(ALICE_ID);
    expect(clone?.title).toContain('Copy of');

    const { data: cloneTags } = await svc.from('ticket_tags').select('tag_id').eq('ticket_id', clone!.id);
    expect(cloneTags?.map((t) => t.tag_id)).toContain(tagId);

    const { data: post } = await svc
      .from('posts')
      .select('body')
      .eq('ticket_id', clone!.id)
      .eq('is_original', true)
      .single();
    expect(post?.body).toContain(`#${ticketCloneSourceId}`);
    expect(post?.body).toContain('Original description for the clone source ticket.');
  });

  test('clone comment → Cancel leaves the source comment untouched', async ({ page }) => {
    await loginAs(page, 'agent.smith@example.com');
    await page.goto(`/tickets/${commentCloneSourceId}/e2e-comment-clone-source`);

    const postCard = page.getByTestId(`post-${commentPostId}`);
    await expect(postCard.getByTestId('clone-comment-btn')).toBeVisible({ timeout: 10000 });
    await postCard.getByTestId('clone-comment-btn').click();

    await page.waitForURL(/\/tickets\/new/, { timeout: 10000 });
    await page.getByTestId('cancel-ticket-btn').click();
    await expect(page).toHaveURL(new RegExp(`/tickets/${commentCloneSourceId}/`), { timeout: 10000 });

    // The source comment body is unchanged (replacement only happens on Create).
    const svc = createServiceRoleClient();
    const { data: reply } = await svc.from('posts').select('body').eq('id', commentPostId).single();
    expect(reply?.body).toBe(COMMENT_BODY);
  });

  test('clone comment → Create makes a new ticket and replaces the source comment with a link', async ({ page }) => {
    await loginAs(page, 'agent.smith@example.com');
    await page.goto(`/tickets/${commentCloneSourceId}/e2e-comment-clone-source`);

    const postCard = page.getByTestId(`post-${commentPostId}`);
    await postCard.getByTestId('clone-comment-btn').click();

    await page.waitForURL(/\/tickets\/new/, { timeout: 10000 });
    await page.locator('#title').fill('Spun-off issue from comment');
    await page.getByTestId('create-ticket-btn').click();

    await page.waitForURL(/\/tickets\/\d+\//, { timeout: 20000 });
    await expect(page).not.toHaveURL(/\/tickets\/new/);

    const svc = createServiceRoleClient();
    const { data: clone } = await svc
      .from('tickets')
      .select('id, creator_id, title')
      .eq('cloned_from_post_id', commentPostId)
      .order('id', { ascending: false })
      .limit(1)
      .maybeSingle();
    expect(clone?.creator_id).toBe(ALICE_ID);
    expect(clone?.title).toBe('Spun-off issue from comment');

    // The source comment body has been replaced with the reply template text.
    const { data: replaced } = await svc.from('posts').select('body').eq('id', commentPostId).single();
    expect(replaced?.body).toContain('I created a separate ticket on your behalf');
    expect(replaced?.body).toContain(`/tickets/${clone!.id}/redirect`);
  });

  test('regular user does not see clone controls', async ({ page }) => {
    await loginAs(page, 'alice@example.com');

    // Clone Ticket lives on a ticket whose only post is the original.
    await page.goto(`/tickets/${ticketCloneSourceId}/e2e-clone-source`);
    await expect(page.getByTestId('clone-ticket-btn')).not.toBeVisible({ timeout: 5000 });

    // Clone Comment only renders on non-original posts — check the ticket that
    // actually has a clonable reply, otherwise the assertion is vacuous.
    await page.goto(`/tickets/${commentCloneSourceId}/e2e-comment-clone-source`);
    await expect(page.getByTestId('clone-comment-btn')).not.toBeVisible({ timeout: 5000 });
  });
});
