import { createServerClient } from '@/lib/supabase/server';
import { DuplicateTemplateSurveyForm } from './DuplicateTemplateSurveyForm';

export default async function AdminDuplicateTemplatePage() {
  const supabase = await createServerClient();

  const { data: tpl } = await supabase
    .from('notification_templates')
    .select('event_type, subject, body, is_customized')
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
          <DuplicateTemplateSurveyForm template={tpl} />
        ) : (
          <p className="text-gray-500 text-sm">Duplicate template not found. Run migrations to seed templates.</p>
        )}
      </div>
    </div>
  );
}
