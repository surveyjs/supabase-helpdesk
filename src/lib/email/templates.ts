import { createServiceRoleClient } from '@/lib/supabase/server';
import { renderMarkdown } from '@/lib/utils/markdown';
import { DEFAULT_TEMPLATES } from '@/lib/constants/notification-templates';

/**
 * Render a notification template for a given event type.
 * Fetches the template from the database, falls back to defaults.
 * Replaces {{placeholder}} tokens with provided values.
 * Renders the Markdown body to sanitized HTML.
 */
export async function renderTemplate(
  eventType: string,
  placeholders: Record<string, string>,
): Promise<{ subject: string; html: string }> {
  const supabase = createServiceRoleClient();

  // Try to get template from DB
  const { data: template } = await supabase
    .from('notification_templates')
    .select('subject, body, is_customized')
    .eq('event_type', eventType)
    .single();

  let subject: string;
  let body: string;

  if (template) {
    subject = template.subject;
    body = template.body;
  } else if (DEFAULT_TEMPLATES[eventType]) {
    subject = DEFAULT_TEMPLATES[eventType].subject;
    body = DEFAULT_TEMPLATES[eventType].body;
  } else {
    subject = 'Notification';
    body = 'You have a new notification.';
  }

  // Replace placeholders in subject and body
  for (const [key, value] of Object.entries(placeholders)) {
    const token = `{{${key}}}`;
    subject = subject.replaceAll(token, value);
    body = body.replaceAll(token, value);
  }

  // Render markdown body to HTML
  const html = await renderMarkdown(body);

  return { subject, html };
}
