import { test, expect } from './fixtures';
import { createServiceRoleClient } from '../helpers/supabase';
import { loginViaForm } from '../helpers/auth';

// #103: admin-defined custom fields on users, staff-only or shared with the user.
// Writes global field definitions: runs in global-settings.

const SUFFIX = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
// Not prefixed E2E: admin-setup.spec bulk-deletes `E2E%` fields.
const SHARED = `PlanUF${SUFFIX}`;
const STAFF = `InternalUF${SUFFIX}`;
const SLUG = `e2e-user-fields-${SUFFIX}`;

test.describe('User custom fields', () => {
  test.describe.configure({ mode: 'serial' });
  let aliceId: string;
  let ticketUrl: string;

  test.beforeAll(async () => {
    const admin = createServiceRoleClient();
    const { error } = await admin.from('custom_fields').insert([
      { name: SHARED, field_type: 'dropdown', options: ['Gold', 'Silver'], applies_to: 'user', agent_only: false, display_order: 9400 },
      { name: STAFF, field_type: 'text', applies_to: 'user', agent_only: true, display_order: 9401 },
    ]);
    if (error) throw new Error(error.message);
    const { data: alice } = await admin.from('profiles').select('id').eq('email', 'alice@example.com').single();
    aliceId = alice!.id;
    const { data: type } = await admin.from('ticket_types').select('id').limit(1).single();
    const { data: t, error: tErr } = await admin
      .from('tickets')
      .insert({ title: 'E2E User Fields', slug: SLUG, creator_id: aliceId, type_id: type!.id })
      .select('id, slug')
      .single();
    if (tErr) throw new Error(tErr.message);
    ticketUrl = `/tickets/${t!.id}/${t!.slug}`;
  });

  test.afterAll(async () => {
    const admin = createServiceRoleClient();
    await admin.from('tickets').delete().eq('slug', SLUG);
    await admin.from('custom_fields').delete().in('name', [SHARED, STAFF]);
  });

  test('an agent sets the values on the user page', async ({ page }) => {
    await loginViaForm(page, 'agent.smith@example.com');
    await page.goto(`/agent/users/${aliceId}`);
    const form = page.getByTestId('user-fields-form');
    await form.getByLabel(SHARED).selectOption('Gold');
    await form.getByLabel(STAFF).fill('Renewal due in March');
    await form.getByTestId('save-user-fields-btn').click();
    await expect(form.getByRole('status')).toHaveText('Saved.');

    await page.goto(ticketUrl);
    await expect(page.getByTestId(`owner-field-${SHARED}`)).toContainText('Gold');
    await expect(page.getByTestId(`owner-field-${STAFF}`)).toContainText('Renewal due in March');
  });

  test('the user sees the shared field on their profile, never the staff-only one', async ({ page }) => {
    await loginViaForm(page, 'alice@example.com');
    await page.goto('/profile');
    await expect(page.getByTestId(`profile-field-${SHARED}`)).toContainText('Gold');
    await expect(page.getByTestId(`profile-field-${STAFF}`)).toHaveCount(0);
    expect(await page.content()).not.toContain('Renewal due in March');

    await page.goto(ticketUrl);
    await expect(page.getByTestId(`owner-field-${SHARED}`)).toHaveCount(0);
  });
});
