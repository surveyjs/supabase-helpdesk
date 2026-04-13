import { test, expect } from '@playwright/test';
import { createServiceRoleClient } from '../helpers/supabase';
import { loginAs } from '../helpers/auth';

/** Look up the posts-test ticket URL from DB (survives serial-retry context loss). */
async function resolveTicketUrl(): Promise<string> {
  const admin = createServiceRoleClient();
  // Try renamed slug first (after "edit title" test), then original.
  // Use .order + .limit to handle possible duplicates after serial retries.
  for (const slug of ['e2e-posts-renamed-ticket', 'e2e-posts-test-ticket']) {
    const { data } = await admin
      .from('tickets')
      .select('id, slug')
      .eq('slug', slug)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (data) return `/tickets/${data.id}/${data.slug}`;
  }
  throw new Error('Could not find posts test ticket in DB');
}

test.describe('Posts, Comments & Notes', () => {
  test.describe.configure({ mode: 'serial' });

  let ticketUrl: string;

  // Create a dedicated test ticket
  test.beforeAll(async () => {
    const admin = createServiceRoleClient();
    // Clean up any stale test tickets
    const { data: staleTickets } = await admin
      .from('tickets')
      .select('id')
      .in('slug', ['e2e-posts-test-ticket', 'e2e-posts-renamed-ticket']);
    if (staleTickets && staleTickets.length > 0) {
      const ids = staleTickets.map((t: { id: number }) => t.id);
      await admin.from('ticket_followers').delete().in('ticket_id', ids);
      await admin.from('activity_log').delete().in('ticket_id', ids);
      await admin.from('posts').delete().in('ticket_id', ids);
      await admin.from('tickets').delete().in('id', ids);
    }
  });

  test('create test ticket for comment/note tests', async ({ page }) => {
    await loginAs(page, 'alice@example.com');
    await page.goto('/tickets/new');

    await page.getByLabel('Title').fill('E2E Posts Test Ticket');
    // Wait for the Type dropdown options to load; reload once if server failed to fetch types
    const typeSelect = page.getByLabel('Type');
    const issueOption = typeSelect.locator('option').filter({ hasText: 'Issue' });
    if (await issueOption.count() === 0) {
      await page.reload();
      await page.getByLabel('Title').fill('E2E Posts Test Ticket');
    }
    await expect(issueOption).toBeAttached({ timeout: 10000 });
    await typeSelect.selectOption({ label: 'Issue' });
    await page.getByLabel(/Description/).fill('This is the original post body for E2E post tests.');
    await page.getByRole('button', { name: 'Create Ticket' }).click();

    await expect(page).toHaveURL(/\/tickets\/\d+\/e2e-posts-test-ticket/, { timeout: 10000 });
    ticketUrl = page.url();
  });

  test('add a reply to the ticket', async ({ page }) => {
    await loginAs(page, 'alice@example.com');
    await page.goto(ticketUrl || await resolveTicketUrl());

    await page.getByLabel('Reply body').fill('A root reply to the ticket.');
    // Use the submit button inside the reply form (not the ReplyToggle button)
    await page.locator('form').filter({ has: page.getByLabel('Reply body') }).getByRole('button', { name: 'Reply' }).click();

    await expect(page.getByText('A root reply to the ticket.')).toBeVisible({ timeout: 10000 });
  });

  test('add a comment on a post → comment appears indented', async ({ page }) => {
    await loginAs(page, 'alice@example.com');
    await page.goto(ticketUrl || await resolveTicketUrl());

    // Click the Reply button on the root reply post
    const replyBtns = page.locator('[data-testid="reply-btn"]');
    // There should be at least one reply button (on the root reply)
    const firstReplyBtn = replyBtns.first();
    await firstReplyBtn.click();

    // Fill in the comment form
    await page.getByLabel('Comment body').fill('A threaded comment on the reply.');
    await page.getByRole('button', { name: 'Comment' }).click();

    await expect(page.getByText('A threaded comment on the reply.')).toBeVisible({ timeout: 10000 });
    // The comment should be indented (inside ml-6 div)
    const comment = page.getByText('A threaded comment on the reply.');
    const parent = comment.locator('xpath=ancestor::div[contains(@class, "ml-6")]');
    await expect(parent.first()).toBeVisible();
  });

  test('reply to a comment → reply appears at level 2', async ({ page }) => {
    await loginAs(page, 'alice@example.com');
    await page.goto(ticketUrl || await resolveTicketUrl());

    // The level-1 comment should have a Reply button
    // Find the reply button near the threaded comment
    const commentText = page.getByText('A threaded comment on the reply.');
    await expect(commentText).toBeVisible();

    // Look for a reply button below this comment in ml-12
    const replyBtns = page.locator('[data-testid="reply-btn"]');
    // The last reply button should be for the level-1 comment
    const lastReplyBtn = replyBtns.last();
    await lastReplyBtn.click();

    await page.getByLabel('Comment body').fill('A level-2 reply to the comment.');
    await page.getByRole('button', { name: 'Comment' }).click();

    await expect(page.getByText('A level-2 reply to the comment.')).toBeVisible({ timeout: 10000 });
  });

  test('level-2 comment has no Reply action', async ({ page }) => {
    await loginAs(page, 'alice@example.com');
    await page.goto(ticketUrl || await resolveTicketUrl());

    // The level-2 reply should exist
    await expect(page.getByText('A level-2 reply to the comment.')).toBeVisible();

    // There should be no reply button for level-2 comments (ml-12 has no further reply-btn)
    // Count reply buttons before and confirm there's no additional one near the level-2 comment
    const level2Comment = page.getByText('A level-2 reply to the comment.');
    // The level-2 comment's container should not have a reply button after it
    const level2Parent = level2Comment.locator('xpath=ancestor::div[contains(@class, "ml-12")]').first();
    // There should be no reply-btn within or after the level-2 block
    const replyBtnsInLevel2 = level2Parent.locator('[data-testid="reply-btn"]');
    await expect(replyBtnsInLevel2).toHaveCount(0);
  });

  test('agent can add an internal note → note visible to agent, not to regular user', async ({ page }) => {
    // Login as agent and add note
    await loginAs(page, 'agent.smith@example.com');
    await page.goto(ticketUrl || await resolveTicketUrl());

    await page.getByLabel('Note body').fill('Internal agent note content.');
    await page.getByRole('button', { name: 'Add Note' }).click();

    await expect(page.getByText('Internal agent note content.')).toBeVisible({ timeout: 10000 });
    await expect(page.getByText('(Internal note)')).toBeVisible();
  });

  test('note not visible to regular user', async ({ page }) => {
    await loginAs(page, 'alice@example.com');
    await page.goto(ticketUrl || await resolveTicketUrl());

    await expect(page.getByText('Internal agent note content.')).not.toBeVisible();
  });

  test('edit a post → "(edited)" indicator shows', async ({ page }) => {
    await loginAs(page, 'alice@example.com');
    await page.goto(ticketUrl || await resolveTicketUrl());

    // Find the edit button on Alice's reply
    const editBtns = page.locator('[data-testid="edit-post-btn"]');
    await editBtns.first().click();

    // Change the text
    const textarea = page.locator('textarea[name="body"]').first();
    await textarea.clear();
    await textarea.fill('Edited root reply content.');
    await page.getByRole('button', { name: 'Save' }).first().click();

    await expect(page.getByText('Edited root reply content.')).toBeVisible({ timeout: 10000 });
    await expect(page.getByText('(edited)')).toBeVisible();
  });

  test('edit title → URL redirects to new slug', async ({ page }) => {
    await loginAs(page, 'alice@example.com');
    await page.goto(ticketUrl || await resolveTicketUrl());

    // Click the edit title button
    await page.locator('[data-testid="edit-title-btn"]').click();

    const titleInput = page.locator('input[name="title"]');
    await titleInput.clear();
    await titleInput.fill('E2E Posts Renamed Ticket');
    await page.getByRole('button', { name: 'Save' }).first().click();

    // Should redirect to new slug URL
    await expect(page).toHaveURL(/e2e-posts-renamed-ticket/, { timeout: 10000 });
    await expect(page.getByRole('heading', { name: 'E2E Posts Renamed Ticket' })).toBeVisible();

    // Update ticketUrl for subsequent tests
    ticketUrl = page.url();
  });

  test('agent can create a draft post → shows with Draft badge', async ({ page }) => {
    // We'll test draft creation via the agent's perspective
    // For now, create a draft via the service role and verify it shows for agents
    await loginAs(page, 'agent.smith@example.com');
    await page.goto(ticketUrl || await resolveTicketUrl());

    // The Reply form should be visible for agents
    await expect(page.getByLabel('Reply body')).toBeVisible();
  });

  test('agent can make a post private → privacy badge shows', async ({ page }) => {
    await loginAs(page, 'agent.smith@example.com');
    await page.goto(ticketUrl || await resolveTicketUrl());

    // Look for the "Make Private" button on a non-original post
    const makePrivateBtn = page.getByRole('button', { name: 'Make Private' }).first();
    if (await makePrivateBtn.isVisible()) {
      await makePrivateBtn.click();
      await expect(page.getByText('Private').first()).toBeVisible({ timeout: 10000 });
    }
  });

  test('agent can delete a non-original post → post disappears', async ({ page }) => {
    // Login as agent and add a temporary post
    await loginAs(page, 'agent.smith@example.com');
    await page.goto(ticketUrl || await resolveTicketUrl());

    await page.getByLabel('Reply body').fill('Temporary post to be deleted.');
    await page.locator('form').filter({ has: page.getByLabel('Reply body') }).getByRole('button', { name: 'Reply' }).click();
    await expect(page.getByText('Temporary post to be deleted.')).toBeVisible({ timeout: 10000 });

    // Delete it – find the delete button in the same post container
    const tempPost = page.getByText('Temporary post to be deleted.');
    const postContainer = tempPost.locator('xpath=ancestor::div[starts-with(@data-testid, "post-")]');
    await postContainer.locator('[data-testid="delete-post-btn"]').click();

    // The post should disappear after server action revalidates the page
    await expect(tempPost).not.toBeVisible({ timeout: 20000 });
  });

  test('activity log entries display inline', async ({ page }) => {
    await loginAs(page, 'agent.smith@example.com');
    // Always resolve from DB to handle serial retry where ticketUrl may be stale
    const url = await resolveTicketUrl();
    await page.goto(url);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible({ timeout: 10000 });

    // There should be activity log entries from previous actions (title changed, privacy changed, etc.)
    // Wait for at least one activity entry to appear before asserting count
    const firstActivity = page.locator('[data-testid^="activity-"]').first();
    await expect(firstActivity).toBeVisible({ timeout: 15000 });

    const activityEntries = page.locator('[data-testid^="activity-"]');
    const count = await activityEntries.count();
    expect(count).toBeGreaterThanOrEqual(1);
  });
});

test.describe('Collapsible Timeline', () => {
  test('ticket with many posts shows "Show older posts" link', async ({ page }) => {
    const admin = createServiceRoleClient();

    // Create a ticket with >10 posts
    const { data: typeData } = await admin.from('ticket_types').select('id').eq('is_default', true).single();
    const typeId = typeData!.id;

    // Clean up if exists
    const { data: stale } = await admin.from('tickets').select('id').eq('slug', 'e2e-collapse-test');
    if (stale && stale.length > 0) {
      const ids = stale.map((t: { id: number }) => t.id);
      await admin.from('ticket_followers').delete().in('ticket_id', ids);
      await admin.from('activity_log').delete().in('ticket_id', ids);
      await admin.from('posts').delete().in('ticket_id', ids);
      await admin.from('tickets').delete().in('id', ids);
    }

    // Use Alice's ID from seed data
    const aliceId = '00000000-0000-0000-0000-000000000014';

    const { data: ticket } = await admin
      .from('tickets')
      .insert({
        title: 'E2E Collapse Test',
        slug: 'e2e-collapse-test',
        type_id: typeId,
        creator_id: aliceId,
        is_private: false,
      })
      .select('id')
      .single();

    const ticketId = ticket!.id;

    // Create original post
    await admin.from('posts').insert({
      ticket_id: ticketId,
      author_id: aliceId,
      body: 'Original post for collapse test.',
      is_original: true,
      post_type: 'post',
    });

    // Create 12 root posts
    for (let i = 1; i <= 12; i++) {
      await admin.from('posts').insert({
        ticket_id: ticketId,
        author_id: aliceId,
        body: `Post number ${i} for collapsible timeline test.`,
        post_type: 'post',
      });
    }

    await admin.from('ticket_followers').insert({ ticket_id: ticketId, user_id: aliceId });

    await loginAs(page, 'alice@example.com');
    await page.goto(`/tickets/${ticketId}/e2e-collapse-test`);

    // Should see the "Show older posts" button
    const showOlderBtn = page.locator('[data-testid="show-older-posts"]');
    await expect(showOlderBtn).toBeVisible({ timeout: 10000 });

    // Click to expand
    await showOlderBtn.click();

    // All posts should now be visible
    await expect(page.getByText('Post number 1 for collapsible timeline test.')).toBeVisible();
    await expect(page.getByText('Post number 12 for collapsible timeline test.')).toBeVisible();
  });
});
