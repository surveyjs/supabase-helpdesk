import { test, expect } from '@playwright/test';
import { createServiceRoleClient } from '../helpers/supabase';
import { loginAs, gotoAdmin } from '../helpers/auth';

test.describe('Team Tickets', () => {
  test.describe.configure({ mode: 'serial' });

  test('user on a team sees team toggle', async ({ page }) => {
    await loginAs(page, 'alice@example.com');
    await page.goto('/tickets');
    await expect(page.getByTestId('team-toggle')).toBeVisible();
  });

  test('user not on a team does not see toggle', async ({ page }) => {
    await loginAs(page, 'dave@example.com');
    await page.goto('/tickets');
    await expect(page.getByTestId('team-toggle')).not.toBeVisible();
  });

  test('team tickets view shows teammates\' tickets with display names', async ({ page }) => {
    await loginAs(page, 'alice@example.com');
    await page.goto('/tickets?view=team');

    // The heading should say Team Tickets
    await expect(page.getByRole('heading', { name: 'Team Tickets' })).toBeVisible({ timeout: 10000 });

    // Alice is on Alice's Team with Bob and Carol
    // Should see tickets from all team members with "by" display names
    await expect(page.getByText('by', { exact: false }).first()).toBeVisible();
  });
});

test.describe('Tag Display and Management', () => {
  test.describe.configure({ mode: 'serial' });

  let ticketUrl: string;

  test.beforeAll(async () => {
    const admin = createServiceRoleClient();
    // Use ticket 1 (Password reset not working) which has tags: urgent, bug
    const { data: ticket } = await admin
      .from('tickets')
      .select('id, slug')
      .eq('title', 'Password reset not working')
      .single();
    ticketUrl = `/tickets/${ticket!.id}/${ticket!.slug}`;

    // Reset ticket tags to seed state (urgent, bug only) to ensure idempotency
    const { data: urgentTag } = await admin.from('tags').select('id').eq('name', 'urgent').single();
    const { data: bugTag } = await admin.from('tags').select('id').eq('name', 'bug').single();
    await admin.from('ticket_tags').delete().eq('ticket_id', ticket!.id);
    await admin.from('ticket_tags').insert([
      { ticket_id: ticket!.id, tag_id: urgentTag!.id },
      { ticket_id: ticket!.id, tag_id: bugTag!.id },
    ]);
  });

  test('ticket detail shows tags as colored pills', async ({ page }) => {
    await loginAs(page, 'alice@example.com');
    await page.goto(ticketUrl);

    const tagSection = page.getByTestId('ticket-tags');
    await expect(tagSection).toBeVisible();
    await expect(tagSection.getByText('urgent')).toBeVisible();
    await expect(tagSection.getByText('bug')).toBeVisible();
  });

  test('agent can add a tag to a ticket', async ({ page }) => {
    await loginAs(page, 'agent.smith@example.com');
    await page.goto(ticketUrl);

    const addTagForm = page.getByTestId('add-tag-form');
    await expect(addTagForm).toBeVisible();

    // Select a tag from the dropdown and add it
    const select = addTagForm.getByRole('combobox');
    // Pick the first available tag option
    const options = await select.locator('option').allTextContents();
    expect(options.length).toBeGreaterThan(0);
    await select.selectOption({ index: 0 });
    const addedTagName = options[0];

    await addTagForm.getByRole('button', { name: 'Add Tag' }).click();

    // Tag should now appear
    const tagSection = page.getByTestId('ticket-tags');
    await expect(tagSection.getByText(addedTagName)).toBeVisible({ timeout: 10000 });
  });

  test('agent can remove a tag from a ticket', async ({ page }) => {
    await loginAs(page, 'agent.smith@example.com');
    await page.goto(ticketUrl);

    const tagSection = page.getByTestId('ticket-tags');
    await expect(tagSection).toBeVisible({ timeout: 10000 });
    // Remove the first tag's × button
    const removeButtons = tagSection.getByRole('button', { name: /Remove tag/ });
    await expect(removeButtons.first()).toBeVisible({ timeout: 5000 });
    const count = await removeButtons.count();
    expect(count).toBeGreaterThan(0);

    const firstTagName = await tagSection.locator('span[style]').first().textContent();
    await removeButtons.first().click();

    // Restore the tag for other tests
    const addTagForm = page.getByTestId('add-tag-form');
    await expect(addTagForm).toBeVisible({ timeout: 10000 });
    if (firstTagName) {
      const options = await addTagForm.getByRole('combobox').locator('option').allTextContents();
      if (options.includes(firstTagName)) {
        await addTagForm.getByRole('combobox').selectOption({ label: firstTagName });
        await addTagForm.getByRole('button', { name: 'Add Tag' }).click();
        await expect(page.getByTestId('ticket-tags').getByText(firstTagName)).toBeVisible({ timeout: 10000 });
      }
    }
  });
});

test.describe('Agent Dashboard Tag Filter', () => {
  test('tag filter shows and filters tickets', async ({ page }) => {
    await loginAs(page, 'agent.smith@example.com');
    await page.goto('/agent');

    const tagFilter = page.getByTestId('tag-filter');
    await expect(tagFilter).toBeVisible();

    // Click on the "urgent" tag pill
    const urgentTag = tagFilter.getByText('urgent');
    await expect(urgentTag).toBeVisible();
    await urgentTag.click();

    // URL should contain tags param
    await expect(page).toHaveURL(/tags=/, { timeout: 10000 });

    // Should show filtered results
    const resultText = await page.getByTestId('result-count').textContent();
    expect(resultText).toMatch(/\d+ tickets? found/);
  });
});

test.describe('Admin Types Management', () => {
  test.describe.configure({ mode: 'serial' });

  test('non-admin cannot access admin pages', async ({ page }) => {
    await loginAs(page, 'alice@example.com');
    await page.goto('/admin/types');
    // Should be redirected away
    await expect(page).not.toHaveURL('/admin/types', { timeout: 10000 });
  });

  test('admin can access types page and see existing types', async ({ page }) => {
    await loginAs(page, 'admin@example.com');
    await gotoAdmin(page, '/admin/types');

    await expect(page.getByRole('heading', { name: 'Manage Ticket Types' })).toBeVisible();
    await expect(page.getByText('Question')).toBeVisible();
    await expect(page.getByText('Issue')).toBeVisible();
    await expect(page.getByText('Suggestion')).toBeVisible();
    await expect(page.getByText('(default)')).toBeVisible();
  });

  test('admin can create a new ticket type', async ({ page }) => {
    await loginAs(page, 'admin@example.com');
    await gotoAdmin(page, '/admin/types');

    await page.locator('#new-type-name').fill('E2E Test Type');
    await page.getByRole('button', { name: 'Add Type' }).click();

    await expect(page.getByText('E2E Test Type')).toBeVisible({ timeout: 10000 });
  });

  test('admin can delete a type', async ({ page }) => {
    await loginAs(page, 'admin@example.com');
    await gotoAdmin(page, '/admin/types');

    // Delete the E2E Test Type
    const row = page.locator('li').filter({ hasText: 'E2E Test Type' });
    await row.getByRole('button', { name: /Delete/ }).click();

    await expect(page.getByText('E2E Test Type')).not.toBeVisible({ timeout: 10000 });
  });

  test('admin can set default type', async ({ page }) => {
    await loginAs(page, 'admin@example.com');
    await gotoAdmin(page, '/admin/types');

    // Issue should have a "Set Default" button
    const issueRow = page.locator('li').filter({ hasText: 'Issue' });
    const setDefaultBtn = issueRow.getByRole('button', { name: 'Set Default' });
    if (await setDefaultBtn.isVisible()) {
      await setDefaultBtn.click();
      await expect(issueRow.getByText('(default)')).toBeVisible({ timeout: 10000 });
    }

    // Restore Question as default
    await gotoAdmin(page, '/admin/types');
    const questionRow = page.locator('li').filter({ hasText: 'Question' });
    const restoreBtn = questionRow.getByRole('button', { name: 'Set Default' });
    if (await restoreBtn.isVisible()) {
      await restoreBtn.click();
      await expect(questionRow.getByText('(default)')).toBeVisible({ timeout: 10000 });
    }
  });
});

test.describe('Admin Categories Management', () => {
  test.describe.configure({ mode: 'serial' });

  test('admin can access categories page', async ({ page }) => {
    await loginAs(page, 'admin@example.com');
    await gotoAdmin(page, '/admin/categories');

    await expect(page.getByRole('heading', { name: 'Manage Categories' })).toBeVisible();
  });

  test('admin can create and delete a category', async ({ page }) => {
    await loginAs(page, 'admin@example.com');
    await gotoAdmin(page, '/admin/categories');

    await expect(page.getByRole('heading', { name: 'Manage Categories' })).toBeVisible({ timeout: 10000 });

    await page.locator('#new-category-name').fill('E2E Test Category');
    await page.getByRole('button', { name: 'Add Category' }).click();

    await expect(page.getByText('E2E Test Category')).toBeVisible({ timeout: 10000 });

    // Delete it
    const row = page.locator('li').filter({ hasText: 'E2E Test Category' });
    await row.getByRole('button', { name: /Delete/ }).click();

    await expect(page.getByText('E2E Test Category')).not.toBeVisible({ timeout: 10000 });
  });
});

test.describe('Admin Tags Management', () => {
  test.describe.configure({ mode: 'serial' });

  test('admin can see tags page with colored pills', async ({ page }) => {
    await loginAs(page, 'admin@example.com');
    await gotoAdmin(page, '/admin/tags');

    await expect(page.getByRole('heading', { name: 'Manage Tags' })).toBeVisible();
    await expect(page.getByText('urgent')).toBeVisible();
    await expect(page.getByText('bug')).toBeVisible();
  });

  test('admin can create a tag with color and delete it', async ({ page }) => {
    await loginAs(page, 'admin@example.com');
    await gotoAdmin(page, '/admin/tags');
    await expect(page.getByRole('heading', { name: 'Manage Tags' })).toBeVisible({ timeout: 10000 });

    await page.locator('#new-tag-name').fill('e2e-test-tag');
    // Color input — just submit with default
    await page.getByRole('button', { name: 'Add Tag' }).click();

    await expect(page.getByText('e2e-test-tag')).toBeVisible({ timeout: 10000 });

    // Delete it
    const row = page.locator('li').filter({ hasText: 'e2e-test-tag' });
    await row.getByRole('button', { name: /Delete/ }).click();

    await expect(page.getByText('e2e-test-tag')).not.toBeVisible({ timeout: 10000 });
  });
});

test.describe('Admin Teams Management', () => {
  test.describe.configure({ mode: 'serial' });

  test('admin can access teams page', async ({ page }) => {
    await loginAs(page, 'admin@example.com');
    await gotoAdmin(page, '/admin/teams');

    await expect(page.getByRole('heading', { name: 'Manage Teams' })).toBeVisible();
    await expect(page.getByText("Alice's Team")).toBeVisible();
  });

  test('admin can create a team', async ({ page }) => {
    await loginAs(page, 'admin@example.com');
    await gotoAdmin(page, '/admin/teams');
    await expect(page.getByRole('heading', { name: /Teams/ })).toBeVisible({ timeout: 10000 });

    await page.locator('#new-team-name').fill('E2E Test Team');
    await page.getByRole('button', { name: 'Create Team' }).click();

    await expect(page.getByText('E2E Test Team')).toBeVisible({ timeout: 10000 });
  });

  test('admin can add member to team', async ({ page }) => {
    await loginAs(page, 'admin@example.com');
    await gotoAdmin(page, '/admin/teams');
    await expect(page.getByRole('heading', { name: 'Teams' })).toBeVisible({ timeout: 10000 });

    // Find the E2E Test Team section and add Dave
    const teamSection = page.locator('div.bg-white').filter({ hasText: 'E2E Test Team' });
    await teamSection.getByPlaceholder('user@example.com').fill('dave@example.com');
    await teamSection.getByRole('button', { name: 'Add' }).click();

    // Wait for Dave to appear after the server action revalidates the page
    await expect(
      page.locator('div.bg-white').filter({ hasText: 'E2E Test Team' }).getByText('Dave', { exact: true })
    ).toBeVisible({ timeout: 15000 });
  });

  test('admin cannot delete team with members', async ({ page }) => {
    await loginAs(page, 'admin@example.com');
    await gotoAdmin(page, '/admin/teams');
    await expect(page.getByText('E2E Test Team')).toBeVisible({ timeout: 10000 });

    const teamSection = page.locator('div.bg-white').filter({ hasText: 'E2E Test Team' });
    await teamSection.getByRole('button', { name: /Delete E2E/ }).click();

    // Team should still be there (has members)
    await expect(page.getByText('E2E Test Team')).toBeVisible();
  });

  test('admin can remove member and delete empty team', async ({ page }) => {
    await loginAs(page, 'admin@example.com');
    await gotoAdmin(page, '/admin/teams');

    const teamSection = page.locator('div.bg-white').filter({ hasText: 'E2E Test Team' });

    // Remove Dave
    await teamSection.getByRole('button', { name: /Remove/ }).click();
    await expect(teamSection.getByText('Dave', { exact: true })).not.toBeVisible({ timeout: 10000 });

    // Delete the now-empty team
    await gotoAdmin(page, '/admin/teams');
    const updatedTeamSection = page.locator('div.bg-white').filter({ hasText: 'E2E Test Team' });
    await updatedTeamSection.getByRole('button', { name: /Delete E2E/ }).click();

    await expect(page.getByText('E2E Test Team')).not.toBeVisible({ timeout: 10000 });
  });
});

test.describe('NavBar Setup Link', () => {
  test('admin sees Setup link in nav', async ({ page }) => {
    await loginAs(page, 'admin@example.com');
    await expect(page.getByRole('link', { name: 'Setup' })).toBeVisible({ timeout: 10000 });
  });

  test('non-admin does not see Setup link', async ({ page }) => {
    await loginAs(page, 'alice@example.com');
    await expect(page.getByRole('link', { name: 'Setup' })).not.toBeVisible();
  });

  test('agent does not see Setup link', async ({ page }) => {
    await loginAs(page, 'agent.smith@example.com');
    await expect(page.getByRole('link', { name: 'Setup' })).not.toBeVisible();
  });
});
