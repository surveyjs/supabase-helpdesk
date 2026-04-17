'use client';

import { useActionState, useState } from 'react';
import Link from 'next/link';
import { createArticle, updateArticle, type KbActionState } from '@/lib/actions/kb';

type Category = { id: string; name: string };

type Article = {
  id: number;
  title: string;
  body: string;
  status: string;
  category_id: string | null;
  source_ticket_id: number | null;
  author_display_name: string;
  last_editor_display_name: string | null;
} | null;

const initialState: KbActionState = {};

export function ArticleEditorForm({
  categories,
  article,
}: {
  categories: Category[];
  article: Article;
}) {
  const isNew = !article;
  const action = isNew ? createArticle : updateArticle;
  const [state, formAction, pending] = useActionState(action, initialState);
  const [activeTab, setActiveTab] = useState<'write' | 'preview'>('write');
  const [bodyText, setBodyText] = useState(article?.body ?? '');

  return (
    <form action={formAction} className="space-y-6">
      {!isNew && (
        <input type="hidden" name="article_id" value={article.id} />
      )}

      {state.error && (
        <div role="alert" className="p-3 rounded bg-red-50 border border-red-200 text-red-700 text-sm">
          {state.error}
        </div>
      )}

      {!isNew && (
        <div className="text-sm text-gray-500 space-y-1">
          <p>
            <strong>Status:</strong>{' '}
            <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${
              article.status === 'published' ? 'bg-green-100 text-green-700' :
              article.status === 'archived' ? 'bg-gray-100 text-gray-600' :
              'bg-yellow-100 text-yellow-700'
            }`}>
              {article.status}
            </span>
          </p>
          <p>Author: {article.author_display_name}</p>
          {article.last_editor_display_name && (
            <p>Last editor: {article.last_editor_display_name}</p>
          )}
          {article.source_ticket_id && (
            <p>
              Generated from ticket{' '}
              <a href={`/tickets/${article.source_ticket_id}`} className="text-blue-600 hover:text-blue-800">
                #{article.source_ticket_id}
              </a>
            </p>
          )}
        </div>
      )}

      <div>
        <label htmlFor="title" className="block text-sm font-medium text-gray-700 mb-1">
          Title <span className="text-red-500">*</span>
        </label>
        <input
          id="title"
          name="title"
          type="text"
          required
          maxLength={300}
          defaultValue={article?.title ?? ''}
          className="block w-full rounded border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none"
        />
        {state.fieldErrors?.title && (
          <p className="mt-1 text-sm text-red-600">{state.fieldErrors.title}</p>
        )}
      </div>

      <div>
        <label htmlFor="category_id" className="block text-sm font-medium text-gray-700 mb-1">
          Category
        </label>
        <select
          id="category_id"
          name="category_id"
          defaultValue={article?.category_id ?? ''}
          className="block w-full rounded border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none"
        >
          <option value="">None</option>
          {categories.map((c) => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
        </select>
      </div>

      <div>
        <div className="flex items-center gap-2 mb-1">
          <label htmlFor="body" className="block text-sm font-medium text-gray-700">
            Body <span className="text-red-500">*</span>
          </label>
          <div className="flex gap-1 ml-auto">
            <button
              type="button"
              onClick={() => setActiveTab('write')}
              className={`px-2 py-1 text-xs rounded ${
                activeTab === 'write' ? 'bg-gray-200 text-gray-800' : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              Write
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('preview')}
              className={`px-2 py-1 text-xs rounded ${
                activeTab === 'preview' ? 'bg-gray-200 text-gray-800' : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              Preview
            </button>
          </div>
        </div>

        {activeTab === 'write' ? (
          <textarea
            id="body"
            name="body"
            required
            rows={16}
            maxLength={100000}
            value={bodyText}
            onChange={(e) => setBodyText(e.target.value)}
            className="block w-full rounded border border-gray-300 px-3 py-2 text-sm font-mono focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none resize-y"
            placeholder="Write article content in Markdown..."
          />
        ) : (
          <>
            <input type="hidden" name="body" value={bodyText} />
            <div className="border border-gray-300 rounded p-4 min-h-[16rem] prose prose-sm max-w-none">
              {bodyText ? (
                <div dangerouslySetInnerHTML={{ __html: simpleMarkdownPreview(bodyText) }} />
              ) : (
                <p className="text-gray-500">Nothing to preview</p>
              )}
            </div>
          </>
        )}

        {state.fieldErrors?.body && (
          <p className="mt-1 text-sm text-red-600">{state.fieldErrors.body}</p>
        )}
      </div>

      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={pending}
          className="px-4 py-2 bg-blue-600 text-white text-sm rounded hover:bg-blue-700 disabled:opacity-50"
        >
          {pending ? 'Saving…' : isNew ? 'Create Article' : 'Save Changes'}
        </button>
        <Link href="/kb/manage" className="text-sm text-gray-600 hover:text-gray-900">
          Cancel
        </Link>
      </div>
    </form>
  );
}

// Simple client-side Markdown preview (basic formatting)
function simpleMarkdownPreview(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/^### (.+)$/gm, '<h3>$1</h3>')
    .replace(/^## (.+)$/gm, '<h2>$1</h2>')
    .replace(/^# (.+)$/gm, '<h1>$1</h1>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/`(.+?)`/g, '<code>$1</code>')
    .replace(/\n/g, '<br />');
}
