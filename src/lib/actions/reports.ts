'use server';

import { redirect } from 'next/navigation';
import { createServerClient, createServiceRoleClient } from '@/lib/supabase/server';
import { generateCsv } from '@/lib/utils/csv';
import {
  getTicketVolumeData,
  getResolutionMetrics,
  getAgentPerformanceData,
  getCsatSummaryData,
  getSlaComplianceData,
  getBacklogData,
  type TimeRange,
  type ReportFilters,
} from '@/lib/queries/reports';

function formatMinutes(mins: number): string {
  if (mins <= 0) return '0m';
  const h = Math.floor(mins / 60);
  const m = Math.round(mins % 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

export async function exportReportCsv(
  reportType: string,
  timeRange: { start: string; end: string },
  filters?: ReportFilters,
): Promise<{ error?: string; csv?: string }> {
  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const svcClient = createServiceRoleClient();
  const { data: profile } = await svcClient
    .from('profiles')
    .select('id, role')
    .eq('id', user.id)
    .single();

  if (!profile || !['agent', 'admin'].includes(profile.role)) {
    return { error: 'Access denied.' };
  }

  const agentScope = profile.role === 'agent' ? profile.id : undefined;
  const range: TimeRange = { start: new Date(timeRange.start), end: new Date(timeRange.end) };

  switch (reportType) {
    case 'ticket_volume': {
      const data = await getTicketVolumeData(range, 'day', filters, agentScope);
      const totalRows = data.filter((r) => !r.status);
      const csv = generateCsv(
        ['Period', 'Count'],
        totalRows.map((r) => [r.period, r.count]),
      );
      return { csv };
    }
    case 'resolution_metrics': {
      const data = await getResolutionMetrics(range, filters, agentScope);
      const rows: (string | number)[][] = [
        ['Overall', formatMinutes(data.avgFirstResponse), formatMinutes(data.avgResolution), formatMinutes(data.medianResolution)],
      ];
      for (const [sev, d] of Object.entries(data.bySeverity)) {
        rows.push([sev, formatMinutes(d.avgFirstResponse), formatMinutes(d.avgResolution), formatMinutes(d.medianResolution)]);
      }
      return { csv: generateCsv(['Severity', 'Avg First Response', 'Avg Resolution', 'Median Resolution'], rows) };
    }
    case 'agent_performance': {
      const data = await getAgentPerformanceData(range, agentScope);
      const csv = generateCsv(
        ['Agent', 'Assigned', 'Resolved', 'Avg Response Time', 'Avg Resolution Time', 'Avg CSAT'],
        data.map((a) => [a.displayName, a.assigned, a.resolved, formatMinutes(a.avgResponseTime), formatMinutes(a.avgResolutionTime), a.avgCsat ? a.avgCsat.toFixed(1) : 'N/A']),
      );
      return { csv };
    }
    case 'csat_summary': {
      const data = await getCsatSummaryData(range, agentScope);
      const rows: (string | number)[][] = [
        ['Average', data.average.toFixed(2), '', ''],
      ];
      for (const [star, count] of Object.entries(data.distribution)) {
        rows.push([`${star} Star`, count, '', '']);
      }
      for (const t of data.trend) {
        rows.push(['Trend', t.average.toFixed(2), t.period, '']);
      }
      return { csv: generateCsv(['Metric', 'Value', 'Period', ''], rows) };
    }
    case 'sla_compliance': {
      const data = await getSlaComplianceData(range, agentScope);
      const rows: (string | number)[][] = [
        ['Overall First Response', `${data.firstResponseCompliance}%`, '', '', ''],
        ['Overall Resolution', `${data.resolutionCompliance}%`, '', '', ''],
      ];
      for (const [sev, d] of Object.entries(data.bySeverity)) {
        rows.push([`${sev} - First Response`, `${d.firstResponseCompliance}%`, '', '', '']);
        rows.push([`${sev} - Resolution`, `${d.resolutionCompliance}%`, '', '', '']);
      }
      for (const b of data.breachedTickets) {
        rows.push([`Breached: ${b.slaType}`, b.ticketId, b.title, formatMinutes(b.target), formatMinutes(b.actual)]);
      }
      return { csv: generateCsv(['Metric', 'Value', 'Detail', 'Target', 'Actual'], rows) };
    }
    case 'backlog': {
      const data = await getBacklogData(agentScope);
      const csv = generateCsv(
        ['Metric', 'Value'],
        [
          ['Open', data.open],
          ['Pending', data.pending],
          ['Unassigned', data.unassigned],
          ...Object.entries(data.bySeverity).flatMap(([sev, d]) => [
            [`${sev} - Open`, d.open],
            [`${sev} - Pending`, d.pending],
          ]),
        ],
      );
      return { csv };
    }
    default:
      return { error: 'Unknown report type.' };
  }
}
