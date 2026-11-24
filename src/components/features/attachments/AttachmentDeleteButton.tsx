'use client';

import { createContext, useContext } from 'react';
import { deleteAttachment } from '@/lib/actions/attachments';

/**
 * Whether the post that owns the attachment list is in edit mode. Provided by
 * EditablePost; the attachment Delete buttons are enabled only while it is
 * true, so a stray click on a post being read can't remove a file (#118).
 */
export const PostEditingContext = createContext(false);

export function AttachmentDeleteButton({
  attachmentId,
  filename,
  className,
  formClassName,
}: {
  attachmentId: string;
  filename: string;
  className: string;
  formClassName: string;
}) {
  const editing = useContext(PostEditingContext);
  return (
    <form action={deleteAttachment} className={formClassName}>
      <input type="hidden" name="attachment_id" value={attachmentId} />
      <button
        type="submit"
        disabled={!editing}
        title={editing ? undefined : 'Click Edit on the post to delete attachments'}
        className={`${className} text-red-600 hover:text-red-800 disabled:cursor-not-allowed disabled:text-gray-400 disabled:hover:text-gray-400`}
        data-testid="delete-attachment-btn"
        aria-label={`Delete ${filename}`}
      >
        Delete
      </button>
    </form>
  );
}
