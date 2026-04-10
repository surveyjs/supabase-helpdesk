import { createServerClient } from '@/lib/supabase/server';
import { updateNotificationTemplate, resetNotificationTemplate } from '@/lib/actions/admin';

export default async function AdminDuplicateTemplatePage() {
  const supabase = await createServerClient();

  const { data: tpl } = await supabase
    .from('notification_templates')
    .select('*')
    .eq('event_type', 'duplicate_post')
    .single();

  return (
    <div>
      <h1 className="text-2xl font-semibold text-gray-900 mb-6">Duplicate Ticket Template</h1>

      <div className="bg-white rounded-lg border border-gray-200 p-6">
        <p className="text-sm text-gray-600 mb-4">
          This template is used when a ticket is marked as a duplicate. Use{' '}
          <code className="bg-gray-100 px-1 rounded">{'{{ticketId}}'}</code>{' '}
          to reference the original ticket ID.
        </p>

        {tpl ? (
          <>
            <form action={updateNotificationTemplate} className="space-y-3 mb-3">
              <input type="hidden" name="event_type" value="duplicate_post" />
              <input type="hidden" name="subject" value={tpl.subject} />
              <div>
                <label htmlFor="dup-body" className="block text-xs font-medium text-gray-500 mb-1">
                  Template Body (Markdown)
                </label>
                <textarea
                  id="dup-body"
                  name="body"
                  rows={4}
                  defaultValue={tpl.body}
                  required
                  className="w-full rounded border border-gray-300 px-3 py-1.5 text-sm font-mono focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none"
                />
              </div>
              {tpl.is_customized && (
                <p className="text-xs text-blue-600">This template has been customized.</p>
              )}
              <button
                type="submit"
                className="px-4 py-2 text-sm bg-blue-600 text-white rounded hover:bg-blue-700 font-medium"
              >
                Save
              </button>
            </form>
            <form action={resetNotificationTemplate}>
              <input type="hidden" name="event_type" value="duplicate_post" />
              <button
                type="submit"
                className="px-4 py-1.5 text-sm bg-gray-100 text-gray-700 rounded hover:bg-gray-200 font-medium"
              >
                Reset to Default
              </button>
            </form>
          </>
        ) : (
          <p className="text-gray-500 text-sm">Duplicate template not found. Run migrations to seed templates.</p>
        )}
      </div>
    </div>
  );
}
