import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServiceRoleClient } from '../helpers/supabase';

// ---------------------------------------------------------------------------
// Shared helpers & constants
// ---------------------------------------------------------------------------

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'http://127.0.0.1:54321';
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

const ADMIN_ID = '00000000-0000-0000-0000-000000000301';
const AGENT_ID = '00000000-0000-0000-0000-000000000302';
const USER_ID = '00000000-0000-0000-0000-000000000303';
const USER2_ID = '00000000-0000-0000-0000-000000000304';

let svc: SupabaseClient;
let defaultTypeId: string;
let categoryId1: string;
let categoryId2: string;
let articleId1: number;
let articleId2: number;
let articleId3: number;

const clients: Record<string, SupabaseClient> = {};

async function ensureAuthUser(
  admin: SupabaseClient,
  id: string,
  email: string,
  meta?: Record<string, string>,
) {
  const { error } = await admin.auth.admin.createUser({
    id,
    email,
    password: 'Password123',
    email_confirm: true,
    user_metadata: meta,
  });
  if (error && !error.message.includes('already been registered')) {
    throw new Error(`ensureAuthUser(${email}): ${error.message}`);
  }
}

async function clientForUser(email: string, password = 'Password123') {
  if (clients[email]) {
    const { error } = await clients[email].from('profiles').select('id').limit(1);
    if (error?.message?.includes('JWT')) {
      delete clients[email];
    } else {
      return clients[email];
    }
  }
  const c = createClient(supabaseUrl, anonKey);
  const { error } = await c.auth.signInWithPassword({ email, password });
  if (error) throw new Error(`signIn(${email}): ${error.message}`);
  clients[email] = c;
  return c;
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

beforeAll(async () => {
  svc = createServiceRoleClient();

  const testUserIds = [ADMIN_ID, AGENT_ID, USER_ID, USER2_ID];

  // Clean up leftover data
  await svc.from('kb_article_feedback').delete().in('user_id', testUserIds);
  const { data: testArticles } = await svc.from('kb_articles').select('id').in('author_id', testUserIds);
  if (testArticles && testArticles.length > 0) {
    const articleIds = testArticles.map((a: { id: number }) => a.id);
    await svc.from('kb_article_feedback').delete().in('article_id', articleIds);
    await svc.from('kb_articles').delete().in('id', articleIds);
  }
  await svc.from('kb_categories').delete().neq('id', '00000000-0000-0000-0000-000000000000');
  await svc.from('admin_audit_log').delete().in('admin_id', testUserIds);

  // Delete leftover tickets
  const { data: testTickets } = await svc.from('tickets').select('id').in('creator_id', testUserIds);
  if (testTickets && testTickets.length > 0) {
    const ticketIds = testTickets.map((t: { id: number }) => t.id);
    await svc.from('notifications').delete().in('ticket_id', ticketIds);
    await svc.from('notification_coalescing_queue').delete().in('ticket_id', ticketIds);
    await svc.from('activity_log').delete().in('ticket_id', ticketIds);
    await svc.from('ticket_tags').delete().in('ticket_id', ticketIds);
    await svc.from('posts').delete().in('ticket_id', ticketIds);
    await svc.from('sla_timers').delete().in('ticket_id', ticketIds);
    await svc.from('tickets').update({ duplicate_of_id: null, merged_into_id: null }).in('id', ticketIds);
    await svc.from('tickets').delete().in('id', ticketIds);
  }

  await svc.from('notification_preferences').delete().in('user_id', testUserIds);
  await svc.from('profiles').delete().in('id', testUserIds);

  // Delete auth users
  for (const uid of testUserIds) {
    await svc.auth.admin.deleteUser(uid).catch(() => {});
  }

  // Create test users
  await ensureAuthUser(svc, ADMIN_ID, 'kb-admin@test.com', { display_name: 'KbAdmin' });
  await ensureAuthUser(svc, AGENT_ID, 'kb-agent@test.com', { display_name: 'KbAgent' });
  await ensureAuthUser(svc, USER_ID, 'kb-user@test.com', { display_name: 'KbUser' });
  await ensureAuthUser(svc, USER2_ID, 'kb-user2@test.com', { display_name: 'KbUser2' });

  // Set roles
  await svc.from('profiles').update({ role: 'admin' }).eq('id', ADMIN_ID);
  await svc.from('profiles').update({ role: 'agent' }).eq('id', AGENT_ID);

  // Ensure a ticket type exists for ticket tests
  const { data: existingType } = await svc.from('ticket_types').select('id').limit(1).single();
  defaultTypeId = existingType!.id;

  // Enable KB visibility so regular users can read published/archived articles
  await svc.from('app_settings').update({ value: 'true' }).eq('key', 'kb_visible');
}, 30_000);

afterAll(async () => {
  const testUserIds = [ADMIN_ID, AGENT_ID, USER_ID, USER2_ID];

  await svc.from('kb_article_feedback').delete().in('user_id', testUserIds);
  const { data: testArticles } = await svc.from('kb_articles').select('id').in('author_id', testUserIds);
  if (testArticles && testArticles.length > 0) {
    const articleIds = testArticles.map((a: { id: number }) => a.id);
    await svc.from('kb_article_feedback').delete().in('article_id', articleIds);
    await svc.from('kb_articles').delete().in('id', articleIds);
  }
  await svc.from('kb_categories').delete().neq('id', '00000000-0000-0000-0000-000000000000');

  // Restore seed categories so E2E tests can find them
  await svc.from('kb_categories').upsert([
    { id: '00000000-0000-0000-0000-000000000501', name: 'Getting Started', display_order: 1 },
    { id: '00000000-0000-0000-0000-000000000502', name: 'Troubleshooting', display_order: 2 },
  ], { onConflict: 'id' });

  // Restore seed article category references (ON DELETE SET NULL nullified them)
  await svc.from('kb_articles').update({ category_id: '00000000-0000-0000-0000-000000000501' }).in('id', [1, 2]);
  await svc.from('kb_articles').update({ category_id: '00000000-0000-0000-0000-000000000502' }).eq('id', 3);

  const { data: testTickets } = await svc.from('tickets').select('id').in('creator_id', testUserIds);
  if (testTickets && testTickets.length > 0) {
    const ticketIds = testTickets.map((t: { id: number }) => t.id);
    await svc.from('notifications').delete().in('ticket_id', ticketIds);
    await svc.from('notification_coalescing_queue').delete().in('ticket_id', ticketIds);
    await svc.from('activity_log').delete().in('ticket_id', ticketIds);
    await svc.from('ticket_tags').delete().in('ticket_id', ticketIds);
    await svc.from('posts').delete().in('ticket_id', ticketIds);
    await svc.from('sla_timers').delete().in('ticket_id', ticketIds);
    await svc.from('tickets').update({ duplicate_of_id: null, merged_into_id: null }).in('id', ticketIds);
    await svc.from('tickets').delete().in('id', ticketIds);
  }

  await svc.from('admin_audit_log').delete().in('admin_id', testUserIds);
  await svc.from('notification_preferences').delete().in('user_id', testUserIds);
  await svc.from('profiles').delete().in('id', testUserIds);
  for (const uid of testUserIds) {
    await svc.auth.admin.deleteUser(uid).catch(() => {});
  }
}, 30_000);

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Knowledge Base', () => {
  // ===== KB Categories =====
  describe('KB Categories', () => {
    it('admin can create KB categories', async () => {
      const admin = await clientForUser('kb-admin@test.com');

      const { data: cat1, error: err1 } = await admin
        .from('kb_categories')
        .insert({ name: 'Getting Started', display_order: 1 })
        .select('id')
        .single();
      expect(err1).toBeNull();
      categoryId1 = cat1!.id;

      const { data: cat2, error: err2 } = await admin
        .from('kb_categories')
        .insert({ name: 'Advanced Topics', display_order: 2 })
        .select('id')
        .single();
      expect(err2).toBeNull();
      categoryId2 = cat2!.id;
    });

    it('agent cannot create KB categories', async () => {
      const agent = await clientForUser('kb-agent@test.com');
      const { error } = await agent
        .from('kb_categories')
        .insert({ name: 'Forbidden Category', display_order: 3 });
      expect(error).not.toBeNull();
    });

    it('regular user cannot create KB categories', async () => {
      const user = await clientForUser('kb-user@test.com');
      const { error } = await user
        .from('kb_categories')
        .insert({ name: 'User Category', display_order: 4 });
      expect(error).not.toBeNull();
    });

    it('all users can read KB categories', async () => {
      const user = await clientForUser('kb-user@test.com');
      const { data, error } = await user
        .from('kb_categories')
        .select('id, name')
        .order('display_order');
      expect(error).toBeNull();
      expect(data!.length).toBeGreaterThanOrEqual(2);
    });

    it('admin can rename KB category', async () => {
      const admin = await clientForUser('kb-admin@test.com');
      const { error } = await admin
        .from('kb_categories')
        .update({ name: 'Getting Started Guides' })
        .eq('id', categoryId1);
      expect(error).toBeNull();
    });

    it('admin can delete KB category', async () => {
      // We'll create a throwaway category to delete
      const admin = await clientForUser('kb-admin@test.com');
      const { data: temp } = await admin
        .from('kb_categories')
        .insert({ name: 'Temp Category', display_order: 99 })
        .select('id')
        .single();

      const { error } = await admin
        .from('kb_categories')
        .delete()
        .eq('id', temp!.id);
      expect(error).toBeNull();
    });
  });

  // ===== KB Articles =====
  describe('KB Articles CRUD', () => {
    it('agent can create KB article', async () => {
      const agent = await clientForUser('kb-agent@test.com');

      const { data: art, error } = await agent
        .from('kb_articles')
        .insert({
          title: 'How to use the helpdesk',
          slug: 'how-to-use-the-helpdesk',
          body: 'This is a guide on using the helpdesk system.',
          status: 'published',
          category_id: categoryId1,
          author_id: AGENT_ID,
        })
        .select('id')
        .single();
      expect(error).toBeNull();
      articleId1 = art!.id;
    });

    it('agent can create draft article', async () => {
      const agent = await clientForUser('kb-agent@test.com');

      const { data: art, error } = await agent
        .from('kb_articles')
        .insert({
          title: 'Draft: Troubleshooting guide',
          slug: 'draft-troubleshooting-guide',
          body: 'This article is still being written.',
          status: 'draft',
          category_id: categoryId2,
          author_id: AGENT_ID,
        })
        .select('id')
        .single();
      expect(error).toBeNull();
      articleId2 = art!.id;
    });

    it('agent can create archived article', async () => {
      const agent = await clientForUser('kb-agent@test.com');

      const { data: art, error } = await agent
        .from('kb_articles')
        .insert({
          title: 'Old deprecated feature',
          slug: 'old-deprecated-feature',
          body: 'This feature is no longer available.',
          status: 'archived',
          category_id: categoryId1,
          author_id: AGENT_ID,
        })
        .select('id')
        .single();
      expect(error).toBeNull();
      articleId3 = art!.id;
    });

    it('regular user cannot create articles', async () => {
      const user = await clientForUser('kb-user@test.com');
      const { error } = await user
        .from('kb_articles')
        .insert({
          title: 'User article',
          slug: 'user-article',
          body: 'Should fail.',
          author_id: USER_ID,
        });
      expect(error).not.toBeNull();
    });

    it('agent can update article', async () => {
      const agent = await clientForUser('kb-agent@test.com');
      const { error } = await agent
        .from('kb_articles')
        .update({
          title: 'How to use the helpdesk (updated)',
          last_editor_id: AGENT_ID,
          edited_at: new Date().toISOString(),
        })
        .eq('id', articleId1);
      expect(error).toBeNull();
    });

    it('regular user cannot update articles', async () => {
      const user = await clientForUser('kb-user@test.com');
      const { data, error } = await user
        .from('kb_articles')
        .update({ title: 'Hacked title' })
        .eq('id', articleId1)
        .select('id');
      // RLS silently ignores update on rows the user cannot access (0 rows affected)
      expect(error).toBeNull();
      expect(data!.length).toBe(0);

      // Verify the title was not changed
      const agent = await clientForUser('kb-agent@test.com');
      const { data: article } = await agent
        .from('kb_articles')
        .select('title')
        .eq('id', articleId1)
        .single();
      expect(article!.title).not.toBe('Hacked title');
    });
  });

  // ===== Article Visibility =====
  describe('Article Visibility (RLS)', () => {
    it('published articles visible to regular users', async () => {
      const user = await clientForUser('kb-user@test.com');
      const { data, error } = await user
        .from('kb_articles')
        .select('id')
        .eq('id', articleId1);
      expect(error).toBeNull();
      expect(data!.length).toBe(1);
    });

    it('archived articles visible to regular users', async () => {
      const user = await clientForUser('kb-user@test.com');
      const { data, error } = await user
        .from('kb_articles')
        .select('id')
        .eq('id', articleId3);
      expect(error).toBeNull();
      expect(data!.length).toBe(1);
    });

    it('draft articles NOT visible to regular users', async () => {
      const user = await clientForUser('kb-user@test.com');
      const { data, error } = await user
        .from('kb_articles')
        .select('id')
        .eq('id', articleId2);
      expect(error).toBeNull();
      expect(data!.length).toBe(0);
    });

    it('draft articles visible to agents', async () => {
      const agent = await clientForUser('kb-agent@test.com');
      const { data, error } = await agent
        .from('kb_articles')
        .select('id')
        .eq('id', articleId2);
      expect(error).toBeNull();
      expect(data!.length).toBe(1);
    });
  });

  // ===== Full-text Search =====
  describe('Article search_vector', () => {
    it('search_vector indexes title and body', async () => {
      const agent = await clientForUser('kb-agent@test.com');
      const { data, error } = await agent
        .from('kb_articles')
        .select('id, search_vector')
        .eq('id', articleId1)
        .single();
      expect(error).toBeNull();
      expect(data!.search_vector).toBeTruthy();
    });

    it('can search published articles by text', async () => {
      const user = await clientForUser('kb-user@test.com');
      const { data, error } = await user
        .from('kb_articles')
        .select('id, title')
        .eq('status', 'published')
        .textSearch('search_vector', 'helpdesk', { type: 'plain' });
      expect(error).toBeNull();
      expect(data!.length).toBeGreaterThanOrEqual(1);
    });
  });

  // ===== Feedback =====
  describe('Article Feedback', () => {
    it('authenticated user can vote helpful', async () => {
      const user = await clientForUser('kb-user@test.com');
      const { error } = await user
        .from('kb_article_feedback')
        .insert({ article_id: articleId1, user_id: USER_ID, is_helpful: true });
      expect(error).toBeNull();
    });

    it('feedback count incremented', async () => {
      const user = await clientForUser('kb-user@test.com');
      const { data } = await user
        .from('kb_articles')
        .select('helpful_count, not_helpful_count')
        .eq('id', articleId1)
        .single();
      expect(data!.helpful_count).toBe(1);
      expect(data!.not_helpful_count).toBe(0);
    });

    it('user can change vote (toggle)', async () => {
      const user = await clientForUser('kb-user@test.com');
      const { error } = await user
        .from('kb_article_feedback')
        .update({ is_helpful: false })
        .eq('article_id', articleId1)
        .eq('user_id', USER_ID);
      expect(error).toBeNull();

      const { data } = await user
        .from('kb_articles')
        .select('helpful_count, not_helpful_count')
        .eq('id', articleId1)
        .single();
      expect(data!.helpful_count).toBe(0);
      expect(data!.not_helpful_count).toBe(1);
    });

    it('user can only vote once per article (composite PK)', async () => {
      const user = await clientForUser('kb-user@test.com');
      const { error } = await user
        .from('kb_article_feedback')
        .insert({ article_id: articleId1, user_id: USER_ID, is_helpful: true });
      expect(error).not.toBeNull(); // Duplicate key violation
    });

    it('second user can also vote', async () => {
      const user2 = await clientForUser('kb-user2@test.com');
      const { error } = await user2
        .from('kb_article_feedback')
        .insert({ article_id: articleId1, user_id: USER2_ID, is_helpful: true });
      expect(error).toBeNull();

      const agent = await clientForUser('kb-agent@test.com');
      const { data } = await agent
        .from('kb_articles')
        .select('helpful_count, not_helpful_count')
        .eq('id', articleId1)
        .single();
      expect(data!.helpful_count).toBe(1);
      expect(data!.not_helpful_count).toBe(1);
    });

    it('user can see their own feedback', async () => {
      const user = await clientForUser('kb-user@test.com');
      const { data, error } = await user
        .from('kb_article_feedback')
        .select('is_helpful')
        .eq('article_id', articleId1)
        .eq('user_id', USER_ID);
      expect(error).toBeNull();
      expect(data!.length).toBe(1);
    });

    it('user cannot see other users feedback', async () => {
      const user = await clientForUser('kb-user@test.com');
      const { data, error } = await user
        .from('kb_article_feedback')
        .select('is_helpful')
        .eq('article_id', articleId1)
        .eq('user_id', USER2_ID);
      expect(error).toBeNull();
      expect(data!.length).toBe(0);
    });

    it('agent can see all feedback', async () => {
      const agent = await clientForUser('kb-agent@test.com');
      const { data, error } = await agent
        .from('kb_article_feedback')
        .select('user_id, is_helpful')
        .eq('article_id', articleId1);
      expect(error).toBeNull();
      expect(data!.length).toBe(2);
    });
  });

  // ===== Cascade delete =====
  describe('Cascade deletes', () => {
    it('deleting article cascades to feedback', async () => {
      // Create a temporary article and feedback, then delete
      const agent = await clientForUser('kb-agent@test.com');
      const { data: tempArt } = await agent
        .from('kb_articles')
        .insert({
          title: 'Temp for delete test',
          slug: 'temp-for-delete-test',
          body: 'Will be deleted.',
          status: 'published',
          author_id: AGENT_ID,
        })
        .select('id')
        .single();

      const user = await clientForUser('kb-user@test.com');
      await user
        .from('kb_article_feedback')
        .insert({ article_id: tempArt!.id, user_id: USER_ID, is_helpful: true });

      // Delete article
      await agent
        .from('kb_articles')
        .delete()
        .eq('id', tempArt!.id);

      // Feedback should be gone
      const { data: fb } = await svc
        .from('kb_article_feedback')
        .select('article_id')
        .eq('article_id', tempArt!.id);
      expect(fb!.length).toBe(0);
    });
  });

  // ===== Source article on ticket =====
  describe('Source article on ticket', () => {
    it('can store source_article_id on ticket', async () => {
      const user = await clientForUser('kb-user@test.com');
      const { data: ticket, error } = await user
        .from('tickets')
        .insert({
          title: 'Question about helpdesk',
          slug: 'question-about-helpdesk',
          urgency: 'medium',
          severity: 'medium',
          type_id: defaultTypeId,
          creator_id: USER_ID,
          source_article_id: articleId1,
        })
        .select('id, source_article_id')
        .single();
      expect(error).toBeNull();
      expect(ticket!.source_article_id).toBe(articleId1);

      // Cleanup: insert original post to satisfy any trigger requirements
      await user.from('posts').insert({
        ticket_id: ticket!.id,
        author_id: USER_ID,
        body: 'Question from article.',
        is_original: true,
        post_type: 'post',
      });
    });
  });

  // ===== KB Visibility setting =====
  describe('KB Visibility setting', () => {
    it('kb_visible setting exists', async () => {
      const { data, error } = await svc
        .from('app_settings')
        .select('key, value')
        .eq('key', 'kb_visible')
        .single();
      expect(error).toBeNull();
      expect(data).not.toBeNull();
    });
  });

  // ===== Agent can delete article =====
  describe('Article deletion', () => {
    it('agent can delete article', async () => {
      const agent = await clientForUser('kb-agent@test.com');
      // Create a temp article
      const { data: temp } = await agent
        .from('kb_articles')
        .insert({
          title: 'To be deleted',
          slug: 'to-be-deleted',
          body: 'Delete me.',
          status: 'draft',
          author_id: AGENT_ID,
        })
        .select('id')
        .single();

      const { error } = await agent
        .from('kb_articles')
        .delete()
        .eq('id', temp!.id);
      expect(error).toBeNull();
    });

    it('regular user cannot delete article', async () => {
      const user = await clientForUser('kb-user@test.com');
      const { data, error } = await user
        .from('kb_articles')
        .delete()
        .eq('id', articleId1)
        .select('id');
      // RLS silently ignores delete on rows the user cannot access (0 rows affected)
      expect(error).toBeNull();
      expect(data!.length).toBe(0);

      // Verify the article still exists
      const agent = await clientForUser('kb-agent@test.com');
      const { data: article } = await agent
        .from('kb_articles')
        .select('id')
        .eq('id', articleId1)
        .single();
      expect(article).not.toBeNull();
    });
  });

  // ===== Feedback count on delete =====
  describe('Feedback count on delete', () => {
    it('deleting feedback decrements count', async () => {
      const user2 = await clientForUser('kb-user2@test.com');
      // user2 already voted helpful on articleId1
      const { error } = await user2
        .from('kb_article_feedback')
        .delete()
        .eq('article_id', articleId1)
        .eq('user_id', USER2_ID);
      expect(error).toBeNull();

      const agent = await clientForUser('kb-agent@test.com');
      const { data } = await agent
        .from('kb_articles')
        .select('helpful_count, not_helpful_count')
        .eq('id', articleId1)
        .single();
      expect(data!.helpful_count).toBe(0);
      expect(data!.not_helpful_count).toBe(1); // user still has not_helpful vote
    });
  });
});
