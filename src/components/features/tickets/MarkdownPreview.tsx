'use client';

import { useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

export function MarkdownPreview({
  name,
  defaultValue,
  required,
  maxLength,
  rows,
  placeholder,
}: {
  name: string;
  defaultValue?: string;
  required?: boolean;
  maxLength?: number;
  rows?: number;
  placeholder?: string;
}) {
  const [mode, setMode] = useState<'write' | 'preview'>('write');
  const [text, setText] = useState(defaultValue ?? '');

  return (
    <div>
      <div className="flex gap-1 mb-2" role="tablist">
        <button
          type="button"
          role="tab"
          aria-selected={mode === 'write'}
          onClick={() => setMode('write')}
          className={`px-3 py-1 text-sm rounded-md font-medium ${
            mode === 'write'
              ? 'bg-blue-600 text-white'
              : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
          }`}
        >
          Write
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={mode === 'preview'}
          onClick={() => setMode('preview')}
          className={`px-3 py-1 text-sm rounded-md font-medium ${
            mode === 'preview'
              ? 'bg-blue-600 text-white'
              : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
          }`}
        >
          Preview
        </button>
      </div>

      {mode === 'write' ? (
        <textarea
          name={name}
          value={text}
          onChange={(e) => setText(e.target.value)}
          required={required}
          maxLength={maxLength}
          rows={rows ?? 6}
          placeholder={placeholder}
          className="block w-full rounded border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none resize-y"
        />
      ) : (
        <div className="min-h-[150px] rounded border border-gray-300 px-3 py-2 prose prose-sm max-w-none">
          {text ? (
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{text}</ReactMarkdown>
          ) : (
            <p className="text-gray-400 italic">Nothing to preview</p>
          )}
        </div>
      )}
      {/* Hidden input to ensure form submission still works */}
      {mode === 'preview' && (
        <input type="hidden" name={name} value={text} />
      )}
    </div>
  );
}
