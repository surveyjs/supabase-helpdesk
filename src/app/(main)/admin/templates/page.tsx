import { createServerClient } from '@/lib/supabase/server';
import { updateNotificationTemplate, resetNotificationTemplate } from '@/lib/actions/admin';
import { TEMPLATE_LABELS, TEMPLATE_PLACEHOLDERS } from '@/lib/constants/notification-templates';

const TEMPLATE_CATEGORIES: Record<string, string[]> = {
  'User Notifications': ['new_post', 'status_changed', 'agent_assigned', 'auto_reopen', 'urgency_changed', 'severity_changed', 'privacy_changed'],
  'Agent Notifications': ['agent_assigned_to_agent', 'user_reply_to_agent'],
  'Auto-Replies & System': ['duplicate_post', 'merge_post', 'merge_banner', 'bulk_action_summary', 'consolidated_update'],
};

export default async function AdminTemplatesPage() {
  const supabase = await createServerClient();

  const { data: templates } = await supabase
    .from('notification_templates')
    .select('*')
    .order('event_type');

  return (
    <div>
      <h1 className="text-2xl font-semibold text-gray-900 mb-6">Notification Templates</h1>

      <div className="space-y-6">
        {(!templates || templates.length === 0) ? (
          <div className="bg-white rounded-lg border border-gray-200 p-6">
            <p className="text-gray-500 text-sm">No notification templates found.</p>
          </div>
        ) : (
          Object.entries(TEMPLATE_CATEGORIES).map(([category, eventTypes]) => {
            const categoryTemplates = eventTypes
              .map((et) => templates.find((t) => t.event_type === et))
              .filter(Boolean);

            if (categoryTemplates.length === 0) return null;

            return (
              <div key={category}>
                <h2 className="text-lg font-medium text-gray-800 mb-3">{category}</h2>
                <div className="space-y-4">
                  {categoryTemplates.map((tpl) => tpl && (
                    <div key={tpl.id} className="bg-white rounded-lg border border-gray-200 p-6">
                      <div className="flex items-center gap-3 mb-2">
                        <h3 className="text-sm font-medium text-gray-900">
                          {TEMPLATE_LABELS[tpl.event_type] ?? tpl.event_type}
                        </h3>
                        <code className="text-xs text-gray-500 bg-gray-100 px-1.5 py-0.5 rounded">
                          {tpl.event_type}
                        </code>
                        {tpl.is_customized && (
                          <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-700">
                            Customized
                          </span>
                        )}
                      </div>

                      {TEMPLATE_PLACEHOLDERS[tpl.event_type] && (
                        <p className="text-xs text-gray-500 mb-3">
                          Available placeholders:{' '}
                          {TEMPLATE_PLACEHOLDERS[tpl.event_type].map((p) => (
                            <code key={p} className="bg-gray-100 px-1 rounded mx-0.5">{'{{' + p + '}}'}</code>
                          ))}
                        </p>
                      )}

                      <details>
                        <summary className="text-xs text-blue-600 cursor-pointer hover:text-blue-800">
                          Edit Template
                        </summary>
                        <form action={updateNotificationTemplate} className="mt-3 space-y-3">
                          <input type="hidden" name="event_type" value={tpl.event_type} />
                          <div>
                            <label className="block text-xs font-medium text-gray-500 mb-1">Subject</label>
                            <input
                              type="text"
                              name="subject"
                              defaultValue={tpl.subject}
                              required
                              className="w-full rounded border border-gray-300 px-3 py-1.5 text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none"
                            />
                          </div>
                          <div>
                            <label className="block text-xs font-medium text-gray-500 mb-1">Body (Markdown)</label>
                            <textarea
                              name="body"
                              rows={4}
                              defaultValue={tpl.body}
                              required
                              className="w-full rounded border border-gray-300 px-3 py-1.5 text-sm font-mono focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none"
                            />
                          </div>
                          <div className="flex gap-2">
                            <button
                              type="submit"
                              className="px-4 py-1.5 text-sm bg-blue-600 text-white rounded hover:bg-blue-700 font-medium"
                            >
                              Save
                            </button>
                          </div>
                        </form>
                        <form action={resetNotificationTemplate} className="mt-2">
                          <input type="hidden" name="event_type" value={tpl.event_type} />
                          <button
                            type="submit"
                            className="px-4 py-1.5 text-sm bg-gray-100 text-gray-700 rounded hover:bg-gray-200 font-medium"
                          >
                            Reset to Default
                          </button>
                        </form>
                      </details>
                    </div>
                  ))}
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
