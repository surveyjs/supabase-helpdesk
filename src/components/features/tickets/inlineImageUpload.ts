'use client';

import { uploadInlineImage } from '@/lib/actions/attachments';

/**
 * MarkdownEditor `onImageUpload` handler. Uploads the file via the
 * `uploadInlineImage` server action and returns the signed URL (with the
 * attachment id embedded as `&att=<uuid>`). When the parent post is later
 * saved, `claimInlineAttachments(postId, body)` re-parents the orphan row
 * onto the new post.
 */
export async function uploadInlineImageFromEditor(file: File): Promise<string> {
  const fd = new FormData();
  fd.append('file', file);
  const result = await uploadInlineImage(fd);
  if (result.error || !result.url) {
    throw new Error(result.error ?? 'Upload failed.');
  }
  return result.url;
}
