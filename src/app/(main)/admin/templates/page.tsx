import { createServerClient } from '@/lib/supabase/server';
import { resetNotificationTemplate } from '@/lib/actions/admin';
import { TEMPLATE_LABELS, TEMPLATE_PLACEHOLDERS } from '@/lib/constants/notification-templates';
import { TemplatesSurveyForm } from './TemplatesSurveyForm';

const TEMPLATE_CATEGORIES: Record<string, string[]> = {
  'User Notifications': ['new_post', 'status_changed', 'agent_assigned', 'auto_reopen', 'urgency_changed', 'severity_changed', 'privacy_changed'],
  'Agent Notifications': ['agent_assigned_to_agent', 'user_reply_to_agent'],
  'Auto-Replies & System': ['duplicate_post', 'merge_post', 'merge_banner', 'bulk_action_summary', 'consolidated_update'],
};

const CATEGORY_ORDER = Object.keys(TEMPLATE_CATEGORIES);

function categoryOf(eventType: string): string {
  for (const [cat, list] of Object.entries(TEMPLATE_CATEGORIES)) {
    if (list.includes(eventType)) return cat;
  }
  return 'Other';
}

export default async function AdminTemplatesPage() {
  const supabase = await createServerClient();

  const { data: templates } = await supabase
    .from('notification_templates')
    .select('event_type, subject, body, is_customized')
    .order('event_type');

  const rows = (templates ?? []).slice().sort((a, b) => {
    const ai = CATEGORY_ORDER.indexOf(categoryOf(a.event_type));
    const bi = CATEGORY_ORDER.indexOf(categoryOf(b.event_type));
    if (ai !== bi) return ai - bi;
    const aPos = (TEMPLATE_CATEGORIES[CATEGORY_ORDER[ai]] ?? []).indexOf(a.event_type);
    const bPos = (TEMPLATE_CATEGORIES[CATEGORY_ORDER[bi]] ?? []).indexOf(b.event_type);
    return aPos - bPos;
  });

  return (
    <div>
      <h1 className="text-2xl font-semibold text-gray-900 mb-6">Notification Templates</h1>

      <div className="space-y-6">
        {rows.length === 0 ? (
          <div className="bg-white rounded-lg border border-gray-200 p-6">
            <p className="text-gray-500 text-sm">No notification templates found.</p>
          </div>
        ) : (
          <>
            <p className="text-sm text-gray-600">
              Edit subject and body for each template, then click <strong>Apply</strong> to save all changes.
            </p>

            <TemplatesSurveyForm
              initial={rows.map((t) => ({
                event_type: t.event_type,
                subject: t.subject,
                body: t.body,
              }))}
            />

            {CATEGORY_ORDER.map((category) => {
              const eventTypes = TEMPLATE_CATEGORIES[category] ?? [];
              const inCategory = rows.filter((t) => eventTypes.includes(t.event_type));
              if (inCategory.length === 0) return null;

              return (
                <div key={category}>
                  <h2 className="text-lg font-medium text-gray-800 mb-3">{category}</h2>
                  <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
                    <table className="min-w-full divide-y divide-gray-200">
                      <thead className="bg-gray-50">
                        <tr>
                          <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Event</th>
                          <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Placeholders</th>
                          <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Status</th>
                          <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Actions</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-200">
                        {inCategory.map((tpl) => (
                          <tr key={tpl.event_type}>
                            <td className="px-4 py-2 text-sm text-gray-900">
                              <div className="flex items-center gap-2">
                                <span>{TEMPLATE_LABELS[tpl.event_type] ?? tpl.event_type}</span>
                                <code className="text-xs text-gray-500 bg-gray-100 px-1.5 py-0.5 rounded">
                                  {tpl.event_type}
                                </code>
                              </div>
                            </td>
                            <td className="px-4 py-2 text-xs text-gray-600">
                              {TEMPLATE_PLACEHOLDERS[tpl.event_type]?.length
                                ? TEMPLATE_PLACEHOLDERS[tpl.event_type].map((p) => (
                                    <code key={p} className="bg-gray-100 px-1 rounded mx-0.5">
                                      {'{{' + p + '}}'}
                                    </code>
                                  ))
                                : '—'}
                            </td>
                            <td className="px-4 py-2 text-xs">
                              {tpl.is_customized ? (
                                <span className="inline-flex items-center px-2 py-0.5 rounded-full font-medium bg-blue-100 text-blue-700">
                                  Customized
                                </span>
                              ) : (
                                <span className="text-gray-500">Default</span>
                              )}
                            </td>
                            <td className="px-4 py-2">
                              <form action={resetNotificationTemplate}>
                                <input type="hidden" name="event_type" value={tpl.event_type} />
                                <button
                                  type="submit"
                                  className="px-3 py-1 text-xs bg-gray-100 text-gray-700 rounded hover:bg-gray-200 font-medium"
                                  data-testid={`reset-template-${tpl.event_type}`}
                                >
                                  Reset to Default
                                </button>
                              </form>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              );
            })}
          </>
        )}
      </div>
    </div>
  );
}
