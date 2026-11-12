'use client';

import { useState, type ReactNode } from 'react';
import { editPost } from '@/lib/actions/tickets';
import {
  MarkdownActionForm,
  type EditorViewMode,
} from './MarkdownActionForm';

export function EditablePost({
  postId,
  htmlBody,
  rawBody,
  canEdit,
  editorViewMode = 'both',
  editorMinHeightPx,
  editorMaxHeightPx,
  actions,
}: {
  postId: string;
  htmlBody: string;
  rawBody: string;
  canEdit: boolean;
  editorViewMode?: EditorViewMode;
  editorMinHeightPx?: number;
  editorMaxHeightPx?: number;
  /** Extra action controls rendered in the same row as the Edit button. */
  actions?: ReactNode;
}) {
  const [editing, setEditing] = useState(false);

  if (!canEdit) {
    return (
      <div>
        <div
          className="prose prose-sm max-w-none break-words [&_a]:break-all"
          dangerouslySetInnerHTML={{ __html: htmlBody }}
        />
        {actions && <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mt-3 text-xs text-gray-500">{actions}</div>}
      </div>
    );
  }

  if (editing) {
    return (
      <MarkdownActionForm
        action={editPost}
        hiddenFields={<input type="hidden" name="post_id" value={postId} />}
        defaultBody={rawBody}
        editorViewMode={editorViewMode}
        editorMinHeightPx={editorMinHeightPx}
        editorMaxHeightPx={editorMaxHeightPx}
        submitLabel="Save"
        pendingLabel="Saving…"
        onCancel={() => setEditing(false)}
      />
    );
  }

  return (
    <div>
      <div
        className="prose prose-sm max-w-none break-words [&_a]:break-all"
        dangerouslySetInnerHTML={{ __html: htmlBody }}
      />
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mt-3 text-xs text-gray-500">
        <button
          type="button"
          onClick={() => setEditing(true)}
          className="hover:text-gray-900"
          data-testid="edit-post-btn"
        >
          Edit
        </button>
        {actions}
      </div>
    </div>
  );
}
