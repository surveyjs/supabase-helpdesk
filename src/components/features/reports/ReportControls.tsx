'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useRef, useState, useTransition } from 'react';
import { exportReportCsv } from '@/lib/actions/reports';
import { downloadCsv } from '@/lib/utils/csv';
import { effectiveGroupBy, presetRange } from '@/lib/utils/date-range';

type Props = {
  /** Effective range (URL params or the 30-day default), YYYY-MM-DD */
  rangeStart: string;
  rangeEnd: string;
  /** Date of the earliest ticket, used by the "All time" preset */
  earliestDate: string;
  /** Effective granularity (the server may coarsen daily on long ranges) */
  groupBy: string;
  isAdmin: boolean;
  types: { id: string; name: string }[];
  categories: { id: string; name: string }[];
  tiers?: { key: string; display_name: string }[];
};

// groupBy: granularity a long range switches to (the select can still change it)
const PRESETS: { key: string; label: string; days: number | null; groupBy?: string }[] = [
  { key: '7d', label: 'Last 7 days', days: 7 },
  { key: '30d', label: 'Last 30 days', days: 30 },
  { key: '90d', label: 'Last 90 days', days: 90 },
  { key: '12m', label: 'Last 12 months', days: 365, groupBy: 'week' },
  { key: 'all', label: 'All time', days: null, groupBy: 'month' },
];

const EXPORT_TYPES: Record<string, string> = {
  ticket_volume: 'Ticket volume',
  resolution_metrics: 'Resolution metrics',
  agent_performance: 'Agent performance',
  csat_summary: 'CSAT summary',
  sla_compliance: 'SLA compliance',
  backlog: 'Backlog',
};

export function ReportControls({ rangeStart, rangeEnd, earliestDate, groupBy, isAdmin, types, categories, tiers }: Props) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();
  const [exportError, setExportError] = useState<string | null>(null);
  const exportRef = useRef<HTMLDetailsElement>(null);

  // Close the export menu on outside pointerdown or Escape (focus returns to its summary)
  useEffect(() => {
    const onPointerDown = (e: PointerEvent) => {
      const el = exportRef.current;
      if (el?.open && !el.contains(e.target as Node)) el.removeAttribute('open');
    };
    const onKeyDown = (e: KeyboardEvent) => {
      const el = exportRef.current;
      if (e.key === 'Escape' && el?.open) {
        el.removeAttribute('open');
        el.querySelector('summary')?.focus();
      }
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, []);

  const currentStart = rangeStart;
  const currentEnd = rangeEnd;
  const currentGroupBy = groupBy;
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

  const activePreset = PRESETS.find((p) => {
    const r = presetRange(p.days, earliestDate);
    return r.start === currentStart && r.end === currentEnd;
  })?.key;

  const applyPreset = (days: number | null, groupBy?: string) => {
    updateParams({ ...presetRange(days, earliestDate), ...(groupBy ? { groupBy } : {}) });
  };

  const handleExport = async (reportType: string) => {
    setExportError(null);
    try {
      const result = await exportReportCsv(reportType, { start: currentStart, end: currentEnd }, {
        status: currentStatus || undefined,
        severity: currentSeverity || undefined,
        type: currentType || undefined,
        category: currentCategory || undefined,
      });
      if (result.error || !result.csv) {
        setExportError(result.error || 'Export failed. Please try again.');
        return;
      }
      downloadCsv(`${reportType}_report.csv`, result.csv);
    } catch {
      setExportError('Export failed. Please try again.');
    }
  };

  const dailyDisabled = effectiveGroupBy(currentStart, currentEnd, 'day') !== 'day';

  return (
    <div className="bg-white border border-gray-200 rounded-lg p-4 mb-6" data-testid="report-controls">
      {/* Time range presets + export */}
      <div className="flex flex-wrap items-center gap-2 mb-3">
        <span className="text-sm font-medium text-gray-700">Period:</span>
        {PRESETS.map(({ key, label, days, groupBy }) => (
          <button
            key={key}
            type="button"
            onClick={() => applyPreset(days, groupBy)}
            aria-pressed={activePreset === key}
            className={`px-3 py-1 text-sm rounded border ${
              activePreset === key
                ? 'border-blue-600 bg-blue-50 text-blue-700 font-medium'
                : 'border-gray-300 hover:bg-gray-50'
            }`}
          >
            {label}
          </button>
        ))}
        <input
          type="date"
          value={currentStart}
          onChange={(e) => updateParams({ start: e.target.value })}
          className="form-input"
          aria-label="Start date"
        />
        <span className="text-gray-500">–</span>
        <input
          type="date"
          value={currentEnd}
          onChange={(e) => updateParams({ end: e.target.value })}
          className="form-input"
          aria-label="End date"
        />
        <details ref={exportRef} className="relative ml-auto">
          <summary className="px-3 py-1 text-sm rounded border border-gray-300 hover:bg-gray-50 cursor-pointer list-none select-none">
            Export CSV ▾
          </summary>
          <div className="absolute right-0 z-10 mt-1 w-48 rounded border border-gray-200 bg-white shadow-lg py-1 flex flex-col">
            {Object.entries(EXPORT_TYPES).map(([type, label]) => (
              <button
                key={type}
                type="button"
                onClick={(e) => {
                  e.currentTarget.closest('details')?.removeAttribute('open');
                  handleExport(type);
                }}
                className="px-3 py-1.5 text-sm text-left hover:bg-gray-50"
              >
                {label}
              </button>
            ))}
          </div>
        </details>
        {exportError && (
          <div role="alert" data-testid="export-error" className="basis-full text-sm text-red-700">
            {exportError}
          </div>
        )}
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2">
        <select
          value={currentGroupBy}
          onChange={(e) => updateParams({ groupBy: e.target.value })}
          className="form-select"
          aria-label="Group by"
        >
          <option value="day" disabled={dailyDisabled}>
            Daily{dailyDisabled ? ' (up to 1 year)' : ''}
          </option>
          <option value="week">Weekly</option>
          <option value="month">Monthly</option>
        </select>

        {isAdmin && (
          <>
            <select
              value={currentStatus}
              onChange={(e) => updateParams({ status: e.target.value })}
              className="form-select"
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
              className="form-select"
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
              className="form-select"
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
              className="form-select"
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
                className="form-select"
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

      {isPending && (
        <div className="mt-2 text-sm text-gray-500">Loading…</div>
      )}
    </div>
  );
}
