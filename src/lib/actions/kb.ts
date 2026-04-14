'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { createServerClient } from '@/lib/supabase/server';
import { generateSlug } from '@/lib/utils/slug';

export type KbActionState = {
  error?: string;
  fieldErrors?: Record<string, string>;
};

const VALID_STATUSES = ['draft', 'published', 'archived'];

// ============================================================
// Article CRUD
// ============================================================

export async function createArticle(
  _prev: KbActionState,
  formData: FormData,
): Promise<KbActionState> {
  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const { data: profile } = await supabase
    .from('profiles')
    .select('id, role')
    .eq('id', user.id)
    .single();

  if (!profile || !['agent', 'admin'].includes(profile.role)) {
    return { error: 'Forbidden' };
  }

  const title = (formData.get('title') as string)?.trim() ?? '';
  const body = (formData.get('body') as string) ?? '';
  const categoryId = (formData.get('category_id') as string) || null;

  const fieldErrors: Record<string, string> = {};
  if (!title) fieldErrors.title = 'Title is required.';
  if (title.length > 300) fieldErrors.title = 'Title must be 300 characters or fewer.';
  if (!body || !body.trim()) fieldErrors.body = 'Body is required.';
  if (body.length > 100000) fieldErrors.body = 'Body must be 100,000 characters or fewer.';
  if (Object.keys(fieldErrors).length > 0) return { fieldErrors };

  const slug = generateSlug(title);

  const { data: created, error } = await supabase
    .from('kb_articles')
    .insert({
      title,
      slug,
      body,
      status: 'draft',
      category_id: categoryId,
      author_id: user.id,
    })
    .select('id')
    .single();

  if (error) return { error: 'Failed to create article.' };

  redirect(`/kb/manage/${created.id}`);
}

export async function updateArticle(
  _prev: KbActionState,
  formData: FormData,
): Promise<KbActionState> {
  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const { data: profile } = await supabase
    .from('profiles')
    .select('id, role')
    .eq('id', user.id)
    .single();

  if (!profile || !['agent', 'admin'].includes(profile.role)) {
    return { error: 'Forbidden' };
  }

  const articleId = formData.get('article_id') as string;
  if (!articleId) return { error: 'Article ID is required.' };

  const title = (formData.get('title') as string)?.trim() ?? '';
  const body = (formData.get('body') as string) ?? '';
  const categoryId = (formData.get('category_id') as string) || null;

  const fieldErrors: Record<string, string> = {};
  if (!title) fieldErrors.title = 'Title is required.';
  if (title.length > 300) fieldErrors.title = 'Title must be 300 characters or fewer.';
  if (!body || !body.trim()) fieldErrors.body = 'Body is required.';
  if (body.length > 100000) fieldErrors.body = 'Body must be 100,000 characters or fewer.';
  if (Object.keys(fieldErrors).length > 0) return { fieldErrors };

  const slug = generateSlug(title);

  const { error } = await supabase
    .from('kb_articles')
    .update({
      title,
      slug,
      body,
      category_id: categoryId,
      last_editor_id: user.id,
      edited_at: new Date().toISOString(),
    })
    .eq('id', articleId);

  if (error) return { error: 'Failed to update article.' };

  revalidatePath(`/kb/manage/${articleId}`);
  revalidatePath('/kb/manage');
  revalidatePath('/help');
  return {};
}

export async function changeArticleStatus(formData: FormData): Promise<void> {
  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const { data: profile } = await supabase
    .from('profiles')
    .select('id, role')
    .eq('id', user.id)
    .single();

  if (!profile || !['agent', 'admin'].includes(profile.role)) return;

  const articleId = formData.get('article_id') as string;
  const newStatus = formData.get('status') as string;
  if (!articleId || !VALID_STATUSES.includes(newStatus)) return;

  await supabase
    .from('kb_articles')
    .update({ status: newStatus })
    .eq('id', articleId);

  revalidatePath(`/kb/manage/${articleId}`);
  revalidatePath('/kb/manage');
  revalidatePath('/help');
}

export async function deleteArticle(formData: FormData): Promise<void> {
  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const { data: profile } = await supabase
    .from('profiles')
    .select('id, role')
    .eq('id', user.id)
    .single();

  if (!profile || !['agent', 'admin'].includes(profile.role)) return;

  const articleId = formData.get('article_id') as string;
  if (!articleId) return;

  await supabase
    .from('kb_articles')
    .delete()
    .eq('id', articleId);

  redirect('/kb/manage');
}

// ============================================================
// Feedback
// ============================================================

export async function submitArticleFeedback(formData: FormData): Promise<void> {
  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return;

  const articleId = formData.get('article_id') as string;
  const isHelpful = formData.get('is_helpful') === 'true';
  if (!articleId) return;

  // Upsert feedback — ON CONFLICT updates the vote
  await supabase
    .from('kb_article_feedback')
    .upsert(
      { article_id: parseInt(articleId, 10), user_id: user.id, is_helpful: isHelpful },
      { onConflict: 'article_id,user_id' },
    );

  revalidatePath(`/help/${articleId}`);
}

// ============================================================
// Search
// ============================================================

export async function searchArticles(query: string, page = 1) {
  const supabase = await createServerClient();

  // Read page size from app_settings
  const { data: pageSetting } = await supabase
    .from('app_settings')
    .select('value')
    .eq('key', 'other_lists_page_size')
    .single();

  const pageSize = pageSetting ? parseInt(pageSetting.value, 10) || 10 : 10;
  const from = (page - 1) * pageSize;
  const to = from + pageSize - 1;

  const searchTerms = query.trim().split(/\s+/).join(' & ');

  const { data, count } = await supabase
    .from('kb_articles')
    .select('id, title, slug, body, category:kb_categories(id, name)', { count: 'exact' })
    .eq('status', 'published')
    .textSearch('search_vector', searchTerms, { type: 'plain' })
    .range(from, to);

  return {
    articles: (data ?? []).map((a) => ({
      id: a.id,
      title: a.title,
      slug: a.slug,
      category: Array.isArray(a.category) ? a.category[0] : a.category,
      snippet: a.body.substring(0, 200) + (a.body.length > 200 ? '…' : ''),
    })),
    total: count ?? 0,
    pageSize,
  };
}

export async function getSuggestedArticles(title: string) {
  if (!title || title.trim().length < 3) return [];

  const supabase = await createServerClient();

  const searchTerms = title.trim().split(/\s+/).join(' & ');

  const { data } = await supabase
    .from('kb_articles')
    .select('id, title, slug, category:kb_categories(id, name)')
    .eq('status', 'published')
    .textSearch('search_vector', searchTerms, { type: 'plain' })
    .limit(5);

  return (data ?? []).map((a) => ({
    id: a.id,
    title: a.title,
    slug: a.slug,
    category: Array.isArray(a.category) ? a.category[0] : a.category,
  }));
}

// ============================================================
// KB Visibility Toggle
// ============================================================

export async function toggleKbVisibility(formData: FormData): Promise<void> {
  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const { data: profile } = await supabase
    .from('profiles')
    .select('id, role')
    .eq('id', user.id)
    .single();

  if (!profile || profile.role !== 'admin') return;

  const visible = formData.get('visible') === 'true';

  await supabase
    .from('app_settings')
    .update({ value: String(visible) })
    .eq('key', 'kb_visible');

  // Log to audit
  await supabase.from('admin_audit_log').insert({
    admin_id: profile.id,
    action: 'toggle_kb_visibility',
    target_type: 'app_settings',
    target_id: null,
    details: { visible },
  });

  revalidatePath('/kb/manage');
  revalidatePath('/help');
  revalidatePath('/');
}
