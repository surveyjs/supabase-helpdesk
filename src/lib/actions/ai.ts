'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { createServerClient, createServiceRoleClient } from '@/lib/supabase/server';
import { callAi, callAiText, logAiUsage, getAiConfig } from '@/lib/ai/client';
import { generateSlug } from '@/lib/utils/slug';

// ============================================================
// Helpers
// ============================================================

async function requireAgentRole() {
  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');
  const { data: profile } = await supabase
    .from('profiles')
    .select('id, role')
    .eq('id', user.id)
    .single();
  if (!profile || !['agent', 'admin'].includes(profile.role)) {
    throw new Error('Forbidden');
  }
  return { supabase, user, profile };
}

async function getSettingsMap(supabase: Awaited<ReturnType<typeof createServerClient>>, keys: string[]) {
  const { data } = await supabase
    .from('app_settings')
    .select('key, value')
    .in('key', keys);
  return new Map(data?.map((s) => [s.key, s.value]) ?? []);
}

// ============================================================
// 1. Auto-Categorization (§23.1)
// ============================================================

export type AutoCategorizeResult = {
  suggestedTypeId?: string;
  suggestedUrgency?: string;
  suggestedTagIds?: string[];
  suggestedCategoryId?: string | null;
  error?: string;
};

export async function autoCategorizeTicket(formData: FormData): Promise<AutoCategorizeResult> {
  try {
    const title = (formData.get('title') as string)?.trim() ?? '';
    const body = (formData.get('body') as string)?.trim() ?? '';

    const supabase = await createServerClient();
    const settings = await getSettingsMap(supabase, [
      'ai_auto_categorize_enabled',
      'ai_auto_categorize_min_body_length',
    ]);

    if (settings.get('ai_auto_categorize_enabled') !== 'true') return {};

    const minLength = parseInt(settings.get('ai_auto_categorize_min_body_length') ?? '20', 10) || 20;
    if (body.length < minLength) return {};

    // Fetch taxonomy
    const [typesRes, catsRes, tagsRes] = await Promise.all([
      supabase.from('ticket_types').select('id, name'),
      supabase.from('categories').select('id, name'),
      supabase.from('tags').select('id, name'),
    ]);

    const types = typesRes.data ?? [];
    const categories = catsRes.data ?? [];
    const tags = tagsRes.data ?? [];

    if (types.length === 0) return {};

    const systemPrompt = `You are a helpdesk ticket classifier. Given a ticket title and body, suggest the best matching type, urgency, tags, and category from the provided options. Return JSON with these fields:
- suggestedTypeId: string (one of the type IDs)
- suggestedUrgency: string (one of: "low", "medium", "high", "critical")
- suggestedTagIds: string[] (array of tag IDs, up to 3)
- suggestedCategoryId: string or null (one of the category IDs, or null if none fit)
Only include fields where you are confident in the match.`;

    const userPrompt = `Ticket title: ${title}
Ticket body: ${body}

Available types: ${JSON.stringify(types.map((t) => ({ id: t.id, name: t.name })))}
Available categories: ${JSON.stringify(categories.map((c) => ({ id: c.id, name: c.name })))}
Available tags: ${JSON.stringify(tags.map((t) => ({ id: t.id, name: t.name })))}`;

    const result = await callAi(systemPrompt, userPrompt);
    await logAiUsage(null, 'auto_categorize', result.tokensUsed);

    const parsed = JSON.parse(result.content);

    // Validate against actual IDs
    const typeIds = new Set(types.map((t) => t.id));
    const catIds = new Set(categories.map((c) => c.id));
    const tagIds = new Set(tags.map((t) => t.id));

    const response: AutoCategorizeResult = {};

    if (parsed.suggestedTypeId && typeIds.has(parsed.suggestedTypeId)) {
      response.suggestedTypeId = parsed.suggestedTypeId;
    }
    if (parsed.suggestedUrgency && ['low', 'medium', 'high', 'critical'].includes(parsed.suggestedUrgency)) {
      response.suggestedUrgency = parsed.suggestedUrgency;
    }
    if (Array.isArray(parsed.suggestedTagIds)) {
      response.suggestedTagIds = parsed.suggestedTagIds.filter((id: string) => tagIds.has(id)).slice(0, 3);
    }
    if (parsed.suggestedCategoryId && catIds.has(parsed.suggestedCategoryId)) {
      response.suggestedCategoryId = parsed.suggestedCategoryId;
    }

    return response;
  } catch {
    return {};
  }
}

// ============================================================
// 2. Duplicate Detection (§23.2)
// ============================================================

export type DuplicateTicket = {
  id: number;
  title: string;
  status: string;
  created_at: string;
};

export async function detectDuplicateTickets(formData: FormData): Promise<DuplicateTicket[]> {
  try {
    const title = (formData.get('title') as string)?.trim() ?? '';
    if (title.length < 5) return [];

    const supabase = await createServerClient();
    const settings = await getSettingsMap(supabase, [
      'ai_duplicate_detection_enabled',
      'ai_duplicate_detection_threshold',
    ]);

    if (settings.get('ai_duplicate_detection_enabled') !== 'true') return [];

    const threshold = settings.get('ai_duplicate_detection_threshold') ?? 'medium';

    // Fetch recent open/pending tickets
    const { data: recentTickets } = await supabase
      .from('tickets')
      .select('id, title, status, created_at')
      .in('status', ['open', 'pending'])
      .order('updated_at', { ascending: false })
      .limit(100);

    if (!recentTickets || recentTickets.length === 0) return [];

    const systemPrompt = `Given a new ticket title and a list of existing ticket titles, identify up to 3 that are semantically similar. Consider the similarity threshold: ${threshold} (low = very similar only, medium = reasonably similar, high = broadly similar). Return a JSON object with a field "similarIds" that is an array of ticket IDs ranked by similarity. If no similar tickets found, return {"similarIds": []}.`;

    const userPrompt = `New ticket title: ${title}

Existing open tickets:
${recentTickets.map((t) => `- ID ${t.id}: "${t.title}"`).join('\n')}`;

    const result = await callAi(systemPrompt, userPrompt);
    await logAiUsage(null, 'duplicate_detection', result.tokensUsed);

    const parsed = JSON.parse(result.content);
    const similarIds: number[] = (parsed.similarIds ?? []).slice(0, 3);

    if (similarIds.length === 0) return [];

    // Fetch full details for matched tickets
    const matched = recentTickets.filter((t) => similarIds.includes(t.id));
    // Sort in similarity order
    return similarIds
      .map((id) => matched.find((t) => t.id === id))
      .filter(Boolean) as DuplicateTicket[];
  } catch {
    return [];
  }
}

// ============================================================
// 3. Suggested Reply (§23.3)
// ============================================================

export type SuggestReplyResult = {
  reply?: string;
  error?: string;
  rateLimitResetAt?: string;
};

export async function suggestReply(formData: FormData): Promise<SuggestReplyResult> {
  try {
    const { supabase, user } = await requireAgentRole();
    const ticketId = Number(formData.get('ticket_id'));
    if (!ticketId) return { error: 'Invalid ticket ID' };

    const settings = await getSettingsMap(supabase, [
      'ai_suggested_reply_enabled',
      'ai_suggested_reply_context_window',
      'ai_suggested_reply_rate_limit',
    ]);

    if (settings.get('ai_suggested_reply_enabled') !== 'true') {
      return { error: 'AI suggested reply is not enabled' };
    }

    // Rate limit check
    const rateLimit = parseInt(settings.get('ai_suggested_reply_rate_limit') ?? '20', 10);
    if (rateLimit > 0) {
      const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
      const { count } = await supabase
        .from('ai_rate_limit_log')
        .select('id', { count: 'exact', head: true })
        .eq('agent_id', user.id)
        .eq('feature', 'suggested_reply')
        .gte('created_at', oneHourAgo);

      if ((count ?? 0) >= rateLimit) {
        // Find when the oldest entry in window expires
        const { data: oldestEntry } = await supabase
          .from('ai_rate_limit_log')
          .select('created_at')
          .eq('agent_id', user.id)
          .eq('feature', 'suggested_reply')
          .gte('created_at', oneHourAgo)
          .order('created_at', { ascending: true })
          .limit(1);

        const resetAt = oldestEntry?.[0]
          ? new Date(new Date(oldestEntry[0].created_at).getTime() + 60 * 60 * 1000).toISOString()
          : new Date(Date.now() + 60 * 60 * 1000).toISOString();

        return {
          error: `Rate limit reached. Available again at ${new Date(resetAt).toLocaleTimeString()}.`,
          rateLimitResetAt: resetAt,
        };
      }
    }

    // Fetch ticket context
    const contextWindow = parseInt(settings.get('ai_suggested_reply_context_window') ?? '20', 10) || 20;

    const { data: ticket } = await supabase
      .from('tickets')
      .select(`
        id, title, urgency, severity, status,
        type:ticket_types(name),
        category:categories(name)
      `)
      .eq('id', ticketId)
      .single();

    if (!ticket) return { error: 'Ticket not found' };

    const ticketType = Array.isArray(ticket.type) ? ticket.type[0] : ticket.type;
    const ticketCategory = Array.isArray(ticket.category) ? ticket.category[0] : ticket.category;

    // Fetch tags
    const { data: tagRows } = await supabase
      .from('ticket_tags')
      .select('tags(name)')
      .eq('ticket_id', ticketId);
    const tagNames = (tagRows ?? []).map((r) => {
      const tag = Array.isArray(r.tags) ? r.tags[0] : r.tags;
      return (tag as { name: string } | null)?.name;
    }).filter(Boolean);

    // Fetch recent posts
    const { data: posts } = await supabase
      .from('posts')
      .select('body, post_type, created_at, author:profiles!posts_author_id_fkey(display_name, role)')
      .eq('ticket_id', ticketId)
      .order('created_at', { ascending: true })
      .limit(contextWindow);

    const systemPrompt = `You are a helpful support agent. Based on the ticket context and conversation history, draft a professional reply. Be helpful, empathetic, and solution-oriented. Do not invent information — if you need more details, ask the customer. Return only the reply text, no JSON wrapping.`;

    const postContext = (posts ?? []).map((p) => {
      const author = Array.isArray(p.author) ? p.author[0] : p.author;
      const role = (author as { display_name: string | null; role: string } | null)?.role ?? 'user';
      const name = (author as { display_name: string | null } | null)?.display_name ?? 'Unknown';
      return `[${role}] ${name} (${p.post_type}): ${p.body}`;
    }).join('\n\n');

    const userPrompt = `Ticket: #${ticket.id} - ${ticket.title}
Type: ${ticketType?.name ?? 'Unknown'}
Category: ${ticketCategory?.name ?? 'None'}
Urgency: ${ticket.urgency}
Severity: ${ticket.severity}
Status: ${ticket.status}
Tags: ${tagNames.join(', ') || 'None'}

Conversation history:
${postContext}`;

    const result = await callAiText(systemPrompt, userPrompt);

    // Record rate limit entry
    const serviceClient = createServiceRoleClient();
    await serviceClient.from('ai_rate_limit_log').insert({
      agent_id: user.id,
      feature: 'suggested_reply',
    });

    await logAiUsage(user.id, 'suggested_reply', result.tokensUsed);

    return { reply: result.content };
  } catch (_err) {
    return { error: 'Could not generate suggestion. Please try again or write a manual reply.' };
  }
}

// ============================================================
// 4. Ticket Summary (§23.4)
// ============================================================

export type TicketSummaryResult = {
  summary?: string;
  error?: string;
};

export async function getTicketSummary(formData: FormData): Promise<TicketSummaryResult> {
  try {
    const { supabase, user } = await requireAgentRole();
    const ticketId = Number(formData.get('ticket_id'));
    if (!ticketId) return { error: 'Invalid ticket ID' };

    const settings = await getSettingsMap(supabase, [
      'ai_ticket_summary_enabled',
      'ai_ticket_summary_min_posts',
    ]);

    if (settings.get('ai_ticket_summary_enabled') !== 'true') return {};

    // Count posts
    const { count: postCount } = await supabase
      .from('posts')
      .select('id', { count: 'exact', head: true })
      .eq('ticket_id', ticketId);

    const minPosts = parseInt(settings.get('ai_ticket_summary_min_posts') ?? '10', 10) || 10;
    if ((postCount ?? 0) < minPosts) return {};

    // Check cache
    const serviceClient = createServiceRoleClient();
    const { data: cached } = await serviceClient
      .from('ticket_summaries')
      .select('summary, post_count_at_generation')
      .eq('ticket_id', ticketId)
      .single();

    if (cached && cached.post_count_at_generation === postCount) {
      return { summary: cached.summary };
    }

    // Generate summary
    return generateSummary(supabase, serviceClient, ticketId, postCount ?? 0, user.id);
  } catch {
    return { error: 'Could not generate ticket summary.' };
  }
}

export async function refreshTicketSummary(formData: FormData): Promise<TicketSummaryResult> {
  try {
    const { supabase, user } = await requireAgentRole();
    const ticketId = Number(formData.get('ticket_id'));
    if (!ticketId) return { error: 'Invalid ticket ID' };

    const settings = await getSettingsMap(supabase, ['ai_ticket_summary_enabled']);
    if (settings.get('ai_ticket_summary_enabled') !== 'true') return {};

    const { count: postCount } = await supabase
      .from('posts')
      .select('id', { count: 'exact', head: true })
      .eq('ticket_id', ticketId);

    const serviceClient = createServiceRoleClient();

    // Delete existing cache
    await serviceClient.from('ticket_summaries').delete().eq('ticket_id', ticketId);

    return generateSummary(supabase, serviceClient, ticketId, postCount ?? 0, user.id);
  } catch {
    return { error: 'Could not refresh ticket summary.' };
  }
}

async function generateSummary(
  supabase: Awaited<ReturnType<typeof createServerClient>>,
  serviceClient: ReturnType<typeof createServiceRoleClient>,
  ticketId: number,
  postCount: number,
  agentId: string,
): Promise<TicketSummaryResult> {
  const { data: posts } = await supabase
    .from('posts')
    .select('body, post_type, created_at, author:profiles!posts_author_id_fkey(display_name, role)')
    .eq('ticket_id', ticketId)
    .order('created_at', { ascending: true });

  const { data: ticket } = await supabase
    .from('tickets')
    .select('title, status')
    .eq('id', ticketId)
    .single();

  const systemPrompt = `Summarize this support ticket conversation. Provide: 1) The problem reported, 2) Key discussion points, 3) Current status and any pending actions. Be concise (2-3 paragraphs). Return only the summary text.`;

  const postContext = (posts ?? []).map((p) => {
    const author = Array.isArray(p.author) ? p.author[0] : p.author;
    const role = (author as { display_name: string | null; role: string } | null)?.role ?? 'user';
    const name = (author as { display_name: string | null } | null)?.display_name ?? 'Unknown';
    return `[${new Date(p.created_at).toISOString()}] [${role}] ${name} (${p.post_type}): ${p.body}`;
  }).join('\n\n');

  const userPrompt = `Ticket: ${ticket?.title ?? 'Unknown'}
Status: ${ticket?.status ?? 'unknown'}

Posts:
${postContext}`;

  const result = await callAiText(systemPrompt, userPrompt);

  // Cache the result
  await serviceClient.from('ticket_summaries').upsert(
    {
      ticket_id: ticketId,
      summary: result.content,
      post_count_at_generation: postCount,
      generated_at: new Date().toISOString(),
    },
    { onConflict: 'ticket_id' },
  );

  await logAiUsage(agentId, 'ticket_summary', result.tokensUsed);

  return { summary: result.content };
}

// ============================================================
// 5. Generate KB Article (§23.5)
// ============================================================

export type GenerateKbArticleResult = {
  articleId?: number;
  redirectUrl?: string;
  error?: string;
};

export async function generateKbArticle(formData: FormData): Promise<GenerateKbArticleResult> {
  try {
    const { supabase, user } = await requireAgentRole();
    const ticketId = Number(formData.get('ticket_id'));
    if (!ticketId) return { error: 'Invalid ticket ID' };

    const settings = await getSettingsMap(supabase, ['ai_generate_kb_article_enabled']);
    if (settings.get('ai_generate_kb_article_enabled') !== 'true') {
      return { error: 'AI KB article generation is not enabled' };
    }

    // Ticket must be closed
    const { data: ticket } = await supabase
      .from('tickets')
      .select('id, title, status')
      .eq('id', ticketId)
      .single();

    if (!ticket) return { error: 'Ticket not found' };
    if (ticket.status !== 'closed') return { error: 'Only closed tickets can generate KB articles' };

    // Fetch posts
    const { data: posts } = await supabase
      .from('posts')
      .select('body, post_type, created_at, author:profiles!posts_author_id_fkey(display_name, role)')
      .eq('ticket_id', ticketId)
      .order('created_at', { ascending: true });

    // Fetch KB categories
    const { data: kbCategories } = await supabase
      .from('kb_categories')
      .select('id, name');

    const systemPrompt = `Based on this support ticket conversation, generate a knowledge base article. Output JSON with these fields:
- title: string (clear, descriptive article title)
- suggestedCategoryId: string or null (from the provided category list, or null if none fit)
- body: string (Markdown format summarizing the problem and solution)

IMPORTANT: Strip all personally identifiable information (names, emails, account numbers) from the body. Replace with generic placeholders like [User] or [Email] if needed.`;

    const postContext = (posts ?? []).map((p) => {
      const author = Array.isArray(p.author) ? p.author[0] : p.author;
      const role = (author as { display_name: string | null; role: string } | null)?.role ?? 'user';
      const name = (author as { display_name: string | null } | null)?.display_name ?? 'Unknown';
      return `[${role}] ${name} (${p.post_type}): ${p.body}`;
    }).join('\n\n');

    const userPrompt = `Ticket: #${ticket.id} - ${ticket.title}

Conversation:
${postContext}

Available KB categories: ${JSON.stringify((kbCategories ?? []).map((c) => ({ id: c.id, name: c.name })))}`;

    const result = await callAi(systemPrompt, userPrompt);
    const parsed = JSON.parse(result.content);

    const articleTitle = (parsed.title as string)?.slice(0, 300) || `KB: ${ticket.title}`.slice(0, 300);
    let articleBody = (parsed.body as string) || '';

    // Post-processing PII safety net: strip common patterns
    articleBody = articleBody
      .replace(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g, '[Email]')
      .replace(/\b\d{3}[-.]?\d{3}[-.]?\d{4}\b/g, '[Phone]');

    const catIds = new Set((kbCategories ?? []).map((c) => c.id));
    const categoryId = parsed.suggestedCategoryId && catIds.has(parsed.suggestedCategoryId)
      ? parsed.suggestedCategoryId
      : null;

    const slug = generateSlug(articleTitle);

    const { data: created, error } = await supabase
      .from('kb_articles')
      .insert({
        title: articleTitle,
        slug,
        body: articleBody,
        status: 'draft',
        category_id: categoryId,
        author_id: user.id,
        source_ticket_id: ticketId,
      })
      .select('id')
      .single();

    if (error) return { error: 'Failed to create KB article.' };

    await logAiUsage(user.id, 'generate_kb_article', result.tokensUsed);

    revalidatePath('/kb/manage');
    return { articleId: created.id, redirectUrl: `/kb/manage/${created.id}` };
  } catch {
    return { error: 'Could not generate KB article. Please try again.' };
  }
}

// ============================================================
// 6. Admin: AI Settings
// ============================================================

export async function getAiSettings(): Promise<Record<string, string>> {
  const supabase = await createServerClient();
  const { data } = await supabase
    .from('app_settings')
    .select('key, value')
    .like('key', 'ai_%');

  const map: Record<string, string> = {};
  for (const row of data ?? []) {
    map[row.key] = row.value;
  }

  // Check if API key exists in Vault
  const serviceClient = createServiceRoleClient();
  let vaultKeyPresent = false;
  const { data: secret } = await serviceClient.rpc('get_ai_api_key');
  if (secret && typeof secret === 'string' && secret.length > 0) {
    vaultKeyPresent = true;
  }
  if (!vaultKeyPresent) {
    const { data: vaultRows } = await serviceClient
      .from('vault.decrypted_secrets' as string)
      .select('decrypted_secret')
      .eq('name', 'ai_api_key')
      .limit(1);
    if (vaultRows && vaultRows.length > 0) {
      vaultKeyPresent = !!(vaultRows[0] as Record<string, string>).decrypted_secret;
    }
  }

  const envKeyPresent = !!(process.env.AI_API_KEY);
  const keySource = vaultKeyPresent ? 'vault' : (envKeyPresent ? 'env' : 'none');

  map.ai_api_key_present = (vaultKeyPresent || envKeyPresent) ? 'true' : 'false';
  map.ai_api_key_source = keySource;
  map.ai_env_key_present = envKeyPresent ? 'true' : 'false';

  return map;
}

export async function getAiUsageStats(): Promise<{
  totalCalls: number;
  totalTokens: number;
  byFeature: Record<string, { calls: number; tokens: number }>;
}> {
  const supabase = await createServerClient();

  // Only admins can read ai_usage_log
  const startOfMonth = new Date();
  startOfMonth.setDate(1);
  startOfMonth.setHours(0, 0, 0, 0);

  const { data: rows } = await supabase
    .from('ai_usage_log')
    .select('feature, tokens_used')
    .gte('created_at', startOfMonth.toISOString());

  const byFeature: Record<string, { calls: number; tokens: number }> = {};
  let totalCalls = 0;
  let totalTokens = 0;

  for (const row of rows ?? []) {
    totalCalls++;
    totalTokens += row.tokens_used ?? 0;
    if (!byFeature[row.feature]) {
      byFeature[row.feature] = { calls: 0, tokens: 0 };
    }
    byFeature[row.feature].calls++;
    byFeature[row.feature].tokens += row.tokens_used ?? 0;
  }

  return { totalCalls, totalTokens, byFeature };
}

export async function saveAiSettings(formData: FormData): Promise<{ error?: string }> {
  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const { data: profile } = await supabase
    .from('profiles')
    .select('id, role')
    .eq('id', user.id)
    .single();

  if (!profile || profile.role !== 'admin') {
    return { error: 'Forbidden' };
  }

  const settingsToUpdate: Record<string, string> = {};

  // Provider
  const provider = formData.get('ai_provider') as string ?? '';
  if (['', 'openai', 'anthropic', 'custom'].includes(provider)) {
    settingsToUpdate.ai_provider = provider;
  }

  // Model
  settingsToUpdate.ai_model = (formData.get('ai_model') as string ?? '').trim();

  // Custom endpoint
  settingsToUpdate.ai_custom_endpoint_url = (formData.get('ai_custom_endpoint_url') as string ?? '').trim();

  // Timeout
  const timeout = parseInt(formData.get('ai_request_timeout') as string ?? '60', 10);
  settingsToUpdate.ai_request_timeout = String(Math.max(10, Math.min(300, timeout || 60)));

  // Feature toggles
  settingsToUpdate.ai_auto_categorize_enabled = formData.get('ai_auto_categorize_enabled') === 'on' ? 'true' : 'false';
  const minBodyLength = parseInt(formData.get('ai_auto_categorize_min_body_length') as string ?? '20', 10);
  settingsToUpdate.ai_auto_categorize_min_body_length = String(Math.max(10, minBodyLength || 20));

  settingsToUpdate.ai_duplicate_detection_enabled = formData.get('ai_duplicate_detection_enabled') === 'on' ? 'true' : 'false';
  const threshold = formData.get('ai_duplicate_detection_threshold') as string ?? 'medium';
  if (['low', 'medium', 'high'].includes(threshold)) {
    settingsToUpdate.ai_duplicate_detection_threshold = threshold;
  }

  settingsToUpdate.ai_suggested_reply_enabled = formData.get('ai_suggested_reply_enabled') === 'on' ? 'true' : 'false';
  const contextWindow = parseInt(formData.get('ai_suggested_reply_context_window') as string ?? '20', 10);
  settingsToUpdate.ai_suggested_reply_context_window = String(Math.max(5, Math.min(50, contextWindow || 20)));
  const rateLimit = parseInt(formData.get('ai_suggested_reply_rate_limit') as string ?? '20', 10);
  settingsToUpdate.ai_suggested_reply_rate_limit = String(Math.max(0, rateLimit));

  settingsToUpdate.ai_ticket_summary_enabled = formData.get('ai_ticket_summary_enabled') === 'on' ? 'true' : 'false';
  const minPosts = parseInt(formData.get('ai_ticket_summary_min_posts') as string ?? '10', 10);
  settingsToUpdate.ai_ticket_summary_min_posts = String(Math.max(5, minPosts || 10));

  settingsToUpdate.ai_generate_kb_article_enabled = formData.get('ai_generate_kb_article_enabled') === 'on' ? 'true' : 'false';

  // Save all settings
  for (const [key, value] of Object.entries(settingsToUpdate)) {
    await supabase.from('app_settings').update({ value }).eq('key', key);
  }

  // Handle API key if provided
  const apiKey = (formData.get('ai_api_key') as string ?? '').trim();
  if (apiKey) {
    const serviceClient = createServiceRoleClient();
    // Delete existing secret
    try { await serviceClient.rpc('delete_ai_api_key'); } catch { /* ignore if not exists */ }
    // Try vault insert via raw SQL
    const { error: vaultError } = await serviceClient.rpc('store_ai_api_key', { key_value: apiKey });
    if (vaultError) {
      // Fallback: try direct vault access
      console.error('[AI Settings] Vault storage error:', vaultError.message);
    }
  }

  // Audit log
  await supabase.from('admin_audit_log').insert({
    admin_id: profile.id,
    action: 'update_ai_settings',
    target_type: 'app_settings',
    details: { updated_keys: Object.keys(settingsToUpdate) },
  });

  revalidatePath('/admin/ai');
  return {};
}

export async function testAiConnection(): Promise<{ success: boolean; error?: string; model?: string }> {
  try {
    const config = await getAiConfig();
    if (!config) return { success: false, error: 'AI is not configured. Please save provider, model, and API key first.' };

    await callAiText(
      'You are a test assistant. Reply with exactly: "Connection successful."',
      'Test connection.',
      { timeout: 15 },
    );

    return { success: true, model: config.model };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return { success: false, error: message };
  }
}
