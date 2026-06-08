import { createServerClient } from '@/lib/supabase/server';
import { requireAuth } from '@/lib/supabase/auth';
import { TicketForm } from '@/components/features/tickets/TicketForm';
import { resolveCloneSource } from '@/lib/actions/clone';

export default async function NewTicketPage({
  searchParams,
}: {
  searchParams: Promise<{ from_article?: string; clone_from?: string; clone_post?: string }>;
}) {
  const user = await requireAuth();
  const { from_article, clone_from, clone_post } = await searchParams;
  const supabase = await createServerClient();

  const { data: profileWithHeights, error: profileError } = await supabase
    .from('profiles')
    .select('role, editor_view_mode, editor_min_height_px, editor_max_height_px')
    .eq('id', user.id)
    .single();

  // Older local DBs without migration 027 don't have the height columns;
  // fall back to selecting just editor_view_mode so the page still renders.
  let profile: {
    role?: string | null;
    editor_view_mode?: string | null;
    editor_min_height_px?: number | null;
    editor_max_height_px?: number | null;
  } | null = profileWithHeights;
  if (profileError?.code === '42703') {
    const { data: legacyProfile } = await supabase
      .from('profiles')
      .select('role, editor_view_mode')
      .eq('id', user.id)
      .single();
    profile = legacyProfile
      ? { ...legacyProfile, editor_min_height_px: null, editor_max_height_px: null }
      : null;
  }

  // Clone prefill (agent-only). When the page is opened from a "Clone" link, the
  // form is prefilled from the source; submitting it creates the clone, and
  // Cancel returns to the source ticket without writing anything.
  const isAgent = profile?.role === 'agent' || profile?.role === 'admin';
  const clone =
    isAgent && (clone_from || clone_post)
      ? await resolveCloneSource(clone_from ?? null, clone_post ?? null)
      : null;

  // Fetch ticket types
  const { data: ticketTypes } = await supabase
    .from('ticket_types')
    .select('id, name, is_default')
    .order('name');

  // Fetch categories
  const { data: categories } = await supabase
    .from('categories')
    .select('id, name')
    .order('name');

  // Fetch custom fields
  const { data: customFields } = await supabase
    .from('custom_fields')
    .select('*')
    .order('display_order');

  // Fetch privacy settings
  const { data: defaultPrivacySetting } = await supabase
    .from('app_settings')
    .select('value')
    .eq('key', 'ticket_default_privacy')
    .single();

  const { data: privacyControlSetting } = await supabase
    .from('app_settings')
    .select('value')
    .eq('key', 'allow_user_privacy_control')
    .single();

  const defaultPrivate = defaultPrivacySetting?.value !== 'false';
  const showPrivacyControl = privacyControlSetting?.value !== 'false';

  // Fetch AI feature settings
  const { data: aiSettings } = await supabase
    .from('app_settings')
    .select('key, value')
    .in('key', ['ai_auto_categorize_enabled', 'ai_duplicate_detection_enabled']);

  const aiMap = new Map(aiSettings?.map((s) => [s.key, s.value]) ?? []);
  const aiAutoCategEnabled = aiMap.get('ai_auto_categorize_enabled') === 'true';
  const aiDuplicateEnabled = aiMap.get('ai_duplicate_detection_enabled') === 'true';

  // If from_article param, fetch article for prefill
  let fromArticleTitle: string | null = null;
  let fromArticleId: number | null = null;
  const parsedArticleId = from_article ? parseInt(from_article, 10) : NaN;
  if (!isNaN(parsedArticleId) && parsedArticleId > 0) {
    const { data: article } = await supabase
      .from('kb_articles')
      .select('id, title')
      .eq('id', parsedArticleId)
      .single();
    if (article) {
      fromArticleId = article.id;
      fromArticleTitle = `Question about: ${article.title}`;
    }
  }

  return (
    <div>
      <h1 className="text-2xl font-semibold text-gray-900 mb-6">
        {clone ? 'Clone Ticket' : 'Create Ticket'}
      </h1>
      <div className="bg-white rounded-lg border border-gray-200 p-6">
        <TicketForm
          ticketTypes={ticketTypes ?? []}
          categories={categories ?? []}
          customFields={customFields ?? []}
          defaultPrivate={defaultPrivate}
          showPrivacyControl={showPrivacyControl}
          editorViewMode={(profile?.editor_view_mode as 'both' | 'preview' | 'editor' | null) ?? 'both'}
          editorMinHeightPx={
            typeof (profile as { editor_min_height_px?: number | null } | null)?.editor_min_height_px === 'number'
              ? (profile as { editor_min_height_px: number }).editor_min_height_px
              : undefined
          }
          editorMaxHeightPx={
            typeof (profile as { editor_max_height_px?: number | null } | null)?.editor_max_height_px === 'number'
              ? (profile as { editor_max_height_px: number }).editor_max_height_px
              : undefined
          }
          initialTitle={clone ? clone.prefill.title : fromArticleTitle}
          initialBody={clone?.prefill.body}
          initialType={clone?.prefill.typeId ?? undefined}
          initialCategory={clone?.prefill.categoryId ?? undefined}
          initialUrgency={clone?.prefill.urgency ?? undefined}
          initialPrivate={clone?.prefill.isPrivate}
          initialCustomFields={clone?.prefill.customFields}
          cloneFromId={clone ? clone.sourceTicketId : undefined}
          cloneFromPostId={clone?.sourcePostId ?? undefined}
          cancelHref={clone ? `/tickets/${clone.sourceTicketId}/${clone.sourceSlug}` : undefined}
          sourceArticleId={fromArticleId}
          aiAutoCategEnabled={aiAutoCategEnabled}
          aiDuplicateEnabled={aiDuplicateEnabled}
        />
      </div>
    </div>
  );
}
