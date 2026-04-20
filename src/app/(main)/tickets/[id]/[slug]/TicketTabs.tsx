'use client';

import { useState } from 'react';

export function TicketTabs({
  postsContent,
  notesContent,
  noteCount,
}: {
  postsContent: React.ReactNode;
  notesContent: React.ReactNode;
  noteCount: number;
}) {
  const [activeTab, setActiveTab] = useState<'posts' | 'notes'>('posts');

  return (
    <div data-testid="ticket-tabs">
      <div className="flex border-b border-gray-200 mb-4" role="tablist">
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === 'posts'}
          onClick={() => setActiveTab('posts')}
          className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px ${
            activeTab === 'posts'
              ? 'border-blue-600 text-blue-600'
              : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
          }`}
          data-testid="posts-tab"
        >
          Posts
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === 'notes'}
          onClick={() => setActiveTab('notes')}
          className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px ${
            activeTab === 'notes'
              ? 'border-amber-600 text-amber-600'
              : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
          }`}
          data-testid="notes-tab"
        >
          Notes
          {noteCount > 0 && (
            <span className="ml-1.5 inline-flex items-center px-1.5 py-0.5 rounded-full text-xs font-medium bg-amber-100 text-amber-700">
              {noteCount}
            </span>
          )}
        </button>
      </div>

      <div role="tabpanel">
        {activeTab === 'posts' ? postsContent : notesContent}
      </div>
    </div>
  );
}
