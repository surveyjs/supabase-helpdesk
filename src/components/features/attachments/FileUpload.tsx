'use client';

import { useActionState, useRef, useState } from 'react';
import { uploadAttachments, type AttachmentActionState } from '@/lib/actions/attachments';

const initialState: AttachmentActionState = {};

export function FileUpload({
  postId,
  allowedTypes,
  maxFileSizeMb,
  maxFilesPerPost,
  existingCount,
}: {
  postId: string;
  allowedTypes: string[];
  maxFileSizeMb: number;
  maxFilesPerPost: number;
  existingCount: number;
}) {
  const [state, formAction, pending] = useActionState(uploadAttachments, initialState);
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [clientError, setClientError] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const maxSizeBytes = maxFileSizeMb * 1024 * 1024;
  const remainingSlots = maxFilesPerPost - existingCount;

  function validateFiles(files: File[]): string | null {
    if (files.length > remainingSlots) {
      return `You can only attach ${remainingSlots} more file(s) to this post.`;
    }
    for (const file of files) {
      const ext = getExt(file.name);
      if (!allowedTypes.includes(ext)) {
        return `File type ".${ext}" is not allowed.`;
      }
      if (file.size > maxSizeBytes) {
        return `File "${file.name}" exceeds the ${maxFileSizeMb}MB limit.`;
      }
    }
    return null;
  }

  function getExt(name: string): string {
    if (name.toLowerCase().endsWith('.tar.gz')) return 'tar.gz';
    const parts = name.split('.');
    return parts.length > 1 ? parts[parts.length - 1].toLowerCase() : '';
  }

  function handleFiles(files: FileList | null) {
    if (!files) return;
    const fileArray = Array.from(files);
    const error = validateFiles(fileArray);
    setClientError(error);
    if (!error) {
      setSelectedFiles(fileArray);
    }
  }

  function removeFile(index: number) {
    setSelectedFiles((prev) => {
      const next = prev.filter((_, i) => i !== index);
      // Sync the <input> with remaining files via a DataTransfer
      const dt = new DataTransfer();
      for (const f of next) dt.items.add(f);
      if (fileInputRef.current) fileInputRef.current.files = dt.files;
      return next;
    });
    setClientError(null);
  }

  function formatSize(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    setIsDragging(false);
    handleFiles(e.dataTransfer.files);
  }

  if (remainingSlots <= 0) return null;

  return (
    <div className="mt-3">
      <form action={formAction}>
        <input type="hidden" name="post_id" value={postId} />

        {(state.error || clientError) && (
          <div className="p-2 mb-2 rounded bg-red-50 border border-red-200 text-red-700 text-xs">
            {clientError || state.error}
          </div>
        )}

        <div
          className={`border-2 border-dashed rounded-lg p-4 text-center cursor-pointer transition-colors ${
            isDragging
              ? 'border-blue-400 bg-blue-50'
              : 'border-gray-300 hover:border-gray-400'
          }`}
          onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
          onDragLeave={() => setIsDragging(false)}
          onDrop={handleDrop}
          onClick={() => fileInputRef.current?.click()}
          data-testid="file-drop-zone"
        >
          <input
            ref={fileInputRef}
            type="file"
            name="files"
            multiple
            className="hidden"
            onChange={(e) => handleFiles(e.target.files)}
            accept={allowedTypes.map((t) => `.${t}`).join(',')}
            data-testid="file-input"
          />
          <p className="text-sm text-gray-500">
            Drop files here or click to select
          </p>
          <p className="text-xs text-gray-400 mt-1">
            Max {maxFileSizeMb}MB per file · {remainingSlots} file(s) remaining
          </p>
        </div>

        {/* Selected files list */}
        {selectedFiles.length > 0 && (
          <div className="mt-2 space-y-1">
            {selectedFiles.map((file, i) => (
              <div key={`${file.name}-${i}`} className="flex items-center justify-between text-xs bg-gray-50 rounded px-2 py-1">
                <span className="truncate text-gray-700">{file.name} ({formatSize(file.size)})</span>
                <button
                  type="button"
                  onClick={() => removeFile(i)}
                  className="text-red-500 hover:text-red-700 ml-2"
                  aria-label={`Remove ${file.name}`}
                >
                  ×
                </button>
              </div>
            ))}
            <button
              type="submit"
              disabled={pending || selectedFiles.length === 0}
              className="mt-2 px-3 py-1 text-xs rounded bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50"
              data-testid="upload-btn"
            >
              {pending ? 'Uploading…' : `Upload ${selectedFiles.length} file(s)`}
            </button>
          </div>
        )}
      </form>
    </div>
  );
}
