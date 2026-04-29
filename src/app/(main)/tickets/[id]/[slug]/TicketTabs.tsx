'use client';

import { useState } from 'react';

type TabId = 'thread' | 'notes' | 'logs';

export function TicketTabs({
  threadContent,
  notesContent,
  logsContent,
  noteCount,
  logCount,
}: {
  threadContent: React.ReactNode;
  notesContent?: React.ReactNode;
  logsContent?: React.ReactNode;
  noteCount?: number;
  logCount?: number;
}) {
  const hasNotes = !!notesContent;
  const hasLogs = !!logsContent;

  // Always call useState at top level (React Hooks Rule)
  const [activeTab, setActiveTab] = useState<TabId>('thread');

  // If no secondary tabs, render content directly without a tab bar.
  if (!hasNotes && !hasLogs) {
    return <div>{threadContent}</div>;
  }

  return (
    <div data-testid="ticket-tabs">
      <div className="flex border-b border-gray-200 mb-4" role="tablist">
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === 'thread'}
          onClick={() => setActiveTab('thread')}
          className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px ${
            activeTab === 'thread'
              ? 'border-blue-600 text-blue-600'
              : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
          }`}
          data-testid="thread-tab"
        >
          Thread
        </button>
        {hasNotes && (
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
            {(noteCount ?? 0) > 0 && (
              <span className="ml-1.5 inline-flex items-center px-1.5 py-0.5 rounded-full text-xs font-medium bg-amber-100 text-amber-700">
                {noteCount}
              </span>
            )}
          </button>
        )}
        {hasLogs && (
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'logs'}
            onClick={() => setActiveTab('logs')}
            className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px ${
              activeTab === 'logs'
                ? 'border-gray-600 text-gray-700'
                : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
            }`}
            data-testid="logs-tab"
          >
            Logs
            <span className="ml-1.5 inline-flex items-center px-1.5 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-600">
              {logCount ?? 0}
            </span>
          </button>
        )}
      </div>

      <div role="tabpanel">
        {activeTab === 'thread' && threadContent}
        {activeTab === 'notes' && notesContent}
        {activeTab === 'logs' && logsContent}
      </div>
    </div>
  );
}
