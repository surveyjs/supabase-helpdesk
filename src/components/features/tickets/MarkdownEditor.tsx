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

  // Reset height when min/max change (e.g., user updated their preference).
  useEffect(() => {
    setHeight((current) => Math.min(Math.max(current, baseMin), baseMax));
  }, [baseMin, baseMax]);

  // Sync with external defaultValue changes (e.g., canned response insertion)
  useEffect(() => {
    if (defaultValue !== undefined && defaultValue !== value) {
      setValue(defaultValue);
      // Reset to base when the form clears (e.g., post saved).
      if (defaultValue === '') {
        setHeight(baseMin);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [defaultValue]);

  const measureAndUpdateHeight = useCallback(
    (text: string) => {
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

  const handleChange = useCallback(
    ({ text }: { text: string }) => {
      setValue(text);
      onValueChange?.(text);
      // Defer measurement to next frame so the textarea reflects the new value.
      if (typeof window !== 'undefined') {
        window.requestAnimationFrame(() => measureAndUpdateHeight(text));
      } else {
        measureAndUpdateHeight(text);
      }
    },
    [onValueChange, measureAndUpdateHeight],
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
        onImageUpload={onImageUpload}
        style={{ height: `${height}px` }}
        placeholder={placeholder ?? 'Write using Markdown…'}
        view={viewConfig}
        canView={{ menu: true, md: true, html: true, both: true, fullScreen: false, hideMenu: false }}
        plugins={plugins}
      />
    </div>
  );
}
