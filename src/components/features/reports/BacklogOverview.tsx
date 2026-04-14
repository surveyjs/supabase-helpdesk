'use client';

import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import type { BacklogData } from '@/lib/queries/reports';

type Props = {
  data: BacklogData;
};

export function BacklogOverview({ data }: Props) {
  return (
    <div data-testid="backlog-overview">
      <h3 className="text-lg font-medium text-gray-900 mb-4">Backlog Overview</h3>

      {/* Stat cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
        <div className="bg-white border border-gray-200 rounded-lg p-4">
          <div className="text-sm text-gray-500">Open Tickets</div>
          <div className="text-2xl font-semibold text-gray-900">{data.open}</div>
        </div>
        <div className="bg-white border border-gray-200 rounded-lg p-4">
          <div className="text-sm text-gray-500">Pending Tickets</div>
          <div className="text-2xl font-semibold text-gray-900">{data.pending}</div>
        </div>
        <div className="bg-white border border-gray-200 rounded-lg p-4">
          <div className="text-sm text-gray-500">Unassigned Tickets</div>
          <div className="text-2xl font-semibold text-gray-900">{data.unassigned}</div>
        </div>
      </div>

      {/* Severity breakdown */}
      {Object.keys(data.bySeverity).length > 0 && (
        <table className="w-full text-sm mb-6">
          <thead>
            <tr className="border-b border-gray-200">
              <th className="text-left py-2 font-medium text-gray-700">Severity</th>
              <th className="text-right py-2 font-medium text-gray-700">Open</th>
              <th className="text-right py-2 font-medium text-gray-700">Pending</th>
            </tr>
          </thead>
          <tbody>
            {Object.entries(data.bySeverity).map(([sev, d]) => (
              <tr key={sev} className="border-b border-gray-100">
                <td className="py-2 capitalize">{sev}</td>
                <td className="py-2 text-right">{d.open}</td>
                <td className="py-2 text-right">{d.pending}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {/* Trend chart */}
      {data.trend.length > 0 && (
        <div>
          <h4 className="text-sm font-medium text-gray-700 mb-2">Backlog Trend (14 days)</h4>
          <ResponsiveContainer width="100%" height={250}>
            <LineChart data={data.trend}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="date" tick={{ fontSize: 12 }} />
              <YAxis allowDecimals={false} />
              <Tooltip />
              <Legend />
              <Line type="monotone" dataKey="open" stroke="#3b82f6" strokeWidth={2} />
              <Line type="monotone" dataKey="pending" stroke="#f59e0b" strokeWidth={2} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}
