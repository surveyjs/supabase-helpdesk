'use client';

import {
  BarChart, Bar, LineChart, Line,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from 'recharts';
import type { CsatSummaryData } from '@/lib/queries/reports';

type Props = {
  data: CsatSummaryData;
};

export function CsatSummaryChart({ data }: Props) {
  if (data.average === 0 && Object.values(data.distribution).every((v) => v === 0)) {
    return <div data-testid="csat-summary-chart" className="py-12 text-center text-gray-500">No CSAT data for this period</div>;
  }

  const distData = Object.entries(data.distribution)
    .map(([star, count]) => ({ star: `${star}★`, count }))
    .sort((a, b) => a.star.localeCompare(b.star));

  return (
    <div data-testid="csat-summary-chart">
      <h3 className="text-lg font-medium text-gray-900 mb-4">CSAT Summary</h3>

      {/* Large average display */}
      <div className="text-center mb-6">
        <span className="text-4xl font-bold text-gray-900">{data.average.toFixed(1)}</span>
        <span className="text-2xl text-gray-500 ml-1">/ 5 ★</span>
      </div>

      {/* Distribution bar chart */}
      <div className="mb-6">
        <h4 className="text-sm font-medium text-gray-700 mb-2">Rating Distribution</h4>
        <ResponsiveContainer width="100%" height={200}>
          <BarChart data={distData}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="star" />
            <YAxis allowDecimals={false} />
            <Tooltip />
            <Bar dataKey="count" fill="#f59e0b" />
          </BarChart>
        </ResponsiveContainer>
      </div>

      {/* Trend line chart */}
      {data.trend.length > 0 && (
        <div>
          <h4 className="text-sm font-medium text-gray-700 mb-2">CSAT Trend</h4>
          <ResponsiveContainer width="100%" height={200}>
            <LineChart data={data.trend}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="period" tick={{ fontSize: 12 }} />
              <YAxis domain={[0, 5]} />
              <Tooltip />
              <Line type="monotone" dataKey="average" stroke="#f59e0b" strokeWidth={2} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}
