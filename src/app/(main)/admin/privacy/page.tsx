import { createServerClient } from '@/lib/supabase/server';
import { updatePrivacySettings } from '@/lib/actions/admin';

export default async function AdminPrivacyPage() {
  const supabase = await createServerClient();

  const { data: settings } = await supabase
    .from('app_settings')
    .select('key, value')
    .in('key', ['ticket_default_privacy', 'allow_user_privacy_control', 'allow_public_ticket_browsing']);

  const settingsMap: Record<string, string> = {};
  for (const s of settings ?? []) {
    settingsMap[s.key] = s.value;
  }

  const defaultPrivacy = settingsMap.ticket_default_privacy ?? 'true';
  const allowPrivacyControl = settingsMap.allow_user_privacy_control !== 'false';
  const allowPublicBrowsing = settingsMap.allow_public_ticket_browsing === 'true';

  return (
    <div>
      <h1 className="text-2xl font-semibold text-gray-900 mb-6">Ticket Privacy</h1>

      <form action={updatePrivacySettings} className="bg-white rounded-lg border border-gray-200 p-6 space-y-6">
        <fieldset>
          <legend className="text-sm font-semibold text-gray-700 mb-3">Default Ticket Privacy</legend>
          <div className="space-y-2">
            <label className="flex items-center gap-2">
              <input
                type="radio"
                name="ticket_default_privacy"
                value="true"
                defaultChecked={defaultPrivacy === 'true'}
                className="h-4 w-4 text-blue-600 border-gray-300"
              />
              <span className="text-sm text-gray-700">Private by default</span>
            </label>
            <label className="flex items-center gap-2">
              <input
                type="radio"
                name="ticket_default_privacy"
                value="false"
                defaultChecked={defaultPrivacy !== 'true'}
                className="h-4 w-4 text-blue-600 border-gray-300"
              />
              <span className="text-sm text-gray-700">Public by default</span>
            </label>
          </div>
        </fieldset>

        <div className="flex items-center gap-2">
          <input
            type="checkbox"
            name="allow_user_privacy_control"
            id="allow_user_privacy_control"
            defaultChecked={allowPrivacyControl}
            className="h-4 w-4 rounded border-gray-300 text-blue-600"
          />
          <label htmlFor="allow_user_privacy_control" className="text-sm text-gray-700">
            Allow users to change ticket privacy
          </label>
        </div>

        <div className="flex items-center gap-2">
          <input
            type="checkbox"
            name="allow_public_ticket_browsing"
            id="allow_public_ticket_browsing"
            defaultChecked={allowPublicBrowsing}
            className="h-4 w-4 rounded border-gray-300 text-blue-600"
          />
          <label htmlFor="allow_public_ticket_browsing" className="text-sm text-gray-700">
            Allow public access for unauthenticated visitors
          </label>
        </div>

        <button
          type="submit"
          className="px-4 py-2 text-sm bg-blue-600 text-white rounded hover:bg-blue-700 font-medium"
        >
          Save
        </button>
      </form>
    </div>
  );
}
