'use client';

import { useState } from 'react';
import Link from 'next/link';
import type { SlaComplianceData } from '@/lib/queries/reports';

function formatMinutes(mins: number): string {
  if (mins <= 0) return '0m';
  const h = Math.floor(mins / 60);
  const m = Math.round(mins % 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

function GaugeMetric({ label, value }: { label: string; value: number }) {
  const color = value >= 90 ? 'text-green-600' : value >= 70 ? 'text-yellow-600' : 'text-red-600';
  return (
    <div className="bg-white border border-gray-200 rounded-lg p-4 text-center">
      <div className="text-sm text-gray-500 mb-1">{label}</div>
      <div className={`text-3xl font-bold ${color}`}>{value}%</div>
    </div>
  );
}

type Props = {
  data: SlaComplianceData;
};

export function SlaCompliancePanel({ data }: Props) {
  const [showBreached, setShowBreached] = useState(false);

  return (
    <div data-testid="sla-compliance-panel">
      <h3 className="text-lg font-medium text-gray-900 mb-4">SLA Compliance</h3>

      <div className="grid grid-cols-2 gap-4 mb-6">
        <GaugeMetric label="First Response" value={data.firstResponseCompliance} />
        <GaugeMetric label="Resolution" value={data.resolutionCompliance} />
      </div>

      {Object.keys(data.bySeverity).length > 0 && (
        <table className="w-full text-sm mb-4">
          <thead>
            <tr className="border-b border-gray-200">
              <th className="text-left py-2 font-medium text-gray-700">Severity</th>
              <th className="text-right py-2 font-medium text-gray-700">First Response</th>
              <th className="text-right py-2 font-medium text-gray-700">Resolution</th>
            </tr>
          </thead>
          <tbody>
            {Object.entries(data.bySeverity).map(([sev, d]) => (
              <tr key={sev} className="border-b border-gray-100">
                <td className="py-2 capitalize">{sev}</td>
                <td className="py-2 text-right">{d.firstResponseCompliance}%</td>
                <td className="py-2 text-right">{d.resolutionCompliance}%</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {data.breachedTickets.length > 0 && (
        <div>
          <button
            type="button"
            className="text-sm text-blue-600 hover:text-blue-800 font-medium"
            onClick={() => setShowBreached(!showBreached)}
          >
            {showBreached ? 'Hide' : 'Show'} Breached Tickets ({data.breachedTickets.length})
          </button>
          {showBreached && (
            <table className="w-full text-sm mt-2">
              <thead>
                <tr className="border-b border-gray-200">
                  <th className="text-left py-2 font-medium text-gray-700">Ticket</th>
                  <th className="text-left py-2 font-medium text-gray-700">SLA Type</th>
                  <th className="text-right py-2 font-medium text-gray-700">Target</th>
                  <th className="text-right py-2 font-medium text-gray-700">Actual</th>
                </tr>
              </thead>
              <tbody>
                {data.breachedTickets.map((b) => (
                  <tr key={`${b.ticketId}-${b.slaType}`} className="border-b border-gray-100">
                    <td className="py-2">
                      <Link href={`/tickets/${b.ticketId}`} className="text-blue-600 hover:text-blue-800">
                        #{b.ticketId} {b.title}
                      </Link>
                    </td>
                    <td className="py-2 capitalize">{b.slaType.replace('_', ' ')}</td>
                    <td className="py-2 text-right">{formatMinutes(b.target)}</td>
                    <td className="py-2 text-right">{formatMinutes(b.actual)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  );
}
