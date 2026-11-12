'use client';

import { useState } from 'react';
import { formatMinutes } from '@/lib/utils/format-minutes';
import type { AgentPerformanceRow } from '@/lib/queries/reports';

type SortKey = 'displayName' | 'assigned' | 'resolved' | 'avgResponseTime' | 'avgResolutionTime' | 'avgCsat';

type Props = {
  data: AgentPerformanceRow[];
};

export function AgentPerformanceTable({ data }: Props) {
  const [sortKey, setSortKey] = useState<SortKey>('resolved');
  const [sortAsc, setSortAsc] = useState(false);

  const handleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortAsc(!sortAsc);
    } else {
      setSortKey(key);
      setSortAsc(key === 'displayName');
    }
  };

  const sorted = [...data].sort((a, b) => {
    const av = a[sortKey];
    const bv = b[sortKey];
    if (typeof av === 'string' && typeof bv === 'string') {
      return sortAsc ? av.localeCompare(bv) : bv.localeCompare(av);
    }
    const diff = ((av as number | null) ?? -1) - ((bv as number | null) ?? -1);
    return sortAsc ? diff : -diff;
  });

  const arrow = (key: SortKey) => {
    if (sortKey !== key) return '';
    return sortAsc ? ' ↑' : ' ↓';
  };

  if (data.length === 0) {
    return <div className="py-12 text-center text-gray-500">No agent data for this period</div>;
  }

  return (
    <div data-testid="agent-performance-table">
      <h3 className="text-lg font-medium text-gray-900 mb-4">Agent Performance</h3>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-200">
              {([
                ['displayName', 'Agent'],
                ['assigned', 'Assigned'],
                ['resolved', 'Resolved'],
                ['avgResponseTime', 'Avg Response'],
                ['avgResolutionTime', 'Avg Resolution'],
                ['avgCsat', 'Avg CSAT'],
              ] as [SortKey, string][]).map(([key, label]) => (
                <th
                  key={key}
                  className="py-2 px-2 font-medium text-gray-700 cursor-pointer hover:text-gray-900 text-left"
                  onClick={() => handleSort(key)}
                >
                  {label}{arrow(key)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sorted.map((agent) => (
              <tr key={agent.agentId} className="border-b border-gray-100">
                <td className="py-2 px-2">{agent.displayName}</td>
                <td className="py-2 px-2">{agent.assigned}</td>
                <td className="py-2 px-2">{agent.resolved}</td>
                <td className="py-2 px-2">{formatMinutes(agent.avgResponseTime)}</td>
                <td className="py-2 px-2">{formatMinutes(agent.avgResolutionTime)}</td>
                <td className="py-2 px-2">{agent.avgCsat !== null ? agent.avgCsat.toFixed(1) : 'N/A'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
