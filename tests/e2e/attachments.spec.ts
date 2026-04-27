import { test, expect, Page } from '@playwright/test';
import { createServiceRoleClient } from '../helpers/supabase';
import * as path from 'path';
import * as fs from 'fs';

async function loginAs(page: Page, email: string, password = 'Password123') {
  const svc = createServiceRoleClient();
  await svc.from('login_attempts').delete().eq('email', email.toLowerCase());

  await page.goto('/login');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Log in' }).click();

  // Retry once on transient auth failure (rate-limit / timing)
  try {
    await expect(page).toHaveURL('/', { timeout: 10000 });
  } catch {
    // Only retry if we're actually on the login page (not already logged in)
    if (page.url().includes('/login')) {
      await svc.from('login_attempts').delete().eq('email', email.toLowerCase());
      await page.goto('/login');
      await page.getByLabel('Email').fill(email);
      await page.getByLabel('Password').fill(password);
      await page.getByRole('button', { name: 'Log in' }).click();
      await expect(page).toHaveURL('/', { timeout: 15000 });
    }
  }

  await expect(page.locator('summary[aria-haspopup="true"]')).toBeVisible({ timeout: 15000 });
}

/** Navigate to an admin page, retrying once if requireAdmin() redirect race occurs. */
async function gotoAdmin(page: Page, path: string) {
  await page.goto(path);
  try {
    await page.waitForURL(/\/admin/, { timeout: 5000 });
  } catch {
    await page.goto(path);
    await page.waitForURL(/\/admin/, { timeout: 10000 });
  }
}

// Create a temp file for upload testing
function createTempFile(name: string, content: string, dir: string): string {
  const filePath = path.join(dir, name);
  fs.writeFileSync(filePath, content);
  return filePath;
}

test.describe('File Attachments', () => {
  test.describe.configure({ mode: 'serial' });

  let ticketUrl: string;
  let tmpDir: string;

  async function resolveTicketUrl(): Promise<string> {
    if (ticketUrl) return ticketUrl;
    const svc = createServiceRoleClient();
    const { data } = await svc.from('tickets').select('id, slug').eq('slug', 'e2e-attachments-test-ticket').single();
    if (!data) throw new Error('Could not find e2e-attachments-test-ticket in DB');
    ticketUrl = `/tickets/${data.id}/${data.slug}`;
    return ticketUrl;
  }

  test.beforeAll(async () => {
    const admin = createServiceRoleClient();
    // Clean up any stale test tickets
    const { data: staleTickets } = await admin
      .from('tickets')
      .select('id')
      .in('slug', ['e2e-attachments-test-ticket']);
    if (staleTickets && staleTickets.length > 0) {
      const ids = staleTickets.map((t: { id: number }) => t.id);
      await admin.from('ticket_followers').delete().in('ticket_id', ids);
      await admin.from('activity_log').delete().in('ticket_id', ids);
      const { data: posts } = await admin.from('posts').select('id').in('ticket_id', ids);
      if (posts && posts.length > 0) {
        await admin.from('attachments').delete().in('post_id', posts.map((p: { id: string }) => p.id));
      }
      await admin.from('posts').delete().in('ticket_id', ids);
      await admin.from('tickets').delete().in('id', ids);
    }

    // Raise rate limit so concurrent E2E suites don't block ticket creation
    await admin.from('app_settings').upsert(
      { key: 'ticket_creation_rate_limit', value: '100' },
      { onConflict: 'key' },
    );

    // Create temp directory for test files
    tmpDir = path.join(__dirname, '..', '.tmp-attachments');
    if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });
  });

  test.afterAll(async () => {
    // Clean temp dir
    if (fs.existsSync(tmpDir)) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  test('create test ticket for attachment tests', async ({ page }) => {
    await loginAs(page, 'alice@example.com');
    await page.goto('/tickets/new');

    // Wait for form to be fully interactive
    await expect(page.getByLabel('Title')).toBeVisible({ timeout: 10000 });
    await page.getByLabel('Title').fill('E2E Attachments Test Ticket');
    await page.getByLabel('Type').selectOption({ label: 'Issue' });
    await page.locator('[data-testid="markdown-editor"]').first().locator('textarea[name="textarea"]').fill('Testing file attachments.');
    await page.getByRole('button', { name: 'Create Ticket' }).click();

    await expect(page).toHaveURL(/\/tickets\/\d+\/e2e-attachments-test-ticket/, { timeout: 30000 });
    ticketUrl = page.url();
  });

  test('file upload drop zone is not shown on post cards', async ({ page }) => {
    await loginAs(page, 'alice@example.com');
    await page.goto(await resolveTicketUrl());

    const dropZone = page.locator('[data-testid="file-drop-zone"]');
    await expect(dropZone).toHaveCount(0);
  });

  test('upload a text file to a post', async ({ page }) => {
    test.skip(true, 'Legacy FileUpload controls were removed from ticket detail post cards.');
    await loginAs(page, 'alice@example.com');
    await page.goto(await resolveTicketUrl());

    // Create a test file
    const filePath = createTempFile('test-upload.txt', 'Hello, this is a test file.', tmpDir);

    // Find file input and upload
    const fileInput = page.locator('[data-testid="file-input"]').first();
    await fileInput.setInputFiles(filePath);

    // Click upload button
    const uploadBtn = page.locator('[data-testid="upload-btn"]').first();
    await expect(uploadBtn).toBeVisible();
    await uploadBtn.click();

    // Verify attachment appears in the attachment list (not the file-select list)
    await expect(page.locator('[data-testid="attachment-list"]').getByText('test-upload.txt')).toBeVisible({ timeout: 15000 });
  });

  test('upload an image → inline thumbnail preview shown', async ({ page }) => {
    test.skip(true, 'Legacy FileUpload controls were removed from ticket detail post cards.');
    await loginAs(page, 'alice@example.com');
    await page.goto(await resolveTicketUrl());

    // Create a tiny PNG file (1x1 pixel)
    const pngHeader = Buffer.from([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, // PNG signature
      0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52, // IHDR chunk
      0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, // 1x1
      0x08, 0x02, 0x00, 0x00, 0x00, 0x90, 0x77, 0x53,
      0xde, 0x00, 0x00, 0x00, 0x0c, 0x49, 0x44, 0x41,
      0x54, 0x08, 0xd7, 0x63, 0xf8, 0xcf, 0xc0, 0x00,
      0x00, 0x00, 0x02, 0x00, 0x01, 0xe2, 0x21, 0xbc,
      0x33, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e,
      0x44, 0xae, 0x42, 0x60, 0x82,
    ]);
    const imgPath = path.join(tmpDir, 'test-image.png');
    fs.writeFileSync(imgPath, pngHeader);

    const fileInput = page.locator('[data-testid="file-input"]').first();
    await fileInput.setInputFiles(imgPath);

    const uploadBtn = page.locator('[data-testid="upload-btn"]').first();
    await expect(uploadBtn).toBeVisible();
    await uploadBtn.click();

    // Wait for the upload to complete and page to re-render
    // The attachment-thumbnail img appears in the server-rendered AttachmentList
    await expect(page.locator('[data-testid="attachment-thumbnail"]').first()).toBeVisible({ timeout: 15000 });
  });

  test('download link works', async ({ page }) => {
    test.skip(true, 'Legacy FileUpload controls were removed from ticket detail post cards.');
    await loginAs(page, 'alice@example.com');
    await page.goto(await resolveTicketUrl());

    // There should be a download link for the text file
    const downloadLink = page.locator('[data-testid="attachment-download"]').first();
    await expect(downloadLink).toBeVisible({ timeout: 10000 });
    const href = await downloadLink.getAttribute('href');
    expect(href).toBeTruthy();
  });

  test('agent can delete any user\'s attachment', async ({ page }) => {
    test.skip(true, 'Legacy FileUpload controls were removed from ticket detail post cards.');
    await loginAs(page, 'agent.smith@example.com');
    await page.goto(await resolveTicketUrl());

    // Count attachments before deletion
    const deleteBtns = page.locator('[data-testid="delete-attachment-btn"]');
    await expect(deleteBtns.first()).toBeVisible({ timeout: 10000 });
    const countBefore = await deleteBtns.count();

    // Click the first delete button
    await deleteBtns.first().click();

    // Wait for attachment count to decrease
    await expect(deleteBtns).toHaveCount(countBefore - 1, { timeout: 15000 });
  });

  test('admin file settings page exists', async ({ page }) => {
    await loginAs(page, 'admin@example.com');
    await gotoAdmin(page, '/admin/file-settings');

    await expect(page.getByRole('heading', { name: 'File Uploads' })).toBeVisible({ timeout: 10000 });
    await expect(page.getByLabel('Maximum file size (MB)')).toBeVisible();
    await expect(page.getByLabel('Maximum files per post')).toBeVisible();
  });

  test('admin can update file settings', async ({ page }) => {
    await loginAs(page, 'admin@example.com');
    await gotoAdmin(page, '/admin/file-settings');
    await expect(page.getByRole('heading', { name: 'File Uploads' })).toBeVisible({ timeout: 10000 });

    // Update max file size to 15
    const maxSizeInput = page.getByLabel('Maximum file size (MB)');
    await maxSizeInput.fill('15');

    // Save and wait for server action to complete
    const savePromise = page.waitForResponse(
      (resp) => resp.request().method() === 'POST' && resp.status() < 400,
      { timeout: 15000 },
    );
    await page.getByRole('button', { name: 'Save' }).click();
    await savePromise;

    // Verify it was saved by loading a fresh page
    await gotoAdmin(page, '/admin/file-settings');
    await expect(page.getByRole('heading', { name: 'File Uploads' })).toBeVisible({ timeout: 10000 });
    await expect(maxSizeInput).toHaveValue('15', { timeout: 10000 });

    // Reset to 10
    await maxSizeInput.fill('10');
    const resetPromise = page.waitForResponse(
      (resp) => resp.request().method() === 'POST' && resp.status() < 400,
      { timeout: 15000 },
    );
    await page.getByRole('button', { name: 'Save' }).click();
    await resetPromise;
  });

  test('admin can reset file types to defaults', async ({ page }) => {
    await loginAs(page, 'admin@example.com');
    await gotoAdmin(page, '/admin/file-settings');

    // Wait for the server action to complete before navigating
    const responsePromise = page.waitForResponse(
      (resp) => resp.request().method() === 'POST' && resp.status() < 400,
      { timeout: 15000 },
    );
    await page.getByRole('button', { name: 'Reset file types to defaults' }).click();
    await responsePromise;

    // Verify the allowed types textarea contains defaults
    await gotoAdmin(page, '/admin/file-settings');
    await expect(page.getByRole('heading', { name: 'File Uploads' })).toBeVisible({ timeout: 10000 });
    const textarea = page.getByLabel('Allowed file types');
    const value = await textarea.inputValue();
    expect(value).toContain('png');
    expect(value).toContain('pdf');
  });

  test('file sidebar link visible in admin nav', async ({ page }) => {
    await loginAs(page, 'admin@example.com');
    await gotoAdmin(page, '/admin');
    await page.waitForLoadState('networkidle');

    await expect(page.getByRole('link', { name: 'File Uploads' })).toBeVisible({ timeout: 15000 });
  });
});
