'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useTransition } from 'react';
import { exportReportCsv } from '@/lib/actions/reports';
import { downloadCsv } from '@/lib/utils/csv';

type Props = {
  isAdmin: boolean;
  types: { id: string; name: string }[];
  categories: { id: string; name: string }[];
  tiers?: { key: string; display_name: string }[];
};

const PRESETS: Record<string, { label: string; days: number }> = {
  '7d': { label: 'Last 7 days', days: 7 },
  '30d': { label: 'Last 30 days', days: 30 },
  '90d': { label: 'Last 90 days', days: 90 },
};

export function ReportControls({ isAdmin, types, categories, tiers }: Props) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();

  const currentStart = searchParams.get('start') || '';
  const currentEnd = searchParams.get('end') || '';
  const currentGroupBy = searchParams.get('groupBy') || 'day';
  const currentStatus = searchParams.get('status') || '';
  const currentSeverity = searchParams.get('severity') || '';
  const currentType = searchParams.get('type') || '';
  const currentCategory = searchParams.get('category') || '';
  const currentTier = searchParams.get('tier') || '';

  const updateParams = useCallback(
    (updates: Record<string, string>) => {
      const params = new URLSearchParams(searchParams.toString());
      for (const [key, value] of Object.entries(updates)) {
        if (value) params.set(key, value);
        else params.delete(key);
      }
      startTransition(() => {
        router.push(`/reports?${params.toString()}`);
      });
    },
    [router, searchParams, startTransition],
  );

  const applyPreset = (days: number) => {
    const end = new Date();
    const start = new Date();
    start.setDate(start.getDate() - days);
    updateParams({
      start: start.toISOString().slice(0, 10),
      end: end.toISOString().slice(0, 10),
    });
  };

  const handleExport = async (reportType: string) => {
    const now = new Date();
    const thirtyDaysAgo = new Date(now);
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    const start = currentStart || thirtyDaysAgo.toISOString().slice(0, 10);
    const end = currentEnd || now.toISOString().slice(0, 10);
    const result = await exportReportCsv(reportType, { start, end }, {
      status: currentStatus || undefined,
      severity: currentSeverity || undefined,
      type: currentType || undefined,
      category: currentCategory || undefined,
    });
    if (result.csv) {
      downloadCsv(`${reportType}_report.csv`, result.csv);
    }
  };

  return (
    <div className="bg-white border border-gray-200 rounded-lg p-4 mb-6" data-testid="report-controls">
      {/* Time range presets */}
      <div className="flex flex-wrap items-center gap-2 mb-3">
        <span className="text-sm font-medium text-gray-700">Period:</span>
        {Object.entries(PRESETS).map(([key, { label, days }]) => (
          <button
            key={key}
            type="button"
            onClick={() => applyPreset(days)}
            className="px-3 py-1 text-sm rounded border border-gray-300 hover:bg-gray-50"
          >
            {label}
          </button>
        ))}
        <input
          type="date"
          value={currentStart}
          onChange={(e) => updateParams({ start: e.target.value })}
          className="px-2 py-1 text-sm border border-gray-300 rounded"
          aria-label="Start date"
        />
        <span className="text-gray-500">–</span>
        <input
          type="date"
          value={currentEnd}
          onChange={(e) => updateParams({ end: e.target.value })}
          className="px-2 py-1 text-sm border border-gray-300 rounded"
          aria-label="End date"
        />
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2 mb-3">
        <select
          value={currentGroupBy}
          onChange={(e) => updateParams({ groupBy: e.target.value })}
          className="px-2 py-1 text-sm border border-gray-300 rounded"
          aria-label="Group by"
        >
          <option value="day">Daily</option>
          <option value="week">Weekly</option>
          <option value="month">Monthly</option>
        </select>

        {isAdmin && (
          <>
            <select
              value={currentStatus}
              onChange={(e) => updateParams({ status: e.target.value })}
              className="px-2 py-1 text-sm border border-gray-300 rounded"
              aria-label="Status"
            >
              <option value="">All Statuses</option>
              <option value="open">Open</option>
              <option value="pending">Pending</option>
              <option value="closed">Closed</option>
            </select>

            <select
              value={currentSeverity}
              onChange={(e) => updateParams({ severity: e.target.value })}
              className="px-2 py-1 text-sm border border-gray-300 rounded"
              aria-label="Severity"
            >
              <option value="">All Severities</option>
              <option value="low">Low</option>
              <option value="medium">Medium</option>
              <option value="high">High</option>
              <option value="critical">Critical</option>
            </select>

            <select
              value={currentType}
              onChange={(e) => updateParams({ type: e.target.value })}
              className="px-2 py-1 text-sm border border-gray-300 rounded"
              aria-label="Type"
            >
              <option value="">All Types</option>
              {types.map((t) => (
                <option key={t.id} value={t.id}>{t.name}</option>
              ))}
            </select>

            <select
              value={currentCategory}
              onChange={(e) => updateParams({ category: e.target.value })}
              className="px-2 py-1 text-sm border border-gray-300 rounded"
              aria-label="Category"
            >
              <option value="">All Categories</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>

            {tiers && tiers.length > 0 && (
              <select
                value={currentTier}
                onChange={(e) => updateParams({ tier: e.target.value })}
                className="px-2 py-1 text-sm border border-gray-300 rounded"
                aria-label="Tier"
              >
                <option value="">All Tiers</option>
                <option value="none">No tier</option>
                {tiers.map((t) => (
                  <option key={t.key} value={t.key}>{t.display_name}</option>
                ))}
              </select>
            )}
          </>
        )}
      </div>

      {/* Export buttons */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-medium text-gray-700">Export CSV:</span>
        {['ticket_volume', 'resolution_metrics', 'agent_performance', 'csat_summary', 'sla_compliance', 'backlog'].map(
          (type) => (
            <button
              key={type}
              type="button"
              onClick={() => handleExport(type)}
              className="px-2 py-1 text-xs rounded border border-gray-300 hover:bg-gray-50 capitalize"
            >
              {type.replace(/_/g, ' ')}
            </button>
          ),
        )}
      </div>

      {isPending && (
        <div className="mt-2 text-sm text-gray-500">Loading…</div>
      )}
    </div>
  );
}
