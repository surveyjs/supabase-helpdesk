import { createServerClient } from '@/lib/supabase/server';
import {
  createCustomField,
  updateCustomField,
  deleteCustomField,
  reorderCustomField,
} from '@/lib/actions/admin';

export default async function AdminCustomFieldsPage() {
  const supabase = await createServerClient();

  const { data: fields } = await supabase
    .from('custom_fields')
    .select('*')
    .order('display_order');

  return (
    <div>
      <h1 className="text-2xl font-semibold text-gray-900 mb-6">Custom Fields</h1>

      {/* Existing fields */}
      <div className="bg-white rounded-lg border border-gray-200 p-6 mb-6">
        <h2 className="text-sm font-semibold text-gray-700 mb-3 uppercase tracking-wider">Defined Fields</h2>
        {(!fields || fields.length === 0) ? (
          <p className="text-gray-500 text-sm">No custom fields defined.</p>
        ) : (
          <ul className="divide-y divide-gray-200">
            {fields.map((field, idx) => (
              <li key={field.id} className="py-4">
                <div className="flex flex-wrap items-center gap-3 mb-2">
                  <span className="text-sm font-medium text-gray-900">{field.name}</span>
                  <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-600">
                    {field.field_type}
                  </span>
                  {field.is_required && (
                    <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-600">
                      Required
                    </span>
                  )}
                  {field.default_value && (
                    <span className="text-xs text-gray-500">Default: {field.default_value}</span>
                  )}
                  {field.field_type === 'dropdown' && field.options && (
                    <span className="text-xs text-gray-500">
                      Options: {(field.options as string[]).join(', ')}
                    </span>
                  )}

                  {/* Reorder */}
                  <div className="flex gap-1">
                    <form action={reorderCustomField}>
                      <input type="hidden" name="field_id" value={field.id} />
                      <input type="hidden" name="direction" value="up" />
                      <button
                        type="submit"
                        disabled={idx === 0}
                        className="px-2 py-1 text-xs bg-gray-100 rounded hover:bg-gray-200 disabled:opacity-30"
                        aria-label={`Move ${field.name} up`}
                      >
                        ↑
                      </button>
                    </form>
                    <form action={reorderCustomField}>
                      <input type="hidden" name="field_id" value={field.id} />
                      <input type="hidden" name="direction" value="down" />
                      <button
                        type="submit"
                        disabled={idx === fields.length - 1}
                        className="px-2 py-1 text-xs bg-gray-100 rounded hover:bg-gray-200 disabled:opacity-30"
                        aria-label={`Move ${field.name} down`}
                      >
                        ↓
                      </button>
                    </form>
                  </div>

                  {/* Delete */}
                  <form action={deleteCustomField}>
                    <input type="hidden" name="field_id" value={field.id} />
                    <button
                      type="submit"
                      className="px-2 py-1 text-xs bg-red-100 text-red-700 rounded hover:bg-red-200"
                      aria-label={`Delete ${field.name}`}
                    >
                      Delete
                    </button>
                  </form>
                </div>

                {/* Edit form */}
                <details className="mt-2">
                  <summary className="text-xs text-blue-600 cursor-pointer hover:text-blue-800">Edit</summary>
                  <form action={updateCustomField} className="mt-2 space-y-3 bg-gray-50 rounded p-3">
                    <input type="hidden" name="field_id" value={field.id} />
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div>
                        <label className="block text-xs font-medium text-gray-500 mb-1">Name</label>
                        <input
                          type="text"
                          name="name"
                          defaultValue={field.name}
                          maxLength={100}
                          required
                          className="w-full rounded border border-gray-300 px-2 py-1 text-sm"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-gray-500 mb-1">Type</label>
                        <select
                          name="field_type"
                          defaultValue={field.field_type}
                          className="w-full rounded border border-gray-300 px-2 py-1 text-sm"
                        >
                          <option value="text">Text</option>
                          <option value="number">Number</option>
                          <option value="dropdown">Dropdown</option>
                          <option value="checkbox">Checkbox</option>
                          <option value="date">Date</option>
                        </select>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        name="is_required"
                        id={`edit-required-${field.id}`}
                        defaultChecked={field.is_required}
                        className="h-4 w-4 rounded border-gray-300"
                      />
                      <label htmlFor={`edit-required-${field.id}`} className="text-sm text-gray-700">Required</label>
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-500 mb-1">Default Value</label>
                      <input
                        type="text"
                        name="default_value"
                        defaultValue={field.default_value ?? ''}
                        className="w-full rounded border border-gray-300 px-2 py-1 text-sm"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-500 mb-1">Options (one per line, for dropdown)</label>
                      <textarea
                        name="options"
                        rows={3}
                        defaultValue={field.field_type === 'dropdown' && field.options ? (field.options as string[]).join('\n') : ''}
                        className="w-full rounded border border-gray-300 px-2 py-1 text-sm"
                      />
                    </div>
                    <button
                      type="submit"
                      className="px-4 py-1.5 text-sm bg-blue-600 text-white rounded hover:bg-blue-700 font-medium"
                    >
                      Save Changes
                    </button>
                  </form>
                </details>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Add new field */}
      <div className="bg-white rounded-lg border border-gray-200 p-6">
        <h2 className="text-sm font-semibold text-gray-700 mb-3 uppercase tracking-wider">Add New Custom Field</h2>
        <form action={createCustomField} className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label htmlFor="new-field-name" className="block text-xs font-medium text-gray-500 mb-1">Name</label>
              <input
                id="new-field-name"
                type="text"
                name="name"
                maxLength={100}
                required
                className="w-full rounded border border-gray-300 px-3 py-1.5 text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none"
                placeholder="Field name…"
              />
            </div>
            <div>
              <label htmlFor="new-field-type" className="block text-xs font-medium text-gray-500 mb-1">Type</label>
              <select
                id="new-field-type"
                name="field_type"
                required
                className="w-full rounded border border-gray-300 px-3 py-1.5 text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none"
              >
                <option value="text">Text</option>
                <option value="number">Number</option>
                <option value="dropdown">Dropdown</option>
                <option value="checkbox">Checkbox</option>
                <option value="date">Date</option>
              </select>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              name="is_required"
              id="new-field-required"
              className="h-4 w-4 rounded border-gray-300"
            />
            <label htmlFor="new-field-required" className="text-sm text-gray-700">Required</label>
          </div>
          <div>
            <label htmlFor="new-field-default" className="block text-xs font-medium text-gray-500 mb-1">
              Default Value
            </label>
            <input
              id="new-field-default"
              type="text"
              name="default_value"
              className="w-full rounded border border-gray-300 px-3 py-1.5 text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none"
              placeholder="Optional default…"
            />
          </div>
          <div>
            <label htmlFor="new-field-options" className="block text-xs font-medium text-gray-500 mb-1">
              Options (one per line, for dropdown type)
            </label>
            <textarea
              id="new-field-options"
              name="options"
              rows={3}
              className="w-full rounded border border-gray-300 px-3 py-1.5 text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none"
              placeholder="Option 1&#10;Option 2&#10;Option 3"
            />
          </div>
          <button
            type="submit"
            className="px-4 py-1.5 text-sm bg-blue-600 text-white rounded hover:bg-blue-700 font-medium"
          >
            Add Field
          </button>
        </form>
      </div>
    </div>
  );
}
