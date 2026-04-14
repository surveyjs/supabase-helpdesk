'use client';

import type { ResolutionMetrics } from '@/lib/queries/reports';

function formatMinutes(mins: number): string {
  if (mins <= 0) return '0m';
  const h = Math.floor(mins / 60);
  const m = Math.round(mins % 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

type Props = {
  data: ResolutionMetrics;
  previousData?: ResolutionMetrics;
};

function ComparisonArrow({ current, previous }: { current: number; previous?: number }) {
  if (previous === undefined || previous === 0) return null;
  const diff = ((current - previous) / previous) * 100;
  // For resolution times, lower is better, so negative diff = green
  const isGood = diff < 0;
  return (
    <span className={`ml-2 text-sm ${isGood ? 'text-green-600' : 'text-red-600'}`}>
      {isGood ? '↓' : '↑'} {Math.abs(diff).toFixed(0)}%
    </span>
  );
}

export function ResolutionMetricsPanel({ data, previousData }: Props) {
  return (
    <div data-testid="resolution-metrics">
      <h3 className="text-lg font-medium text-gray-900 mb-4">Resolution Metrics</h3>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
        <div className="bg-white border border-gray-200 rounded-lg p-4">
          <div className="text-sm text-gray-500">Avg First Response</div>
          <div className="text-2xl font-semibold text-gray-900">
            {formatMinutes(data.avgFirstResponse)}
            <ComparisonArrow current={data.avgFirstResponse} previous={previousData?.avgFirstResponse} />
          </div>
        </div>
        <div className="bg-white border border-gray-200 rounded-lg p-4">
          <div className="text-sm text-gray-500">Avg Resolution</div>
          <div className="text-2xl font-semibold text-gray-900">
            {formatMinutes(data.avgResolution)}
            <ComparisonArrow current={data.avgResolution} previous={previousData?.avgResolution} />
          </div>
        </div>
        <div className="bg-white border border-gray-200 rounded-lg p-4">
          <div className="text-sm text-gray-500">Median Resolution</div>
          <div className="text-2xl font-semibold text-gray-900">
            {formatMinutes(data.medianResolution)}
            <ComparisonArrow current={data.medianResolution} previous={previousData?.medianResolution} />
          </div>
        </div>
      </div>
      {Object.keys(data.bySeverity).length > 0 && (
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-200">
              <th className="text-left py-2 font-medium text-gray-700">Severity</th>
              <th className="text-right py-2 font-medium text-gray-700">Avg First Response</th>
              <th className="text-right py-2 font-medium text-gray-700">Avg Resolution</th>
              <th className="text-right py-2 font-medium text-gray-700">Median Resolution</th>
            </tr>
          </thead>
          <tbody>
            {Object.entries(data.bySeverity).map(([sev, d]) => (
              <tr key={sev} className="border-b border-gray-100">
                <td className="py-2 capitalize">{sev}</td>
                <td className="py-2 text-right">{formatMinutes(d.avgFirstResponse)}</td>
                <td className="py-2 text-right">{formatMinutes(d.avgResolution)}</td>
                <td className="py-2 text-right">{formatMinutes(d.medianResolution)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
