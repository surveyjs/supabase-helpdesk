'use client';

import { useActionState, useState } from 'react';
import {
  createCannedResponse,
  updateCannedResponse,
  deleteCannedResponse,
  type CannedResponseActionState,
} from '@/lib/actions/canned-responses';

type CannedResponse = {
  id: string;
  title: string;
  body: string;
  visibility: string;
  author_id: string;
  updated_at: string;
  author: { display_name: string | null } | null;
};

const initialState: CannedResponseActionState = {};

function CannedResponseForm({
  response,
  onCancel,
}: {
  response?: CannedResponse;
  onCancel?: () => void;
}) {
  const action = response ? updateCannedResponse : createCannedResponse;
  const [state, formAction, pending] = useActionState(action, initialState);

  return (
    <form action={formAction} className="space-y-4 bg-white border border-gray-200 rounded-lg p-4">
      {response && <input type="hidden" name="response_id" value={response.id} />}

      {state.error && (
        <div className="p-3 rounded bg-red-50 border border-red-200 text-red-700 text-sm" role="alert">
          {state.error}
        </div>
      )}

      <div>
        <label htmlFor="cr-title" className="block text-sm font-medium text-gray-700 mb-1">
          Title <span className="text-red-500">*</span>
        </label>
        <input
          id="cr-title"
          name="title"
          type="text"
          required
          maxLength={200}
          defaultValue={response?.title ?? ''}
          className="block w-full rounded border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none"
        />
        {state.fieldErrors?.title && (
          <p className="mt-1 text-sm text-red-600">{state.fieldErrors.title}</p>
        )}
      </div>

      <div>
        <label htmlFor="cr-body" className="block text-sm font-medium text-gray-700 mb-1">
          Body <span className="text-red-500">*</span>
        </label>
        <textarea
          id="cr-body"
          name="body"
          required
          rows={6}
          maxLength={50000}
          defaultValue={response?.body ?? ''}
          placeholder="Write the response body (Markdown supported)…"
          className="block w-full rounded border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none resize-y"
        />
        {state.fieldErrors?.body && (
          <p className="mt-1 text-sm text-red-600">{state.fieldErrors.body}</p>
        )}
      </div>

      <div>
        <label htmlFor="cr-visibility" className="block text-sm font-medium text-gray-700 mb-1">
          Visibility
        </label>
        <select
          id="cr-visibility"
          name="visibility"
          defaultValue={response?.visibility ?? 'private'}
          className="block w-full rounded border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none"
        >
          <option value="private">Private</option>
          <option value="public">Public</option>
        </select>
        {state.fieldErrors?.visibility && (
          <p className="mt-1 text-sm text-red-600">{state.fieldErrors.visibility}</p>
        )}
      </div>

      <div className="flex gap-2">
        <button
          type="submit"
          disabled={pending}
          className="bg-blue-600 text-white rounded px-4 py-2 text-sm font-medium hover:bg-blue-700 disabled:opacity-50"
        >
          {pending ? 'Saving…' : response ? 'Update' : 'Create'}
        </button>
        {onCancel && (
          <button
            type="button"
            onClick={onCancel}
            className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800 border border-gray-300 rounded"
          >
            Cancel
          </button>
        )}
      </div>
    </form>
  );
}

export function CannedResponseList({
  responses,
  currentUserId,
  isAdmin,
}: {
  responses: CannedResponse[];
  currentUserId: string;
  isAdmin: boolean;
}) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        {!showCreate && (
          <button
            onClick={() => { setShowCreate(true); setEditingId(null); }}
            className="bg-blue-600 text-white rounded px-4 py-2 text-sm font-medium hover:bg-blue-700"
            data-testid="new-response-btn"
          >
            New Response
          </button>
        )}
      </div>

      {showCreate && (
        <CannedResponseForm onCancel={() => setShowCreate(false)} />
      )}

      {responses.length === 0 && !showCreate && (
        <p className="text-sm text-gray-500 text-center py-8">No canned responses found.</p>
      )}

      {responses.map((r) => {
        const canEdit = r.author_id === currentUserId || (isAdmin && r.visibility === 'public');
        const canDelete = r.author_id === currentUserId || (isAdmin && r.visibility === 'public');

        if (editingId === r.id) {
          return (
            <CannedResponseForm
              key={r.id}
              response={r}
              onCancel={() => setEditingId(null)}
            />
          );
        }

        return (
          <div key={r.id} className="bg-white border border-gray-200 rounded-lg p-4" data-testid={`canned-response-${r.id}`}>
            <div className="flex items-start justify-between mb-2">
              <div>
                <h3 className="text-sm font-medium text-gray-900">{r.title}</h3>
                <div className="flex items-center gap-2 mt-1">
                  <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
                    r.visibility === 'public'
                      ? 'bg-green-100 text-green-700'
                      : 'bg-gray-100 text-gray-600'
                  }`}>
                    {r.visibility === 'public' ? 'Public' : 'Private'}
                  </span>
                  <span className="text-xs text-gray-500">
                    by {r.author?.display_name ?? 'Unknown'}
                  </span>
                  <span className="text-xs text-gray-400">
                    {new Date(r.updated_at).toLocaleDateString()}
                  </span>
                </div>
              </div>
              <div className="flex gap-2">
                {canEdit && (
                  <button
                    onClick={() => { setEditingId(r.id); setShowCreate(false); }}
                    className="text-xs text-blue-600 hover:text-blue-800"
                    data-testid="edit-response-btn"
                  >
                    Edit
                  </button>
                )}
                {canDelete && (
                  <form action={deleteCannedResponse} className="inline">
                    <input type="hidden" name="response_id" value={r.id} />
                    <button
                      type="submit"
                      className="text-xs text-red-600 hover:text-red-800"
                      data-testid="delete-response-btn"
                    >
                      Delete
                    </button>
                  </form>
                )}
              </div>
            </div>
            <p className="text-sm text-gray-600 whitespace-pre-wrap line-clamp-3">{r.body}</p>
          </div>
        );
      })}
    </div>
  );
}
