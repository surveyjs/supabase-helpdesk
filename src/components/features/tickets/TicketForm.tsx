'use client';

import { useActionState, useState, useEffect, useRef } from 'react';
import { createTicket, type TicketActionState } from '@/lib/actions/tickets';
import { getSuggestedArticles } from '@/lib/actions/kb';
import { autoCategorizeTicket, detectDuplicateTickets, type AutoCategorizeResult, type DuplicateTicket } from '@/lib/actions/ai';
import { generateSlug } from '@/lib/utils/slug';
import { MarkdownEditor } from '@/components/features/tickets/MarkdownEditor';
import { uploadInlineImageFromEditor } from '@/components/features/tickets/inlineImageUpload';
import { uploadInlineAttachmentFromEditor } from '@/components/features/tickets/inlineAttachmentUpload';
import Link from 'next/link';

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
  editorViewMode = 'both',
  editorMinHeightPx,
  editorMaxHeightPx,
  initialTitle,
  sourceArticleId,
  aiAutoCategEnabled,
  aiDuplicateEnabled,
}: {
  ticketTypes: TicketType[];
  categories: Category[];
  customFields?: CustomField[];
  defaultPrivate: boolean;
  showPrivacyControl: boolean;
  editorViewMode?: 'both' | 'preview' | 'editor';
  editorMinHeightPx?: number;
  editorMaxHeightPx?: number;
  initialTitle?: string | null;
  sourceArticleId?: number | null;
  aiAutoCategEnabled?: boolean;
  aiDuplicateEnabled?: boolean;
}) {
  const [state, formAction, pending] = useActionState(createTicket, initialState);
  const [suggestions, setSuggestions] = useState<SuggestedArticle[]>([]);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latestQueryRef = useRef<string>('');

  // AI auto-categorization state
  const [aiSuggestions, setAiSuggestions] = useState<AutoCategorizeResult>({});
  const [aiCategorizePending, setAiCategorizePending] = useState(false);
  const [aiCategorized, setAiCategorized] = useState(false);
  const [userModifiedFields, setUserModifiedFields] = useState<Set<string>>(new Set());

  // AI duplicate detection state
  const [duplicateTickets, setDuplicateTickets] = useState<DuplicateTicket[]>([]);
  const dupDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latestDupQueryRef = useRef<string>('');

  const defaultType = ticketTypes.find((t) => t.is_default)?.id ?? ticketTypes[0]?.id;

  function handleTitleChange(value: string) {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (value.trim().length < 3) {
      setSuggestions([]);
      latestQueryRef.current = '';
      return;
    }
    const query = value.trim();
    latestQueryRef.current = query;
    debounceRef.current = setTimeout(async () => {
      try {
        const results = await getSuggestedArticles(query);
        if (latestQueryRef.current === query) {
          setSuggestions(results);
        }
      } catch {
        // Ignore errors from stale requests
      }
    }, 400);

    // AI duplicate detection (debounced)
    if (aiDuplicateEnabled) {
      if (dupDebounceRef.current) clearTimeout(dupDebounceRef.current);
      if (value.trim().length < 5) {
        setDuplicateTickets([]);
        latestDupQueryRef.current = '';
        return;
      }
      const dupQuery = value.trim();
      latestDupQueryRef.current = dupQuery;
      dupDebounceRef.current = setTimeout(async () => {
        try {
          const fd = new FormData();
          fd.set('title', dupQuery);
          const results = await detectDuplicateTickets(fd);
          if (latestDupQueryRef.current === dupQuery) {
            setDuplicateTickets(results);
          }
        } catch {
          // Silently ignore
        }
      }, 600);
    }
  }

  // AI auto-categorization on body change (debounced, replaces onBlur)
  const bodyRef = useRef('');
  const bodyCategDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  function handleBodyChange(text: string) {
    bodyRef.current = text;
    // Debounce auto-categorization (triggers ~1s after last edit, like blur used to)
    if (!aiAutoCategEnabled || aiCategorized) return;
    if (bodyCategDebounceRef.current) clearTimeout(bodyCategDebounceRef.current);
    bodyCategDebounceRef.current = setTimeout(async () => {
      const body = bodyRef.current.trim();
      const titleEl = document.getElementById('title') as HTMLInputElement | null;
      const title = titleEl?.value.trim() ?? '';
      if (!title || !body) return;

      setAiCategorizePending(true);
      try {
        const fd = new FormData();
        fd.set('title', title);
        fd.set('body', body);
        const result = await autoCategorizeTicket(fd);
        applyAiSuggestions(result);
      } catch {
        // Silently ignore
      } finally {
        setAiCategorizePending(false);
      }
    }, 1500);
  }

  function applyAiSuggestions(result: AutoCategorizeResult) {
    setAiSuggestions(result);

    const hasSuggestions = !!(result.suggestedTypeId || result.suggestedUrgency || result.suggestedCategoryId);
    setAiCategorized(hasSuggestions);

    // Pre-fill only unmodified fields
    if (result.suggestedTypeId && !userModifiedFields.has('type_id')) {
      const typeEl = document.getElementById('type_id') as HTMLSelectElement | null;
      if (typeEl) typeEl.value = result.suggestedTypeId;
    }
    if (result.suggestedUrgency && !userModifiedFields.has('urgency')) {
      const urgEl = document.getElementById('urgency') as HTMLSelectElement | null;
      if (urgEl) urgEl.value = result.suggestedUrgency;
    }
    if (result.suggestedCategoryId && !userModifiedFields.has('category_id')) {
      const catEl = document.getElementById('category_id') as HTMLSelectElement | null;
      if (catEl) catEl.value = result.suggestedCategoryId;
    }
  }

  async function handleReSuggest() {
    const titleEl = document.getElementById('title') as HTMLInputElement | null;
    const title = titleEl?.value.trim() ?? '';
    const body = bodyRef.current.trim();
    if (!title || !body) return;

    setAiCategorizePending(true);
    try {
      const fd = new FormData();
      fd.set('title', title);
      fd.set('body', body);
      const result = await autoCategorizeTicket(fd);
      // Reset user modifications to allow re-suggestion
      setUserModifiedFields(new Set());
      applyAiSuggestions(result);
    } catch {
      // Silently ignore
    } finally {
      setAiCategorizePending(false);
    }
  }

  function markFieldModified(fieldName: string) {
    setUserModifiedFields((prev) => new Set(prev).add(fieldName));
  }

  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      if (dupDebounceRef.current) clearTimeout(dupDebounceRef.current);
      if (bodyCategDebounceRef.current) clearTimeout(bodyCategDebounceRef.current);
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
        {/* AI: Similar open tickets */}
        {duplicateTickets.length > 0 && (
          <div className="mt-2 bg-yellow-50 border border-yellow-200 rounded p-3" data-testid="similar-tickets">
            <p className="text-xs text-yellow-700 font-medium mb-1">Similar open tickets:</p>
            <ul className="space-y-1">
              {duplicateTickets.map((t) => (
                <li key={t.id} className="flex items-center gap-2">
                  <Link
                    href={`/tickets/${t.id}/redirect`}
                    target="_blank"
                    className="text-sm text-yellow-700 hover:text-yellow-900"
                  >
                    #{t.id}: {t.title}
                  </Link>
                  <span className="text-xs bg-yellow-100 text-yellow-600 px-1.5 py-0.5 rounded">{t.status}</span>
                  <span className="text-xs text-yellow-500">{new Date(t.created_at).toLocaleDateString()}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <label htmlFor="type_id" className="block text-sm font-medium text-gray-700 mb-1">
            Type
            {aiSuggestions.suggestedTypeId && !userModifiedFields.has('type_id') && (
              <span className="ml-2 text-xs text-purple-600" data-testid="ai-suggested-type">AI suggested</span>
            )}
          </label>
          <select
            id="type_id"
            name="type_id"
            defaultValue={defaultType}
            onChange={() => markFieldModified('type_id')}
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
            {aiSuggestions.suggestedUrgency && !userModifiedFields.has('urgency') && (
              <span className="ml-2 text-xs text-purple-600" data-testid="ai-suggested-urgency">AI suggested</span>
            )}
          </label>
          <select
            id="urgency"
            name="urgency"
            defaultValue="medium"
            onChange={() => markFieldModified('urgency')}
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
            {aiSuggestions.suggestedCategoryId && !userModifiedFields.has('category_id') && (
              <span className="ml-2 text-xs text-purple-600" data-testid="ai-suggested-category">AI suggested</span>
            )}
          </label>
          <select
            id="category_id"
            name="category_id"
            defaultValue=""
            onChange={() => markFieldModified('category_id')}
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
        <label htmlFor="body_md" className="block text-sm font-medium text-gray-700 mb-1">
          Description <span className="text-red-500">*</span>
        </label>
        <MarkdownEditor
          id="body"
          name="body"
          required
          maxLength={50000}
          placeholder="Describe your issue in detail (Markdown supported)"
          onValueChange={handleBodyChange}
          viewMode={editorViewMode}
          minHeightPx={editorMinHeightPx}
          maxHeightPx={editorMaxHeightPx}
          onImageUpload={uploadInlineImageFromEditor}
          onAttachmentUpload={uploadInlineAttachmentFromEditor}
        />
        {state.fieldErrors?.body && (
          <p className="mt-1 text-sm text-red-600">{state.fieldErrors.body}</p>
        )}
        {/* AI auto-categorization status */}
        {aiCategorizePending && (
          <p className="mt-1 text-xs text-purple-500" data-testid="ai-categorize-pending">Analyzing ticket…</p>
        )}
        {aiCategorized && !aiCategorizePending && (
          <div className="mt-1 flex items-center gap-2">
            <span className="text-xs text-purple-600">AI suggestions applied</span>
            <button
              type="button"
              onClick={handleReSuggest}
              className="text-xs text-purple-600 hover:text-purple-800 underline"
              data-testid="re-suggest-btn"
            >
              Re-suggest
            </button>
          </div>
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
