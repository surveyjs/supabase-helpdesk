'use client';

import dynamic from 'next/dynamic';
import { useState, useCallback, useEffect } from 'react';
import MdEditorLib from 'react-markdown-editor-lite';
import CannedResponsePlugin from './CannedResponsePlugin';
import { renderMarkdown } from '@/lib/utils/markdown';

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
}: MarkdownEditorProps) {
  const [value, setValue] = useState(defaultValue ?? '');

  // Sync with external defaultValue changes (e.g., canned response insertion)
  useEffect(() => {
    if (defaultValue !== undefined && defaultValue !== value) {
      setValue(defaultValue);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [defaultValue]);

  const handleChange = useCallback(({ text }: { text: string }) => {
    setValue(text);
    onValueChange?.(text);
  }, [onValueChange]);

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
    <div data-testid="markdown-editor">
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
        style={{ height: compact ? '150px' : '250px' }}
        placeholder={placeholder ?? 'Write using Markdown…'}
        view={viewConfig}
        canView={{ menu: true, md: true, html: true, both: true, fullScreen: false, hideMenu: false }}
        plugins={plugins}
      />
    </div>
  );
}
