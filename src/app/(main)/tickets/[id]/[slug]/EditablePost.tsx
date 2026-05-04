'use client';

import { useState } from 'react';
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
}: {
  postId: string;
  htmlBody: string;
  rawBody: string;
  canEdit: boolean;
  editorViewMode?: EditorViewMode;
}) {
  const [editing, setEditing] = useState(false);

  if (!canEdit) {
    return (
      <div
        className="prose prose-sm max-w-none"
        dangerouslySetInnerHTML={{ __html: htmlBody }}
      />
    );
  }

  if (editing) {
    return (
      <MarkdownActionForm
        action={editPost}
        hiddenFields={<input type="hidden" name="post_id" value={postId} />}
        defaultBody={rawBody}
        editorViewMode={editorViewMode}
        submitLabel="Save"
        pendingLabel="Saving…"
        onCancel={() => setEditing(false)}
      />
    );
  }

  return (
    <div>
      <div
        className="prose prose-sm max-w-none"
        dangerouslySetInnerHTML={{ __html: htmlBody }}
      />
      <button
        type="button"
        onClick={() => setEditing(true)}
        className="mt-2 text-xs text-blue-600 hover:text-blue-800"
        data-testid="edit-post-btn"
      >
        Edit
      </button>
    </div>
  );
}
