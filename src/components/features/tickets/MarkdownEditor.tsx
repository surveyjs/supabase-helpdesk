'use client';

import dynamic from 'next/dynamic';
import { useState, useCallback, useEffect, useRef } from 'react';
import MdEditorLib from 'react-markdown-editor-lite';
import CannedResponsePlugin from './CannedResponsePlugin';
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
  /** Called when user uploads an image (drag/drop/paste/toolbar). Return the image URL. */
  onImageUpload?: (file: File) => Promise<string>;
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

  // Preserve default toolbar buttons while allowing page-specific extras.
  const defaultPlugins = onImageUpload
    ? [...BASE_TOOLBAR_PLUGINS, 'image']
    : BASE_TOOLBAR_PLUGINS;
  const plugins = extraToolbarPlugins && extraToolbarPlugins.length > 0
    ? Array.from(new Set([...defaultPlugins, ...extraToolbarPlugins]))
    : defaultPlugins;

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
    </div>
  );
}
