import { createServerClient } from '@/lib/supabase/server';
import { requireAdmin } from '@/lib/supabase/auth';
import {
  saveTierApiSecret,
  deleteTierApiSecret,
  getTierApiSecretStatus,
} from '@/lib/actions/tiers';
import { TierApiSecretCard } from './TierApiSecretCard';
import { TiersSurveyForm } from './TiersSurveyForm';

export default async function TiersPage() {
  await requireAdmin();
  const supabase = await createServerClient();

  const { data: tiers } = await supabase
    .from('subscription_tiers')
    .select(
      'id, key, display_name, sort_order, cap_change_visibility, cap_set_severity, cap_change_status, cap_change_type, cap_add_remove_tags',
    )
    .order('sort_order');

  const initial = (tiers ?? []).map((t) => ({
    id: t.id as string,
    key: t.key as string,
    display_name: t.display_name as string,
    cap_change_visibility: !!t.cap_change_visibility,
    cap_set_severity: !!t.cap_set_severity,
    cap_change_status: !!t.cap_change_status,
    cap_change_type: !!t.cap_change_type,
    cap_add_remove_tags: !!t.cap_add_remove_tags,
  }));

  const apiStatus = await getTierApiSecretStatus();
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';

  return (
    <div>
      <h1 className="text-2xl font-bold text-gray-900 mb-6">Subscription Tiers</h1>
      <p className="text-sm text-gray-600 mb-4">
        Edit tiers in the matrix below. <strong>Key</strong> is immutable once a tier is created.
        Use the toggles to grant capabilities to each tier. Click <strong>Complete</strong> to save
        all changes.
      </p>

      <div className="mb-6">
        <TiersSurveyForm initial={initial} />
      </div>

      {/* External API Settings — side-channel, kept outside the SurveyJS form */}
      <TierApiSecretCard
        configured={apiStatus.configured}
        masked={apiStatus.masked}
        apiEndpoint={`${appUrl}/api/tiers/assign`}
        saveTierApiSecret={saveTierApiSecret}
        deleteTierApiSecret={deleteTierApiSecret}
      />
    </div>
  );
}
