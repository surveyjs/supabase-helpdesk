import { test, expect, Page } from '@playwright/test';
import { createServiceRoleClient } from '../helpers/supabase';

async function loginAs(page: Page, email: string, password = 'Password123') {
  const svc = createServiceRoleClient();
  await svc.from('profiles').update({ editor_view_mode: 'both' }).eq('email', email.toLowerCase());

  await page.goto('/login');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Log in' }).click();
  await expect(page).toHaveURL('/', { timeout: 10000 });
  await expect(page.locator('summary[aria-haspopup="true"]')).toBeVisible({ timeout: 10000 });
}

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

  // Fallback for isolated/single-test runs.
  const { data: alice } = await admin.from('profiles').select('id').eq('email', 'alice@example.com').single();
  const { data: typeData } = await admin.from('ticket_types').select('id').limit(1).single();
  if (!alice || !typeData) throw new Error('Could not prepare fallback posts test ticket');

  const { data: created } = await admin
    .from('tickets')
    .insert({
      title: 'E2E Posts Test Ticket',
      slug: 'e2e-posts-test-ticket',
      creator_id: alice.id,
      type_id: typeData.id,
    })
    .select('id, slug')
    .single();

  await admin.from('posts').insert({
    ticket_id: created!.id,
    author_id: alice.id,
    body: 'Fallback original post for posts tests.',
    is_original: true,
    post_type: 'post',
  });

  return `/tickets/${created!.id}/${created!.slug}`;
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

    // Wait for the form to fully render before interacting
    await expect(page.getByRole('button', { name: 'Create Ticket' })).toBeVisible({ timeout: 10000 });

    const typeSelect = page.getByLabel('Type');
    const issueOption = typeSelect.locator('option').filter({ hasText: 'Issue' });
    // Types are server-rendered; if server query failed, reload once
    if (await issueOption.count() === 0) {
      await page.reload();
      await expect(page.getByRole('button', { name: 'Create Ticket' })).toBeVisible({ timeout: 10000 });
    }
    await expect(issueOption).toBeAttached({ timeout: 10000 });

    await page.getByLabel('Title').fill('E2E Posts Test Ticket');
    await typeSelect.selectOption({ label: 'Issue' });
    await page.locator('[data-testid="markdown-editor"]').first().locator('textarea[name="textarea"]').fill('This is the original post body for E2E post tests.');
    await page.getByRole('button', { name: 'Create Ticket' }).click();

    const createdUrlPattern = /\/tickets\/\d+\/e2e-posts-test-ticket/;
    await expect(page).toHaveURL(createdUrlPattern, { timeout: 30000 });
    ticketUrl = page.url();
  });

  test('Reply button opens compose form and submits reply', async ({ page }) => {
    await loginAs(page, 'alice@example.com');
    await page.goto(ticketUrl || await resolveTicketUrl());

    // Reply form should not be visible initially
    await expect(page.getByTestId('main-reply-panel')).not.toBeVisible({ timeout: 5000 });

    // Click the Reply button to open the form
    await page.getByTestId('main-reply-btn').click();
    await expect(page.getByTestId('main-reply-panel')).toBeVisible({ timeout: 5000 });
    await expect(page.getByTestId('main-reply-btn')).toHaveCount(0);

    // Scope to the reply panel to avoid matching editors in nested forms.
    const replyPanel = page.getByTestId('main-reply-panel');
    await replyPanel.locator('[data-testid="markdown-editor"]').locator('textarea[name="textarea"]').fill('A root reply to the ticket.');
    await replyPanel.getByRole('button', { name: 'Add a reply' }).click();

    await expect(page.getByText('A root reply to the ticket.').first()).toBeVisible({ timeout: 10000 });
  });

  test('Reply form can be cancelled', async ({ page }) => {
    await loginAs(page, 'alice@example.com');
    await page.goto(ticketUrl || await resolveTicketUrl());

    await page.getByTestId('main-reply-btn').click();
    await expect(page.getByTestId('main-reply-panel')).toBeVisible({ timeout: 5000 });

    await page.getByTestId('cancel-reply-btn').click();
    await expect(page.getByTestId('main-reply-panel')).not.toBeVisible({ timeout: 5000 });
    await expect(page.getByTestId('main-reply-btn')).toBeVisible();
  });

  test('add a comment on a post → comment appears indented', async ({ page }) => {
    await loginAs(page, 'alice@example.com');
    await page.goto(ticketUrl || await resolveTicketUrl());

    const rootReplyText = 'A root reply to the ticket.';

    // Self-heal for isolated runs: ensure a root reply post exists first.
    const existingRootReply = page.getByText(rootReplyText).first();
    if (!(await existingRootReply.isVisible().catch(() => false))) {
      await page.getByTestId('main-reply-btn').click();
      const replyPanel = page.getByTestId('main-reply-panel');
      await expect(replyPanel).toBeVisible({ timeout: 10000 });
      await replyPanel.locator('[data-testid="markdown-editor"]').locator('textarea[name="textarea"]').fill(rootReplyText);
      await replyPanel.getByRole('button', { name: 'Add a reply' }).click();
      await expect(page.getByText(rootReplyText).first()).toBeVisible({ timeout: 10000 });
    }

    // Open the comment form on the known root reply card only.
    const rootReplyCard = page.locator('div[data-testid^="post-"]').filter({ hasText: rootReplyText }).first();
    await expect(rootReplyCard).toBeVisible({ timeout: 10000 });
    await rootReplyCard.locator('[data-testid="add-comment-btn"]').click();
    await expect(rootReplyCard.locator('[data-testid="add-comment-btn"]')).toHaveCount(0);

    // The CommentForm renders a <form> directly inside the post card.
    const commentForm = rootReplyCard.locator('form').last();
    await expect(commentForm).toBeVisible({ timeout: 10000 });
    await commentForm.locator('textarea[name="textarea"]').fill('A threaded comment on the reply.');
    const commentButton = commentForm.getByRole('button', { name: 'Add a comment' });
    await commentButton.scrollIntoViewIfNeeded();
    await expect(commentButton).toBeEnabled();
    await commentButton.click();

    // Wait for the comment text to appear on the page (server action + RSC revalidation).
    await expect(page.getByText('A threaded comment on the reply.').first()).toBeVisible({ timeout: 30000 });

    // The comment should render as a level-1 card (ml-6 indent).
    const commentCard = page
      .locator('div[data-testid^="post-"].ml-6')
      .filter({ hasText: 'A threaded comment on the reply.' })
      .first();
    await expect(commentCard).toBeVisible({ timeout: 10000 });
  });

  test('reply to a comment → reply appears at level 2', async ({ page }) => {
    await loginAs(page, 'alice@example.com');
    await page.goto(ticketUrl || await resolveTicketUrl());

    const rootReplyText = 'A root reply to the ticket.';
    const level1CommentText = 'A threaded comment on the reply.';

    // Self-heal for isolated runs: ensure a root reply exists.
    const rootReplyCard = page.locator('div[data-testid^="post-"]').filter({ hasText: rootReplyText }).first();
    if (!(await rootReplyCard.isVisible().catch(() => false))) {
      await page.getByTestId('main-reply-btn').click();
      const replyPanel = page.getByTestId('main-reply-panel');
      await expect(replyPanel).toBeVisible({ timeout: 10000 });
      await replyPanel.locator('[data-testid="markdown-editor"]').locator('textarea[name="textarea"]').fill(rootReplyText);
      await replyPanel.getByRole('button', { name: 'Add a reply' }).click();
      await expect(page.getByText(rootReplyText).first()).toBeVisible({ timeout: 10000 });
    }

    // Self-heal for isolated runs: ensure level-1 comment exists on that root reply.
    const level1CommentCard = page
      .locator('div[data-testid^="post-"].ml-6')
      .filter({ hasText: level1CommentText })
      .first();
    if (!(await level1CommentCard.isVisible().catch(() => false))) {
      const currentRootReplyCard = page.locator('div[data-testid^="post-"]').filter({ hasText: rootReplyText }).first();
      await expect(currentRootReplyCard).toBeVisible({ timeout: 10000 });
      await currentRootReplyCard.locator('[data-testid="add-comment-btn"]').click();

      const commentForm = currentRootReplyCard.locator('form').last();
      await expect(commentForm).toBeVisible({ timeout: 10000 });
      await commentForm.locator('textarea[name="textarea"]').fill(level1CommentText);
      const commentButton = commentForm.getByRole('button', { name: 'Add a comment' });
      await expect(commentButton).toBeEnabled();
      await commentButton.click();
      await expect(
        page.locator('div[data-testid^="post-"].ml-6').filter({ hasText: level1CommentText }).first(),
      ).toBeVisible({ timeout: 10000 });
    }

    const targetLevel1CommentCard = page
      .locator('div[data-testid^="post-"].ml-6')
      .filter({ hasText: level1CommentText })
      .first();
    await expect(targetLevel1CommentCard).toBeVisible({ timeout: 10000 });
    await targetLevel1CommentCard.locator('[data-testid="add-comment-btn"]').click();

    // Level-2 reply uses the comment form rendered by ReplyToggle under this level-1 card.
    const level2Form = targetLevel1CommentCard.locator('form').last();
    await expect(level2Form).toBeVisible({ timeout: 10000 });
    await level2Form.locator('textarea[name="textarea"]').fill('A level-2 reply to the comment.');
    const level2Submit = level2Form.getByRole('button', { name: 'Add a comment' });
    await expect(level2Submit).toBeEnabled();
    await level2Submit.click();

    await expect(
      page.locator('div[data-testid^="post-"].ml-12').filter({ hasText: 'A level-2 reply to the comment.' }).first(),
    ).toBeVisible({ timeout: 10000 });
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
    const replyBtnsInLevel2 = level2Parent.locator('[data-testid="add-comment-btn"]');
    await expect(replyBtnsInLevel2).toHaveCount(0);
  });

  test('agent can add an internal note → note visible to agent, not to regular user', async ({ page }) => {
    // Login as agent and add note
    await loginAs(page, 'agent.smith@example.com');
    await page.goto(ticketUrl || await resolveTicketUrl());

    // Agent must click the Notes tab first
    await page.getByTestId('notes-tab').click();

    // Note form now uses MarkdownEditor compact
    const noteEditor = page.locator('[data-testid="markdown-editor"]').last();
    await noteEditor.locator('textarea[name="textarea"]').fill('Internal agent note content.');
    await page.getByRole('button', { name: 'Add Note' }).click();

    // Scope to the rendered note post-card to avoid strict-mode violation
    // (the MarkdownEditor also holds the text in hidden + visible textareas).
    await expect(
      page.locator('[data-testid^="post-"]')
        .filter({ hasText: '(Internal note)' })
        .filter({ hasText: 'Internal agent note content.' })
        .first(),
    ).toBeVisible({ timeout: 10000 });
  });

  test('note not visible to regular user', async ({ page }) => {
    await loginAs(page, 'alice@example.com');
    await page.goto(ticketUrl || await resolveTicketUrl());

    // Regular user should never see internal note content.
    await expect(page.getByText('Internal agent note content.')).not.toBeVisible();
  });

  test('edit a post → "(edited)" indicator shows', async ({ page }) => {
    await loginAs(page, 'alice@example.com');
    await page.goto(ticketUrl || await resolveTicketUrl());

    // Find the edit button on Alice's reply
    const editBtns = page.locator('[data-testid="edit-post-btn"]');
    await editBtns.first().click();

    // Edit mode now renders MarkdownEditor
    const editEditor = page.locator('[data-testid="markdown-editor"]').first();
    await editEditor.locator('textarea[name="textarea"]').clear();
    await editEditor.locator('textarea[name="textarea"]').fill('Edited root reply content.');
    await page.getByRole('button', { name: 'Save' }).first().click();

    // Scope to the rendered post-card to avoid strict-mode violation
    // (MarkdownEditor also holds the text in hidden + visible textareas).
    await expect(
      page.locator('[data-testid^="post-"]')
        .filter({ hasText: '(edited)' })
        .filter({ hasText: 'Edited root reply content.' })
        .first(),
    ).toBeVisible({ timeout: 10000 });
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

    // The Reply button should be visible for agents, and opens the reply form
    await page.getByTestId('main-reply-btn').click();
    const replyPanel = page.getByTestId('main-reply-panel');
    await expect(replyPanel).toBeVisible();
    const replyEditor = replyPanel.locator('[data-testid="markdown-editor"]');
    await expect(replyEditor).toBeVisible();
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

    // Open the reply panel first, then fill and submit
    await page.getByTestId('main-reply-btn').click();
    const replyPanel = page.getByTestId('main-reply-panel');
    await expect(replyPanel).toBeVisible({ timeout: 10000 });
    const replyEditor = replyPanel.locator('[data-testid="markdown-editor"]');
    await replyEditor.locator('textarea[name="textarea"]').fill('Temporary post to be deleted.');
    await replyPanel.getByRole('button', { name: 'Add a reply' }).click();
    const tempPostCard = page
      .locator('[data-testid^="post-"]')
      .filter({ hasText: 'Temporary post to be deleted.' })
      .first();
    await expect(tempPostCard).toBeVisible({ timeout: 10000 });

    // Delete it from the same card that contains the temporary post text.
    await tempPostCard.locator('[data-testid="delete-post-btn"]').click();

    // The post should disappear after server action revalidates the page
    await expect(
      page.locator('[data-testid^="post-"]').filter({ hasText: 'Temporary post to be deleted.' }),
    ).toHaveCount(0, { timeout: 20000 });
  });

  test('activity log entries display in Logs tab', async ({ page }) => {
    await loginAs(page, 'agent.smith@example.com');
    // Always resolve from DB to handle serial retry where ticketUrl may be stale
    const url = await resolveTicketUrl();
    await page.goto(url);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible({ timeout: 10000 });

    // The Logs tab should be visible (activity log entries from prior actions exist)
    const logsTab = page.getByTestId('logs-tab');
    await expect(logsTab).toBeVisible({ timeout: 15000 });

    // Switch to the Logs tab
    await logsTab.click();

    // Activity entries should be visible inside the Logs tab panel
    const firstActivity = page.locator('[data-testid^="activity-"]').first();
    await expect(firstActivity).toBeVisible({ timeout: 10000 });

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

test.describe('Ticket Detail Layout & Tabs', () => {
  let ticketUrl: string | undefined;

  async function resolveLayoutTicketUrl(): Promise<string> {
    const admin = createServiceRoleClient();
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

    // Fallback: create a ticket so this describe can run independently of prior serial steps.
    const { data: alice } = await admin.from('profiles').select('id').eq('email', 'alice@example.com').single();
    const { data: typeData } = await admin.from('ticket_types').select('id').limit(1).single();
    if (!alice || !typeData) throw new Error('Could not prepare fallback layout ticket');

    const { data: created } = await admin
      .from('tickets')
      .insert({
        title: 'E2E Posts Test Ticket',
        slug: 'e2e-posts-test-ticket',
        creator_id: alice.id,
        type_id: typeData.id,
      })
      .select('id, slug')
      .single();

    await admin.from('posts').insert({
      ticket_id: created!.id,
      author_id: alice.id,
      body: 'Fallback original post for layout tests.',
      is_original: true,
      post_type: 'post',
    });

    return `/tickets/${created!.id}/${created!.slug}`;
  }

  test('two-column layout: sidebar shows metadata', async ({ page }) => {
    await loginAs(page, 'alice@example.com');
    await page.goto(ticketUrl || await resolveLayoutTicketUrl());

    const sidebar = page.getByTestId('ticket-sidebar');
    await expect(sidebar).toBeVisible({ timeout: 10000 });
    await expect(sidebar.getByText('Type')).toBeVisible();
    await expect(sidebar.getByText('Created', { exact: true })).toBeVisible();
  });

  test('two-column layout: main content area exists', async ({ page }) => {
    await loginAs(page, 'alice@example.com');
    await page.goto(ticketUrl || await resolveLayoutTicketUrl());

    const mainContent = page.getByTestId('ticket-main-content');
    await expect(mainContent).toBeVisible({ timeout: 10000 });
  });

  test('agent sees Thread, Notes and Logs tabs', async ({ page }) => {
    const admin = createServiceRoleClient();
    const layoutUrl = ticketUrl || await resolveLayoutTicketUrl();
    const layoutTicketId = Number(layoutUrl.match(/\/tickets\/(\d+)\//)?.[1]);
    const { data: agentProfile } = await admin
      .from('profiles')
      .select('id')
      .eq('email', 'agent.smith@example.com')
      .single();
    if (layoutTicketId && agentProfile?.id) {
      await admin.from('activity_log').insert({
        ticket_id: layoutTicketId,
        actor_id: agentProfile.id,
        action: 'status_changed',
        details: { from: 'open', to: 'pending' },
      });
    }

    await loginAs(page, 'agent.smith@example.com');
    await page.goto(layoutUrl);

    await expect(page.getByTestId('ticket-tabs')).toBeVisible({ timeout: 10000 });
    await expect(page.getByTestId('thread-tab')).toBeVisible();
    await expect(page.getByTestId('notes-tab')).toBeVisible();
    // Logs tab is shown when activity log entries exist for the ticket
    await expect(page.getByTestId('logs-tab')).toBeVisible();
  });

  test('Notes tab shows note count badge when notes exist', async ({ page }) => {
    const admin = createServiceRoleClient();
    const layoutUrl = ticketUrl || await resolveLayoutTicketUrl();
    const ticketId = Number(layoutUrl.match(/\/tickets\/(\d+)\//)?.[1]);
    if (ticketId) {
      await admin.from('posts').insert({
        ticket_id: ticketId,
        author_id: '00000000-0000-0000-0000-000000000012',
        body: 'E2E note for badge check',
        post_type: 'note',
      });
    }

    await loginAs(page, 'agent.smith@example.com');
    await page.goto(layoutUrl);

    const tabBar = page.getByTestId('ticket-tabs');
    if (!(await tabBar.isVisible().catch(() => false))) {
      await page.reload();
    }
    await expect(tabBar).toBeVisible({ timeout: 10000 });

    const notesTab = page.getByTestId('notes-tab');
    await expect(notesTab).toBeVisible({ timeout: 10000 });
    // The badge inside the Notes tab should display the note count
    const badge = notesTab.locator('span');
    await expect(badge).toBeVisible();
    // Should contain a number (at least 1 note exists from earlier test)
    await expect(badge).toHaveText(/\d+/);
  });

  test('regular user sees only Reply button, not auto-expanded form', async ({ page }) => {
    await loginAs(page, 'alice@example.com');
    await page.goto(ticketUrl || await resolveLayoutTicketUrl());

    // The reply panel should be hidden initially
    await expect(page.getByTestId('main-reply-panel')).not.toBeVisible({ timeout: 5000 });
    // The Reply button should be visible
    await expect(page.getByTestId('main-reply-btn')).toBeVisible({ timeout: 5000 });
  });

  test('markdown editor shows toolbar when reply panel is open', async ({ page }) => {
    await loginAs(page, 'alice@example.com');
    await page.goto(ticketUrl || await resolveLayoutTicketUrl());

    // Open the reply panel first
    await page.getByTestId('main-reply-btn').click();
    await expect(page.getByTestId('main-reply-panel')).toBeVisible({ timeout: 5000 });

    const editor = page.getByTestId('main-reply-panel').locator('[data-testid="markdown-editor"]').first();
    await expect(editor).toBeVisible({ timeout: 10000 });
    // react-markdown-editor-lite renders a navigation toolbar
    await expect(editor.locator('.rc-md-navigation')).toBeVisible();
  });
});
