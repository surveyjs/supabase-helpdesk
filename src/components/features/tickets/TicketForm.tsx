'use client';

import { useActionState, useState, useEffect, useRef } from 'react';
import { createTicket, type TicketActionState } from '@/lib/actions/tickets';
import { getSuggestedArticles } from '@/lib/actions/kb';
import { generateSlug } from '@/lib/utils/slug';

const initialState: TicketActionState = {};

type TicketType = { id: string; name: string; is_default: boolean };
type Category = { id: string; name: string };
type CustomField = {
  id: string;
  name: string;
  field_type: string;
  is_required: boolean;
  default_value: string | null;
  options: string[] | null;
};
type SuggestedArticle = {
  id: number;
  title: string;
  slug: string;
  category: { id: string; name: string } | null;
};

export function TicketForm({
  ticketTypes,
  categories,
  customFields,
  defaultPrivate,
  showPrivacyControl,
  initialTitle,
  sourceArticleId,
}: {
  ticketTypes: TicketType[];
  categories: Category[];
  customFields?: CustomField[];
  defaultPrivate: boolean;
  showPrivacyControl: boolean;
  initialTitle?: string | null;
  sourceArticleId?: number | null;
}) {
  const [state, formAction, pending] = useActionState(createTicket, initialState);
  const [suggestions, setSuggestions] = useState<SuggestedArticle[]>([]);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const defaultType = ticketTypes.find((t) => t.is_default)?.id ?? ticketTypes[0]?.id;

  function handleTitleChange(value: string) {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (value.trim().length < 3) {
      setSuggestions([]);
      return;
    }
    debounceRef.current = setTimeout(async () => {
      const results = await getSuggestedArticles(value);
      setSuggestions(results);
    }, 400);
  }

  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);

  return (
    <form action={formAction} className="space-y-6">
      {sourceArticleId && (
        <input type="hidden" name="source_article_id" value={sourceArticleId} />
      )}

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
          defaultValue={initialTitle ?? ''}
          onChange={(e) => handleTitleChange(e.target.value)}
          className="block w-full rounded border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none"
        />
        {state.fieldErrors?.title && (
          <p className="mt-1 text-sm text-red-600">{state.fieldErrors.title}</p>
        )}
        {/* Suggested KB articles */}
        {suggestions.length > 0 && (
          <div className="mt-2 bg-blue-50 border border-blue-200 rounded p-3">
            <p className="text-xs text-blue-700 font-medium mb-1">Related articles that might help:</p>
            <ul className="space-y-1">
              {suggestions.map((a) => {
                const catSlug = a.category ? generateSlug(a.category.name) : 'uncategorized';
                return (
                  <li key={a.id}>
                    <a
                      href={`/help/${a.id}/${catSlug}/${a.slug}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-sm text-blue-600 hover:text-blue-800"
                    >
                      {a.title}
                      {a.category && <span className="text-xs text-blue-500 ml-1">({a.category.name})</span>}
                    </a>
                  </li>
                );
              })}
            </ul>
          </div>
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

      {/* Custom fields */}
      {customFields && customFields.length > 0 && (
        <div className="space-y-4 border-t border-gray-200 pt-4">
          <h3 className="text-sm font-medium text-gray-700">Additional Fields</h3>
          {customFields.map((field) => (
            <div key={field.id}>
              <label htmlFor={`cf-${field.name}`} className="block text-sm font-medium text-gray-700 mb-1">
                {field.name}
                {field.is_required && <span className="text-red-500"> *</span>}
              </label>
              {field.field_type === 'text' && (
                <input
                  id={`cf-${field.name}`}
                  type="text"
                  name={`cf_${field.name}`}
                  defaultValue={field.default_value ?? ''}
                  maxLength={1000}
                  required={field.is_required}
                  className="block w-full rounded border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none"
                />
              )}
              {field.field_type === 'number' && (
                <input
                  id={`cf-${field.name}`}
                  type="number"
                  name={`cf_${field.name}`}
                  defaultValue={field.default_value ?? ''}
                  required={field.is_required}
                  className="block w-full rounded border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none"
                />
              )}
              {field.field_type === 'dropdown' && (
                <select
                  id={`cf-${field.name}`}
                  name={`cf_${field.name}`}
                  defaultValue={field.default_value ?? ''}
                  required={field.is_required}
                  className="block w-full rounded border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none"
                >
                  <option value="">Select…</option>
                  {field.options?.map((opt) => (
                    <option key={opt} value={opt}>{opt}</option>
                  ))}
                </select>
              )}
              {field.field_type === 'checkbox' && (
                <input
                  id={`cf-${field.name}`}
                  type="checkbox"
                  name={`cf_${field.name}`}
                  defaultChecked={field.default_value === 'true'}
                  className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                />
              )}
              {field.field_type === 'date' && (
                <input
                  id={`cf-${field.name}`}
                  type="date"
                  name={`cf_${field.name}`}
                  defaultValue={field.default_value ?? ''}
                  required={field.is_required}
                  className="block w-full rounded border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none"
                />
              )}
              {state.fieldErrors?.[`cf_${field.name}`] && (
                <p className="mt-1 text-sm text-red-600">{state.fieldErrors[`cf_${field.name}`]}</p>
              )}
            </div>
          ))}
        </div>
      )}

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
