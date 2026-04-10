import { createServerClient } from '@/lib/supabase/server';
import { updateUserSettings } from '@/lib/actions/admin';

export default async function AdminUserSettingsPage() {
  const supabase = await createServerClient();

  const { data: setting } = await supabase
    .from('app_settings')
    .select('value')
    .eq('key', 'enforce_display_name_uniqueness')
    .single();

  const enforceUniqueness = setting?.value === 'true';

  return (
    <div>
      <h1 className="text-2xl font-semibold text-gray-900 mb-6">User Settings</h1>

      <form action={updateUserSettings} className="bg-white rounded-lg border border-gray-200 p-6 space-y-6">
        <div className="flex items-center gap-2">
          <input
            type="checkbox"
            name="enforce_display_name_uniqueness"
            id="enforce_display_name_uniqueness"
            defaultChecked={enforceUniqueness}
            className="h-4 w-4 rounded border-gray-300 text-blue-600"
          />
          <label htmlFor="enforce_display_name_uniqueness" className="text-sm text-gray-700">
            Enforce display name uniqueness
          </label>
        </div>

        <div className="border-t border-gray-200 pt-4">
          <h3 className="text-sm font-medium text-gray-700 mb-2">Default Notification Preferences</h3>
          <p className="text-sm text-gray-500">
            Notification preferences will be configurable after email notifications are implemented in Phase 9.
          </p>
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
