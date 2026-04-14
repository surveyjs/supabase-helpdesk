'use client';

import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import type { TicketVolumeRow } from '@/lib/queries/reports';

const STATUS_COLORS: Record<string, string> = {
  open: '#3b82f6',
  pending: '#f59e0b',
  closed: '#10b981',
};

type Props = {
  data: TicketVolumeRow[];
};

export function TicketVolumeChart({ data }: Props) {
  if (data.length === 0) {
    return <div className="py-12 text-center text-gray-500">No data for this period</div>;
  }

  // Collapse into per-period rows with status breakdown
  const periodMap: Record<string, Record<string, number>> = {};
  for (const row of data) {
    if (!row.status) continue; // skip totals
    if (!periodMap[row.period]) periodMap[row.period] = {};
    periodMap[row.period][row.status] = row.count;
  }

  const chartData = Object.entries(periodMap)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([period, statuses]) => ({ period, ...statuses }));

  const allStatuses = [...new Set(data.filter((r) => r.status).map((r) => r.status!))];

  return (
    <div data-testid="ticket-volume-chart">
      <h3 className="text-lg font-medium text-gray-900 mb-4">Ticket Volume</h3>
      <ResponsiveContainer width="100%" height={300}>
        <BarChart data={chartData}>
          <CartesianGrid strokeDasharray="3 3" />
          <XAxis dataKey="period" tick={{ fontSize: 12 }} />
          <YAxis allowDecimals={false} />
          <Tooltip />
          <Legend />
          {allStatuses.map((status) => (
            <Bar key={status} dataKey={status} fill={STATUS_COLORS[status] || '#6b7280'} stackId="a" />
          ))}
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
