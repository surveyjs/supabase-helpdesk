import { createServerClient } from '@/lib/supabase/server';
import { parseSpamSettings, SPAM_SETTINGS_KEY } from '@/lib/spam';
import { SpamSurveyForm } from './SpamSurveyForm';

export default async function AdminSpamPage() {
  const supabase = await createServerClient();
  const { data } = await supabase.from('app_settings').select('value').eq('key', SPAM_SETTINGS_KEY).maybeSingle();
  const s = parseSpamSettings(data?.value);
  return (
    <div>
      <h1 className="text-2xl font-semibold text-gray-900 mb-2">Spam Rules</h1>
      <p className="text-sm text-gray-600 mb-6">
        Caught tickets get a &ldquo;Spam filter&rdquo; entry in their Logs tab saying why. Find flagged ones on
        the Agent Dashboard with the <strong>spam</strong> tag filter.
      </p>
      <SpamSurveyForm
        values={{
          enabled: s.enabled,
          action: s.action,
          blocked_senders: s.blockedSenders.join('\n'),
          blocked_domains: s.blockedDomains.join('\n'),
          keywords: s.keywords.join('\n'),
          patterns: s.patterns.join('\n'),
          ai_enabled: s.aiEnabled,
          ai_threshold: s.aiThreshold,
        }}
      />
    </div>
  );
}
