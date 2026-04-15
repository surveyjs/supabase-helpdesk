'use client';

import { useState, useEffect } from 'react';
import { getTicketSummary, refreshTicketSummary } from '@/lib/actions/ai';

export function AiTicketSummary({ ticketId }: { ticketId: number }) {
  const [summary, setSummary] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const fd = new FormData();
        fd.set('ticket_id', String(ticketId));
        const result = await getTicketSummary(fd);
        if (cancelled) return;
        if (result.summary) {
          setSummary(result.summary);
        } else if (result.error) {
          setError(result.error);
        }
      } catch {
        if (!cancelled) setError('Failed to load summary.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => { cancelled = true; };
  }, [ticketId]);

  async function handleRefresh() {
    setRefreshing(true);
    setError(null);
    try {
      const fd = new FormData();
      fd.set('ticket_id', String(ticketId));
      const result = await refreshTicketSummary(fd);
      if (result.summary) {
        setSummary(result.summary);
      } else if (result.error) {
        setError(result.error);
      }
    } catch {
      setError('Failed to refresh summary.');
    } finally {
      setRefreshing(false);
    }
  }

  if (loading) {
    return (
      <div className="bg-purple-50 rounded-lg border border-purple-200 p-4 mb-6" data-testid="ai-summary-loading">
        <p className="text-sm text-purple-600">Generating AI summary…</p>
      </div>
    );
  }

  if (!summary && !error) return null;

  return (
    <div className="bg-purple-50 rounded-lg border border-purple-200 p-4 mb-6" data-testid="ai-summary-panel">
      <div className="flex items-center justify-between mb-2">
        <button
          type="button"
          onClick={() => setCollapsed(!collapsed)}
          className="text-sm font-semibold text-purple-700 uppercase tracking-wider hover:text-purple-900"
        >
          {collapsed ? '▸' : '▾'} AI Summary
        </button>
        <button
          type="button"
          onClick={handleRefresh}
          disabled={refreshing}
          className="text-xs text-purple-600 hover:text-purple-800 disabled:opacity-50"
          data-testid="refresh-summary-btn"
        >
          {refreshing ? 'Refreshing…' : 'Refresh Summary'}
        </button>
      </div>
      {!collapsed && (
        <>
          {error && <p className="text-sm text-red-600">{error}</p>}
          {summary && (
            <div className="prose prose-sm max-w-none text-gray-700" data-testid="ai-summary-content">
              {summary.split('\n').map((line, i) => (
                <p key={i}>{line}</p>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
