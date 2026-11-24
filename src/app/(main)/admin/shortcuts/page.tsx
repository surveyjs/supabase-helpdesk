import { createServerClient } from '@/lib/supabase/server';
import { SHORTCUTS_SETTING_KEY, resolveShortcuts } from '@/lib/shortcuts';
import { ShortcutsSurveyForm } from './ShortcutsSurveyForm';

export default async function AdminShortcutsPage() {
  const supabase = await createServerClient();
  const { data } = await supabase
    .from('app_settings')
    .select('value')
    .eq('key', SHORTCUTS_SETTING_KEY)
    .maybeSingle();

  return (
    <div>
      <h1 className="text-2xl font-semibold text-gray-900 mb-6">Keyboard Shortcuts</h1>
      <ShortcutsSurveyForm values={resolveShortcuts(data?.value)} />
    </div>
  );
}
