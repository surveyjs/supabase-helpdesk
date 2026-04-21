'use client';

import { useActionState } from 'react';
import { updateEditorViewMode, type ProfileActionState } from '@/lib/actions/profile';

const initialState: ProfileActionState = {};

export function EditorPreferenceForm({
  currentMode,
}: {
  currentMode: 'both' | 'preview' | 'editor';
}) {
  const [state, formAction, pending] = useActionState(updateEditorViewMode, initialState);

  return (
    <form action={formAction} className="space-y-3">
      <div>
        <label htmlFor="editor_view_mode" className="block text-sm font-medium text-gray-700 mb-1">
          Default markdown editor layout
        </label>
        <select
          id="editor_view_mode"
          name="editor_view_mode"
          defaultValue={currentMode}
          className="w-full rounded border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none"
        >
          <option value="both">Editor + Preview</option>
          <option value="editor">Editor only</option>
          <option value="preview">Preview only</option>
        </select>
      </div>

      {state.error && (
        <div className="p-2 rounded bg-red-50 border border-red-200 text-red-700 text-sm">
          {state.error}
        </div>
      )}
      {state.success && (
        <div className="p-2 rounded bg-green-50 border border-green-200 text-green-700 text-sm">
          {state.success}
        </div>
      )}

      <button
        type="submit"
        disabled={pending}
        className="px-4 py-2 bg-blue-600 text-white text-sm rounded hover:bg-blue-700 disabled:opacity-50"
      >
        {pending ? 'Saving…' : 'Save Preference'}
      </button>
    </form>
  );
}
