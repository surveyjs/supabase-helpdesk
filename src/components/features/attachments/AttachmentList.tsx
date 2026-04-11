import { createServerClient } from '@/lib/supabase/server';
import { deleteAttachment } from '@/lib/actions/attachments';

const IMAGE_EXTENSIONS = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg'];

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function getExtension(filename: string): string {
  const parts = filename.split('.');
  return parts.length > 1 ? parts[parts.length - 1].toLowerCase() : '';
}

export async function AttachmentList({
  postId,
  canDelete,
}: {
  postId: string;
  canDelete: boolean;
}) {
  const supabase = await createServerClient();

  const { data: attachments } = await supabase
    .from('attachments')
    .select('id, storage_path, original_filename, file_size, mime_type, created_at')
    .eq('post_id', postId)
    .order('created_at', { ascending: true });

  if (!attachments || attachments.length === 0) return null;

  // Generate signed URLs in a single batch call
  const paths = attachments.map((att) => att.storage_path);
  const { data: signedUrlData } = await supabase.storage
    .from('attachments')
    .createSignedUrls(paths, 3600);

  const signedUrlMap = new Map<string, string>();
  if (signedUrlData) {
    for (const entry of signedUrlData) {
      if (entry.signedUrl && entry.path) {
        signedUrlMap.set(entry.path, entry.signedUrl);
      }
    }
  }

  const attachmentsWithUrls = attachments.map((att) => ({
    ...att,
    signedUrl: signedUrlMap.get(att.storage_path) ?? null,
  }));

  return (
    <div className="mt-3 space-y-2" data-testid="attachment-list">
      {attachmentsWithUrls.map((att) => {
        const ext = getExtension(att.original_filename);
        const isImage = IMAGE_EXTENSIONS.includes(ext);

        return (
          <div
            key={att.id}
            className="flex items-center gap-3 text-sm bg-gray-50 rounded px-3 py-2 border border-gray-200"
            data-testid={`attachment-${att.id}`}
          >
            {isImage && att.signedUrl ? (
              <a href={att.signedUrl} target="_blank" rel="noopener noreferrer">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={att.signedUrl}
                  alt={att.original_filename}
                  className="max-w-[200px] max-h-[200px] object-contain rounded"
                  data-testid="attachment-thumbnail"
                />
              </a>
            ) : (
              <span className="text-gray-400 text-lg">📎</span>
            )}

            <div className="flex-1 min-w-0">
              {att.signedUrl ? (
                <a
                  href={att.signedUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-blue-600 hover:text-blue-800 text-xs font-medium truncate block"
                  data-testid="attachment-download"
                >
                  {att.original_filename}
                </a>
              ) : (
                <span className="text-gray-700 text-xs font-medium truncate block">
                  {att.original_filename}
                </span>
              )}
              <span className="text-xs text-gray-400">{formatSize(att.file_size)}</span>
            </div>

            {canDelete && (
              <form action={deleteAttachment} className="shrink-0">
                <input type="hidden" name="attachment_id" value={att.id} />
                <button
                  type="submit"
                  className="text-xs text-red-600 hover:text-red-800"
                  data-testid="delete-attachment-btn"
                >
                  Delete
                </button>
              </form>
            )}
          </div>
        );
      })}
    </div>
  );
}
