'use client';

import { useActionState, type ReactNode } from 'react';
import type { TicketActionState } from '@/lib/actions/tickets';
import { MarkdownEditor } from '@/components/features/tickets/MarkdownEditor';
import { uploadInlineImageFromEditor } from '@/components/features/tickets/inlineImageUpload';

const initialState: TicketActionState = {};

export type EditorViewMode = 'both' | 'preview' | 'editor';

type ServerAction = (
  state: TicketActionState,
  formData: FormData,
) => TicketActionState | Promise<TicketActionState>;

export type MarkdownActionFormProps = {
  action: ServerAction;
  hiddenFields?: ReactNode;
  defaultBody?: string;
  placeholder?: string;
  compact?: boolean;
  editorViewMode?: EditorViewMode;
  editorMinHeightPx?: number;
  editorMaxHeightPx?: number;
  extraToolbarPlugins?: string[];
  submitLabel: string;
  pendingLabel: string;
  onCancel?: () => void;
  cancelTestId?: string;
  variant?: 'primary' | 'amber';
  formClassName?: string;
  errorClassName?: string;
};

const SUBMIT_CLASS: Record<NonNullable<MarkdownActionFormProps['variant']>, string> = {
  primary:
    'px-3 py-1 text-xs rounded bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50',
  amber:
    'px-3 py-1 text-xs rounded bg-amber-600 text-white hover:bg-amber-700 disabled:opacity-50',
};

export function MarkdownActionForm({
  action,
  hiddenFields,
  defaultBody,
  placeholder,
  compact = false,
  editorViewMode = 'both',
  editorMinHeightPx,
  editorMaxHeightPx,
  extraToolbarPlugins,
  submitLabel,
  pendingLabel,
  onCancel,
  cancelTestId,
  variant = 'primary',
  formClassName = 'space-y-2',
  errorClassName = 'p-2 rounded bg-red-50 border border-red-200 text-red-700 text-xs',
}: MarkdownActionFormProps) {
  const [state, formAction, pending] = useActionState(action, initialState);

  return (
    <form action={formAction} className={formClassName}>
      {hiddenFields}
      {state.error && (
        <div role="alert" className={errorClassName}>
          {state.error}
        </div>
      )}
      <MarkdownEditor
        name="body"
        required
        maxLength={50000}
        placeholder={placeholder}
        defaultValue={defaultBody}
        compact={compact}
        viewMode={editorViewMode}
        minHeightPx={editorMinHeightPx}
        maxHeightPx={editorMaxHeightPx}
        onImageUpload={uploadInlineImageFromEditor}
        extraToolbarPlugins={extraToolbarPlugins}
      />
      <div className="flex gap-2">
        <button
          type="submit"
          disabled={pending}
          className={SUBMIT_CLASS[variant]}
        >
          {pending ? pendingLabel : submitLabel}
        </button>
        {onCancel && (
          <button
            type="button"
            onClick={onCancel}
            data-testid={cancelTestId}
            className="px-3 py-1 text-xs rounded bg-gray-100 text-gray-700 hover:bg-gray-200"
          >
            Cancel
          </button>
        )}
      </div>
    </form>
  );
}
