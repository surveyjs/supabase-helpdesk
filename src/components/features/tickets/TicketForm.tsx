'use client';

import { useActionState } from 'react';
import { createTicket, type TicketActionState } from '@/lib/actions/tickets';

const initialState: TicketActionState = {};

type TicketType = { id: string; name: string; is_default: boolean };
type Category = { id: string; name: string };

export function TicketForm({
  ticketTypes,
  categories,
  defaultPrivate,
  showPrivacyControl,
}: {
  ticketTypes: TicketType[];
  categories: Category[];
  defaultPrivate: boolean;
  showPrivacyControl: boolean;
}) {
  const [state, formAction, pending] = useActionState(createTicket, initialState);

  const defaultType = ticketTypes.find((t) => t.is_default)?.id ?? ticketTypes[0]?.id;

  return (
    <form action={formAction} className="space-y-6">
      {state.error && (
        <div
          role="alert"
          className="p-3 rounded bg-red-50 border border-red-200 text-red-700 text-sm"
        >
          {state.error}
        </div>
      )}

      <div>
        <label htmlFor="title" className="block text-sm font-medium text-gray-700 mb-1">
          Title <span className="text-red-500">*</span>
        </label>
        <input
          id="title"
          name="title"
          type="text"
          required
          maxLength={300}
          className="block w-full rounded border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none"
        />
        {state.fieldErrors?.title && (
          <p className="mt-1 text-sm text-red-600">{state.fieldErrors.title}</p>
        )}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <label htmlFor="type_id" className="block text-sm font-medium text-gray-700 mb-1">
            Type
          </label>
          <select
            id="type_id"
            name="type_id"
            defaultValue={defaultType}
            className="block w-full rounded border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none"
          >
            {ticketTypes.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
          {state.fieldErrors?.type_id && (
            <p className="mt-1 text-sm text-red-600">{state.fieldErrors.type_id}</p>
          )}
        </div>

        <div>
          <label htmlFor="urgency" className="block text-sm font-medium text-gray-700 mb-1">
            Urgency
          </label>
          <select
            id="urgency"
            name="urgency"
            defaultValue="medium"
            className="block w-full rounded border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none"
          >
            <option value="low">Low</option>
            <option value="medium">Medium</option>
            <option value="high">High</option>
            <option value="critical">Critical</option>
          </select>
          {state.fieldErrors?.urgency && (
            <p className="mt-1 text-sm text-red-600">{state.fieldErrors.urgency}</p>
          )}
        </div>
      </div>

      {categories.length > 0 && (
        <div>
          <label htmlFor="category_id" className="block text-sm font-medium text-gray-700 mb-1">
            Category
          </label>
          <select
            id="category_id"
            name="category_id"
            defaultValue=""
            className="block w-full rounded border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none"
          >
            <option value="">None</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </div>
      )}

      <div>
        <label htmlFor="body" className="block text-sm font-medium text-gray-700 mb-1">
          Description <span className="text-red-500">*</span>
        </label>
        <textarea
          id="body"
          name="body"
          required
          rows={8}
          maxLength={50000}
          className="block w-full rounded border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none resize-y"
          placeholder="Describe your issue in detail (Markdown supported)"
        />
        {state.fieldErrors?.body && (
          <p className="mt-1 text-sm text-red-600">{state.fieldErrors.body}</p>
        )}
      </div>

      {showPrivacyControl && (
        <div className="flex items-center gap-2">
          <input
            id="is_private"
            name="is_private"
            type="checkbox"
            defaultChecked={defaultPrivate}
            className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
          />
          <label htmlFor="is_private" className="text-sm text-gray-700">
            Private ticket (only visible to you, your teammates, and agents)
          </label>
        </div>
      )}

      <button
        type="submit"
        disabled={pending}
        className="w-full bg-blue-600 text-white rounded py-2 px-4 text-sm font-medium hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:opacity-50"
      >
        {pending ? 'Creating…' : 'Create Ticket'}
      </button>
    </form>
  );
}
