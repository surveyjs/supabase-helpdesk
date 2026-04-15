import { createServerClient } from '@/lib/supabase/server';
import { requireAuth } from '@/lib/supabase/auth';
import { TicketForm } from '@/components/features/tickets/TicketForm';

export default async function NewTicketPage({
  searchParams,
}: {
  searchParams: Promise<{ from_article?: string }>;
}) {
  await requireAuth();
  const { from_article } = await searchParams;
  const supabase = await createServerClient();

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
      <h1 className="text-2xl font-semibold text-gray-900 mb-6">Create Ticket</h1>
      <div className="bg-white rounded-lg border border-gray-200 p-6">
        <TicketForm
          ticketTypes={ticketTypes ?? []}
          categories={categories ?? []}
          customFields={customFields ?? []}
          defaultPrivate={defaultPrivate}
          showPrivacyControl={showPrivacyControl}
          initialTitle={fromArticleTitle}
          sourceArticleId={fromArticleId}
          aiAutoCategEnabled={aiAutoCategEnabled}
          aiDuplicateEnabled={aiDuplicateEnabled}
        />
      </div>
    </div>
  );
}
