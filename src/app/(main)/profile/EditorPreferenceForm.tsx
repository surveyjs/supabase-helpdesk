'use client';

import { useActionState, useState } from 'react';
import { updateEditorViewMode, type ProfileActionState } from '@/lib/actions/profile';

const initialState: ProfileActionState = {};

const MIN_BOUND = 120;
const MIN_UPPER = 1000;
const MAX_LOWER = 200;
const MAX_BOUND = 2000;

export function EditorPreferenceForm({
  currentMode,
  currentMinHeightPx,
  currentMaxHeightPx,
}: {
  currentMode: 'both' | 'preview' | 'editor';
  currentMinHeightPx: number;
  currentMaxHeightPx: number;
}) {
  const [state, formAction, pending] = useActionState(updateEditorViewMode, initialState);
  const [minHeight, setMinHeight] = useState<number>(currentMinHeightPx);
  const [maxHeight, setMaxHeight] = useState<number>(currentMaxHeightPx);

  const clientError =
    minHeight > maxHeight
      ? 'Initial height must be less than or equal to maximum height.'
      : null;

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

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <label htmlFor="editor_min_height_px" className="block text-sm font-medium text-gray-700 mb-1">
            Initial height (px)
          </label>
          <input
            type="number"
            id="editor_min_height_px"
            name="editor_min_height_px"
            min={MIN_BOUND}
            max={MIN_UPPER}
            step={10}
            value={minHeight}
            onChange={(e) => setMinHeight(Number.parseInt(e.target.value, 10) || 0)}
            className="w-full rounded border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none"
            data-testid="editor-min-height-input"
          />
        </div>
        <div>
          <label htmlFor="editor_max_height_px" className="block text-sm font-medium text-gray-700 mb-1">
            Maximum height (px)
          </label>
          <input
            type="number"
            id="editor_max_height_px"
            name="editor_max_height_px"
            min={MAX_LOWER}
            max={MAX_BOUND}
            step={10}
            value={maxHeight}
            onChange={(e) => setMaxHeight(Number.parseInt(e.target.value, 10) || 0)}
            className="w-full rounded border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none"
            data-testid="editor-max-height-input"
          />
        </div>
      </div>
      <p className="text-xs text-gray-500">
        The markdown editor opens at the initial height and grows as you type, up to the maximum height.
      </p>

      {clientError && (
        <div className="p-2 rounded bg-red-50 border border-red-200 text-red-700 text-sm" role="alert">
          {clientError}
        </div>
      )}
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
        disabled={pending || !!clientError}
        className="px-4 py-2 bg-blue-600 text-white text-sm rounded hover:bg-blue-700 disabled:opacity-50"
      >
        {pending ? 'Saving…' : 'Save Preference'}
      </button>
    </form>
  );
}
