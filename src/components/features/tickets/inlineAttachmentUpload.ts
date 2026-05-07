'use client';

import { uploadInlineAttachment } from '@/lib/actions/attachments';

export interface InlineAttachmentUploaded {
  url: string;
  name: string;
  mimeType: string;
  isImage: boolean;
}

/**
 * MarkdownEditor `onAttachmentUpload` handler. Uploads any allowed file type
 * via the `uploadInlineAttachment` server action. The returned URL is a
 * stable `/attachments/<id>` route that survives signed-URL expiry; the
 * post-create / edit Server Actions later call `claimInlineAttachments`
 * which re-parents the orphan row onto the new post by scanning the body
 * for `/attachments/<uuid>` substrings.
 */
export async function uploadInlineAttachmentFromEditor(
  file: File,
): Promise<InlineAttachmentUploaded> {
  const fd = new FormData();
  fd.append('file', file);
  const result = await uploadInlineAttachment(fd);
  if (result.error || !result.url) {
    throw new Error(result.error ?? 'Upload failed.');
  }
  return {
    url: result.url,
    name: result.name,
    mimeType: result.mimeType,
    isImage: result.isImage,
  };
}
