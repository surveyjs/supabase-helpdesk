import { createServerClient } from '@/lib/supabase/server';
import { updatePaginationSettings } from '@/lib/actions/admin';

export default async function AdminPaginationPage() {
  const supabase = await createServerClient();

  const keys = [
    'user_page_size',
    'agent_dashboard_page_size',
    'other_lists_page_size',
    'visible_posts_threshold',
    'visible_comments_threshold',
  ];

  const { data: settings } = await supabase
    .from('app_settings')
    .select('key, value')
    .in('key', keys);

  const settingsMap: Record<string, string> = {};
  for (const s of settings ?? []) {
    settingsMap[s.key] = s.value;
  }

  const fields = [
    { key: 'user_page_size', label: 'User ticket list page size', min: 5, max: 100, default: '20' },
    { key: 'agent_dashboard_page_size', label: 'Agent dashboard page size', min: 5, max: 100, default: '20' },
    { key: 'other_lists_page_size', label: 'Other lists page size', min: 5, max: 100, default: '20' },
    { key: 'visible_posts_threshold', label: 'Visible posts threshold', min: 3, max: 50, default: '10' },
    { key: 'visible_comments_threshold', label: 'Visible comments threshold', min: 1, max: 20, default: '3' },
  ];

  return (
    <div>
      <h1 className="text-2xl font-semibold text-gray-900 mb-6">Pagination Settings</h1>

      <form action={updatePaginationSettings} className="bg-white rounded-lg border border-gray-200 p-6 space-y-4">
        {fields.map((f) => (
          <div key={f.key}>
            <label htmlFor={f.key} className="block text-sm font-medium text-gray-700 mb-1">
              {f.label}
              <span className="text-xs text-gray-400 ml-2">({f.min}–{f.max})</span>
            </label>
            <input
              id={f.key}
              type="number"
              name={f.key}
              min={f.min}
              max={f.max}
              defaultValue={settingsMap[f.key] ?? f.default}
              required
              className="w-32 rounded border border-gray-300 px-3 py-1.5 text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none"
            />
          </div>
        ))}

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
