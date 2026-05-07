'use client';

import dynamic from 'next/dynamic';
import { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import MdEditorLib from 'react-markdown-editor-lite';
import CannedResponsePlugin from './CannedResponsePlugin';
import AttachFilePlugin from './AttachFilePlugin';
import type { InlineAttachmentUploaded } from './inlineAttachmentUpload';
import { renderMarkdown } from '@/lib/utils/markdown';

export const DEFAULT_EDITOR_MIN_HEIGHT_PX = 300;
export const DEFAULT_EDITOR_MAX_HEIGHT_PX = 540;
const EDITOR_TOOLBAR_OFFSET_PX = 38;
const EDITOR_LINE_HEIGHT_PX = 22;
const EDITOR_TEXTAREA_PADDING_PX = 16;
const COMPACT_MIN_HEIGHT_FLOOR_PX = 120;

type MdEditorLibWithUse = {
  use: (plugin: unknown) => void;
};

function registerEditorPlugins() {
  const registerPluginFn = (MdEditorLib as unknown as MdEditorLibWithUse).use;
  registerPluginFn(CannedResponsePlugin);
  registerPluginFn(AttachFilePlugin);
}

// Register custom plugins once at module load.
registerEditorPlugins();

// Import react-markdown-editor-lite with SSR disabled (it depends on browser APIs)
const MdEditor = dynamic(() => import('react-markdown-editor-lite'), { ssr: false });

// Import editor styles
import 'react-markdown-editor-lite/lib/index.css';

const BASE_TOOLBAR_PLUGINS: string[] = [
  'header',
  'font-bold',
  'font-italic',
  'font-underline',
  'font-strikethrough',
  'list-unordered',
  'list-ordered',
  'block-quote',
  'block-wrap',
  'block-code-inline',
  'block-code-block',
  'table',
  'link',
  'clear',
  'logger',
  'mode-toggle',
];

export interface MarkdownEditorProps {
  id?: string;
  name: string;
  defaultValue?: string;
  required?: boolean;
  maxLength?: number;
  placeholder?: string;
  compact?: boolean;
  /** Editor view mode — controlled by user preference */
  viewMode?: 'both' | 'preview' | 'editor';
  onValueChange?: (value: string) => void;
  /** Called when user pastes an image into the editor. Return the image URL. */
  onImageUpload?: (file: File) => Promise<string>;
  /**
   * Called for each file selected via the "Attach file(s)" toolbar button or
   * dropped onto the editor. Return an `{ url, name, mimeType, isImage }`
   * descriptor; the editor inserts `![name](url)` for images and
   * `[name](url)` for everything else at the current cursor position.
   */
  onAttachmentUpload?: (file: File) => Promise<InlineAttachmentUploaded>;
  /** Toolbar plugins to prepend (e.g., canned response button for agents) */
  extraToolbarPlugins?: string[];
  /** Initial editor height in px (default 300). */
  minHeightPx?: number;
  /** Maximum editor height in px (default 540). */
  maxHeightPx?: number;
}

export function MarkdownEditor({
  id,
  name,
  defaultValue,
  required,
  maxLength,
  placeholder,
  compact,
  viewMode = 'both',
  onValueChange,
  onImageUpload,
  onAttachmentUpload,
  extraToolbarPlugins,
  minHeightPx,
  maxHeightPx,
}: MarkdownEditorProps) {
  const [value, setValue] = useState(defaultValue ?? '');
  const wrapperRef = useRef<HTMLDivElement | null>(null);

  const requestedMin = minHeightPx ?? DEFAULT_EDITOR_MIN_HEIGHT_PX;
  const requestedMax = maxHeightPx ?? DEFAULT_EDITOR_MAX_HEIGHT_PX;
  const baseMin = compact
    ? Math.max(COMPACT_MIN_HEIGHT_FLOOR_PX, Math.floor(requestedMin / 2))
    : requestedMin;
  const baseMax = Math.max(baseMin, requestedMax);

  const [height, setHeight] = useState<number>(baseMin);
  const isMountedRef = useRef(true);
  const pendingFrameRef = useRef<number | null>(null);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      if (pendingFrameRef.current !== null && typeof window !== 'undefined') {
        window.cancelAnimationFrame(pendingFrameRef.current);
        pendingFrameRef.current = null;
      }
    };
  }, []);

  // Reset height when min/max change (e.g., user updated their preference).
  useEffect(() => {
    setHeight((current) => Math.min(Math.max(current, baseMin), baseMax));
  }, [baseMin, baseMax]);

  // Sync with external defaultValue changes (e.g., canned response insertion,
  // form reset after save). Re-measure so the editor grows/shrinks to fit
  // the externally-injected content immediately, not only on the next keystroke.
  useEffect(() => {
    if (defaultValue !== undefined && defaultValue !== value) {
      setValue(defaultValue);
      if (defaultValue === '') {
        setHeight(baseMin);
      } else {
        scheduleMeasure(defaultValue);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [defaultValue]);

  const measureAndUpdateHeight = useCallback(
    (text: string) => {
      if (!isMountedRef.current) return;
      let candidate: number | null = null;
      const wrapper = wrapperRef.current;
      if (wrapper) {
        const textarea = wrapper.querySelector<HTMLTextAreaElement>(
          'textarea.section-container',
        ) ?? wrapper.querySelector<HTMLTextAreaElement>('textarea');
        if (textarea) {
          // Force scrollHeight recalc by temporarily clearing height.
          const previous = textarea.style.height;
          textarea.style.height = 'auto';
          const contentHeight = textarea.scrollHeight;
          textarea.style.height = previous;
          candidate = contentHeight + EDITOR_TOOLBAR_OFFSET_PX;
        }
      }
      if (candidate === null) {
        const lines = text.length === 0 ? 1 : text.split('\n').length;
        candidate =
          lines * EDITOR_LINE_HEIGHT_PX +
          EDITOR_TEXTAREA_PADDING_PX +
          EDITOR_TOOLBAR_OFFSET_PX;
      }
      const clamped = Math.min(Math.max(candidate, baseMin), baseMax);
      setHeight((prev) => (prev === clamped ? prev : clamped));
    },
    [baseMin, baseMax],
  );

  const scheduleMeasure = useCallback(
    (text: string) => {
      if (typeof window === 'undefined') {
        measureAndUpdateHeight(text);
        return;
      }
      if (pendingFrameRef.current !== null) {
        window.cancelAnimationFrame(pendingFrameRef.current);
      }
      pendingFrameRef.current = window.requestAnimationFrame(() => {
        pendingFrameRef.current = null;
        if (isMountedRef.current) {
          measureAndUpdateHeight(text);
        }
      });
    },
    [measureAndUpdateHeight],
  );

  // Tracks pending placeholder text that should be stripped from the editor
  // value the next time `handleChange` runs after a failed image upload. The
  // underlying lib inserts `![Uploading_<id>]()` synchronously and replaces it
  // with `![<filename>](<url>)` once the `onImageUpload` Promise resolves; on
  // failure neither token is removed, leaving a broken inline image behind.
  const pendingCleanupRef = useRef<Array<RegExp>>([]);

  const stripPendingPlaceholders = useCallback((text: string): string => {
    if (pendingCleanupRef.current.length === 0) return text;
    let next = text;
    const stillPending: RegExp[] = [];
    for (const pattern of pendingCleanupRef.current) {
      const replaced = next.replace(pattern, '');
      if (replaced !== next) {
        next = replaced;
      } else {
        stillPending.push(pattern);
      }
    }
    pendingCleanupRef.current = stillPending;
    return next;
  }, []);

  const handleChange = useCallback(
    ({ text }: { text: string }) => {
      const cleaned = stripPendingPlaceholders(text);
      setValue(cleaned);
      onValueChange?.(cleaned);
      // Defer measurement to next frame so the textarea reflects the new value.
      scheduleMeasure(cleaned);
    },
    [onValueChange, scheduleMeasure, stripPendingPlaceholders],
  );

  const [uploadError, setUploadError] = useState<string | null>(null);

  const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  // Wraps the caller's `onImageUpload` so non-image files and upload errors
  // surface a friendly inline message and the editor's `Uploading_…`
  // placeholder is removed instead of being left as a broken inline image.
  const handleEditorImageUpload = useCallback(
    async (file: File): Promise<string> => {
      if (!onImageUpload) return '';
      setUploadError(null);
      try {
        if (!file.type.startsWith('image/')) {
          throw new Error(
            `Only image files can be embedded inline. "${file.name}" was not uploaded.`,
          );
        }
        return await onImageUpload(file);
      } catch (err) {
        const message =
          err instanceof Error && err.message ? err.message : 'Image upload failed.';
        setUploadError(message);
        // Queue removal of both the spinner placeholder and the empty-URL
        // fallback the lib will insert once we resolve. The next `onChange`
        // (fired by the lib's text replacement) will run `stripPendingPlaceholders`.
        pendingCleanupRef.current.push(/!\[Uploading_[A-Za-z0-9_-]+\]\(\)\n?/g);
        pendingCleanupRef.current.push(
          new RegExp(`!\\[${escapeRegExp(file.name)}\\]\\(\\)\\n?`, 'g'),
        );
        return '';
      }
    },
    [onImageUpload],
  );

  // Derive view config from viewMode prop
  const viewConfig = {
    menu: true,
    md: viewMode === 'both' || viewMode === 'editor',
    html: viewMode === 'both' || viewMode === 'preview',
  };

  // ---------------------------------------------------------------------------
  // Attach files: dialog + drop handling
  // ---------------------------------------------------------------------------
  // The toolbar `attach-file` plugin button dispatches a bubbling
  // `mdeditor:request-attach-files` CustomEvent; we listen for it on the
  // wrapper and open a system file picker. Files dropped onto the editor are
  // intercepted in the capture phase (so the lib never sees them) and surface
  // the same dialog with the dropped files preselected. The dialog lets the
  // user uncheck files they don't want, then uploads each via
  // `onAttachmentUpload` and inserts `[name](url)` (or `![name](url)` for
  // images) at the current cursor position.
  type PendingAttachment = {
    file: File;
    selected: boolean;
    error?: string;
  };
  const [attachDialogOpen, setAttachDialogOpen] = useState(false);
  const [pendingAttachments, setPendingAttachments] = useState<PendingAttachment[]>([]);
  const [attachUploading, setAttachUploading] = useState(false);
  const attachInputRef = useRef<HTMLInputElement | null>(null);

  const openAttachDialogWithFiles = useCallback((files: File[]) => {
    if (files.length === 0) return;
    setPendingAttachments(files.map((file) => ({ file, selected: true })));
    setAttachDialogOpen(true);
  }, []);

  // Listen for toolbar button clicks (event bubbles up from the plugin span).
  useEffect(() => {
    if (!onAttachmentUpload) return;
    const wrapper = wrapperRef.current;
    if (!wrapper) return;
    const handler = () => {
      // No preselected files yet — open the system file picker first.
      attachInputRef.current?.click();
    };
    wrapper.addEventListener('mdeditor:request-attach-files', handler as EventListener);
    return () => {
      wrapper.removeEventListener(
        'mdeditor:request-attach-files',
        handler as EventListener,
      );
    };
  }, [onAttachmentUpload]);

  // Intercept file drops on the editor in the capture phase so the underlying
  // `react-markdown-editor-lite` handler doesn't insert images directly —
  // the user should always confirm via the attach dialog.
  useEffect(() => {
    if (!onAttachmentUpload) return;
    const wrapper = wrapperRef.current;
    if (!wrapper) return;

    const onDragOver = (e: DragEvent) => {
      if (!e.dataTransfer) return;
      const hasFiles = Array.from(e.dataTransfer.types ?? []).includes('Files');
      if (!hasFiles) return;
      e.preventDefault();
    };
    const onDrop = (e: DragEvent) => {
      if (!e.dataTransfer) return;
      const files = Array.from(e.dataTransfer.files ?? []);
      if (files.length === 0) return;
      e.preventDefault();
      e.stopPropagation();
      openAttachDialogWithFiles(files);
    };

    wrapper.addEventListener('dragover', onDragOver, true);
    wrapper.addEventListener('drop', onDrop, true);
    return () => {
      wrapper.removeEventListener('dragover', onDragOver, true);
      wrapper.removeEventListener('drop', onDrop, true);
    };
  }, [onAttachmentUpload, openAttachDialogWithFiles]);

  const handleAttachInputChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = Array.from(e.target.files ?? []);
      // Reset so the same file can be selected again later.
      e.target.value = '';
      openAttachDialogWithFiles(files);
    },
    [openAttachDialogWithFiles],
  );

  const togglePendingAttachment = useCallback((index: number) => {
    setPendingAttachments((prev) =>
      prev.map((p, i) => (i === index ? { ...p, selected: !p.selected } : p)),
    );
  }, []);

  const closeAttachDialog = useCallback(() => {
    setAttachDialogOpen(false);
    setPendingAttachments([]);
    setAttachUploading(false);
  }, []);

  const insertAttachmentMarkdown = useCallback(
    (uploaded: InlineAttachmentUploaded) => {
      const safeName = uploaded.name.replace(/[\[\]]/g, '');
      const md = `${uploaded.isImage ? '!' : ''}[${safeName}](${uploaded.url})`;
      const wrapper = wrapperRef.current;
      const textarea = wrapper?.querySelector<HTMLTextAreaElement>(
        'textarea.section-container',
      ) ?? wrapper?.querySelector<HTMLTextAreaElement>('textarea[name="textarea"]');
      if (textarea) {
        const start = textarea.selectionStart ?? textarea.value.length;
        const end = textarea.selectionEnd ?? textarea.value.length;
        const before = textarea.value.slice(0, start);
        const after = textarea.value.slice(end);
        const needsLeadingNl = before.length > 0 && !before.endsWith('\n');
        const insertText = `${needsLeadingNl ? '\n' : ''}${md}\n`;
        const next = `${before}${insertText}${after}`;
        // Use the native setter so React's controlled-input change handler fires.
        const proto = Object.getPrototypeOf(textarea) as HTMLTextAreaElement;
        const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
        if (setter) setter.call(textarea, next);
        else textarea.value = next;
        const caret = before.length + insertText.length;
        textarea.setSelectionRange(caret, caret);
        textarea.dispatchEvent(new Event('input', { bubbles: true }));
        return;
      }
      // Fallback: append to the existing value.
      const next = `${value}${value.endsWith('\n') || value.length === 0 ? '' : '\n'}${md}\n`;
      setValue(next);
      onValueChange?.(next);
    },
    [onValueChange, value],
  );

  const handleAttachConfirm = useCallback(async () => {
    if (!onAttachmentUpload) return;
    const toUpload = pendingAttachments
      .map((p, index) => ({ ...p, index }))
      .filter((p) => p.selected);
    if (toUpload.length === 0) {
      closeAttachDialog();
      return;
    }
    setAttachUploading(true);
    setUploadError(null);
    let hadError = false;
    for (const item of toUpload) {
      try {
        const result = await onAttachmentUpload(item.file);
        insertAttachmentMarkdown(result);
      } catch (err) {
        hadError = true;
        const message =
          err instanceof Error && err.message ? err.message : 'Upload failed.';
        setPendingAttachments((prev) =>
          prev.map((p, i) => (i === item.index ? { ...p, error: message } : p)),
        );
      }
    }
    setAttachUploading(false);
    if (!hadError) {
      closeAttachDialog();
    }
  }, [
    onAttachmentUpload,
    pendingAttachments,
    closeAttachDialog,
    insertAttachmentMarkdown,
  ]);

  // Compose plugin list. The legacy built-in `image` button is replaced by
  // the custom `attach-file` plugin when `onAttachmentUpload` is provided;
  // image *paste* still works through the underlying lib's `onImageUpload`
  // handler if a caller also wires that prop.
  const plugins = useMemo(() => {
    const list = [...BASE_TOOLBAR_PLUGINS];
    if (onAttachmentUpload) list.push('attach-file');
    if (extraToolbarPlugins && extraToolbarPlugins.length > 0) {
      for (const p of extraToolbarPlugins) {
        if (!list.includes(p)) list.push(p);
      }
    }
    return list;
  }, [onAttachmentUpload, extraToolbarPlugins]);

  const acceptAttribute = '*/*';

  function formatSize(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  const selectedCount = pendingAttachments.filter((p) => p.selected).length;

  return (
    <div data-testid="markdown-editor" ref={wrapperRef}>
      {/* Hidden textarea for form submission (keeps Server Action forms working) */}
      <textarea
        id={id}
        name={name}
        value={value}
        required={required}
        maxLength={maxLength}
        readOnly
        hidden
        aria-hidden="true"
        tabIndex={-1}
      />
      {onAttachmentUpload && (
        <input
          ref={attachInputRef}
          type="file"
          multiple
          accept={acceptAttribute}
          className="hidden"
          onChange={handleAttachInputChange}
          data-testid="attach-files-input"
          aria-hidden="true"
          tabIndex={-1}
        />
      )}
      <MdEditor
        id={id}
        value={value}
        onChange={handleChange}
        renderHTML={(text: string) => renderMarkdown(text)}
        onImageUpload={onImageUpload ? handleEditorImageUpload : undefined}
        imageAccept="image/*"
        style={{ height: `${height}px` }}
        placeholder={placeholder ?? 'Write using Markdown…'}
        view={viewConfig}
        canView={{ menu: true, md: true, html: true, both: true, fullScreen: false, hideMenu: false }}
        plugins={plugins}
      />
      {uploadError && (
        <p
          role="alert"
          data-testid="markdown-editor-upload-error"
          className="mt-2 text-sm text-red-600"
        >
          {uploadError}
        </p>
      )}
      {attachDialogOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Attach file(s)"
          data-testid="attach-files-dialog"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          onClick={(e) => {
            if (e.target === e.currentTarget && !attachUploading) closeAttachDialog();
          }}
        >
          <div className="w-full max-w-md rounded-lg bg-white p-4 shadow-lg">
            <div className="mb-3 flex items-center justify-between">
              <h3 className="text-sm font-semibold text-gray-900">Attach file(s)</h3>
              <button
                type="button"
                onClick={closeAttachDialog}
                disabled={attachUploading}
                className="text-gray-400 hover:text-gray-600 disabled:opacity-50"
                aria-label="Close attach dialog"
              >
                ×
              </button>
            </div>
            {pendingAttachments.length === 0 ? (
              <p className="text-sm text-gray-500">No files selected.</p>
            ) : (
              <ul
                className="max-h-64 space-y-1 overflow-y-auto"
                data-testid="attach-files-list"
              >
                {pendingAttachments.map((p, i) => (
                  <li
                    key={`${p.file.name}-${i}`}
                    className="flex items-start gap-2 rounded border border-gray-200 px-2 py-1 text-xs"
                  >
                    <input
                      type="checkbox"
                      checked={p.selected}
                      onChange={() => togglePendingAttachment(i)}
                      disabled={attachUploading}
                      aria-label={`Attach ${p.file.name}`}
                      className="mt-1 h-4 w-4"
                    />
                    <div className="min-w-0 flex-1">
                      <div className="truncate font-medium text-gray-800">
                        {p.file.name}
                      </div>
                      <div className="text-gray-500">
                        {formatSize(p.file.size)}
                        {p.file.type ? ` · ${p.file.type}` : ''}
                      </div>
                      {p.error && (
                        <div role="alert" className="mt-1 text-red-600">
                          {p.error}
                        </div>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            )}
            <div className="mt-3 flex justify-end gap-2">
              <button
                type="button"
                onClick={closeAttachDialog}
                disabled={attachUploading}
                className="rounded bg-gray-100 px-3 py-1 text-xs text-gray-700 hover:bg-gray-200 disabled:opacity-50"
                data-testid="attach-files-cancel-btn"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleAttachConfirm}
                disabled={attachUploading || selectedCount === 0}
                className="rounded bg-blue-600 px-3 py-1 text-xs text-white hover:bg-blue-700 disabled:opacity-50"
                data-testid="attach-files-confirm-btn"
              >
                {attachUploading
                  ? 'Uploading…'
                  : `Attach ${selectedCount} file${selectedCount === 1 ? '' : 's'}`}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
