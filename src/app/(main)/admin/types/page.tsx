import { createServerClient } from '@/lib/supabase/server';
import { setDefaultTicketType } from '@/lib/actions/admin';
import { TypesSurveyForm } from './TypesSurveyForm';

export default async function AdminTypesPage() {
  const supabase = await createServerClient();

  const { data: types } = await supabase
    .from('ticket_types')
    .select('id, name, is_default')
    .order('name');

  const initial = (types ?? []).map((t) => ({
    id: t.id as string,
    name: t.name as string,
  }));

  return (
    <div>
      <h1 className="text-2xl font-semibold text-gray-900 mb-6">Manage Ticket Types</h1>
      <p className="text-sm text-gray-600 mb-4">
        Add, rename, or remove ticket types. Click <strong>Complete</strong> to save all changes.
      </p>
      <TypesSurveyForm initial={initial} />

      <div className="mt-6 bg-white rounded-lg border border-gray-200 p-6">
        <h2 className="text-sm font-semibold text-gray-700 mb-3 uppercase tracking-wider">Default Ticket Type</h2>
        {(!types || types.length === 0) ? (
          <p className="text-gray-500 text-sm">No ticket types defined.</p>
        ) : (
          <ul className="divide-y divide-gray-200">
            {types.map((t) => (
              <li key={t.id} className="py-2 flex items-center gap-3">
                <span className="text-sm text-gray-900">{t.name}</span>
                {t.is_default ? (
                  <span className="text-xs text-green-700 font-medium">(default)</span>
                ) : (
                  <form action={setDefaultTicketType}>
                    <input type="hidden" name="type_id" value={t.id} />
                    <button
                      type="submit"
                      className="px-2 py-1 text-xs bg-green-100 text-green-700 rounded hover:bg-green-200"
                    >
                      Set Default
                    </button>
                  </form>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
