import { createServerClient } from '@/lib/supabase/server';
import {
  createTicketType,
  renameTicketType,
  deleteTicketType,
  setDefaultTicketType,
} from '@/lib/actions/admin';

export default async function AdminTypesPage() {
  const supabase = await createServerClient();

  const { data: types } = await supabase
    .from('ticket_types')
    .select('id, name, is_default')
    .order('name');

  return (
    <div>
      <h1 className="text-2xl font-semibold text-gray-900 mb-6">Manage Ticket Types</h1>

      <div className="bg-white rounded-lg border border-gray-200 p-6 mb-6">
        {(!types || types.length === 0) ? (
          <p className="text-gray-500 text-sm">No ticket types defined.</p>
        ) : (
          <ul className="divide-y divide-gray-200">
            {types.map((type) => (
              <li key={type.id} className="py-3 flex flex-wrap items-center gap-3">
                <span className="text-sm font-medium text-gray-900">
                  {type.name}
                  {type.is_default && (
                    <span className="ml-2 text-xs text-green-700 font-normal">(default)</span>
                  )}
                </span>

                {/* Rename form */}
                <form action={renameTicketType} className="flex gap-1 items-center">
                  <input type="hidden" name="type_id" value={type.id} />
                  <input
                    type="text"
                    name="name"
                    defaultValue={type.name}
                    maxLength={100}
                    className="rounded border border-gray-300 px-2 py-1 text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none"
                    aria-label={`Rename ${type.name}`}
                  />
                  <button type="submit" className="px-2 py-1 text-xs bg-gray-100 rounded hover:bg-gray-200 text-gray-700">
                    Rename
                  </button>
                </form>

                {/* Set default */}
                {!type.is_default && (
                  <form action={setDefaultTicketType}>
                    <input type="hidden" name="type_id" value={type.id} />
                    <button type="submit" className="px-2 py-1 text-xs bg-green-100 text-green-700 rounded hover:bg-green-200">
                      Set Default
                    </button>
                  </form>
                )}

                {/* Delete */}
                <form action={deleteTicketType}>
                  <input type="hidden" name="type_id" value={type.id} />
                  <button
                    type="submit"
                    className="px-2 py-1 text-xs bg-red-100 text-red-700 rounded hover:bg-red-200"
                    aria-label={`Delete ${type.name}`}
                  >
                    Delete
                  </button>
                </form>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Add new type */}
      <div className="bg-white rounded-lg border border-gray-200 p-6">
        <h2 className="text-sm font-semibold text-gray-700 mb-3 uppercase tracking-wider">Add New Type</h2>
        <form action={createTicketType} className="flex gap-2 items-end">
          <div>
            <label htmlFor="new-type-name" className="block text-xs font-medium text-gray-500 mb-1">Name</label>
            <input
              id="new-type-name"
              type="text"
              name="name"
              maxLength={100}
              required
              className="rounded border border-gray-300 px-3 py-1.5 text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none"
              placeholder="Type name…"
            />
          </div>
          <button
            type="submit"
            className="px-4 py-1.5 text-sm bg-blue-600 text-white rounded hover:bg-blue-700 font-medium"
          >
            Add Type
          </button>
        </form>
      </div>
    </div>
  );
}
