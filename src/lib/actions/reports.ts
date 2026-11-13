'use server';

import { redirect } from 'next/navigation';
import { createServerClient, createServiceRoleClient } from '@/lib/supabase/server';
import { generateCsv } from '@/lib/utils/csv';
import { effectiveGroupBy, endExclusive, isValidDay } from '@/lib/utils/date-range';
import { formatMinutes } from '@/lib/utils/format-minutes';
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

// CSV cells for missing data are empty, not "—" or "null".
const mins = (v: number | null) => (v === null ? '' : formatMinutes(v));
const pct = (v: number | null) => (v === null ? '' : `${v}%`);

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

  if (!isValidDay(timeRange.start) || !isValidDay(timeRange.end)) {
    return { error: 'Dates must be valid (YYYY-MM-DD).' };
  }
  if (timeRange.start > timeRange.end) {
    return { error: 'The start date must be on or before the end date.' };
  }

  const agentScope = profile.role === 'agent' ? profile.id : undefined;
  // Calendar days in UTC; the end day is inclusive (queries use an exclusive upper bound).
  const range: TimeRange = {
    start: new Date(`${timeRange.start}T00:00:00Z`),
    end: new Date(`${endExclusive(timeRange.end)}T00:00:00Z`),
  };

  switch (reportType) {
    case 'ticket_volume': {
      const data = await getTicketVolumeData(range, effectiveGroupBy(timeRange.start, timeRange.end, 'day'), filters, agentScope);
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
        ['Overall', mins(data.avgFirstResponse), mins(data.avgResolution), mins(data.medianResolution)],
      ];
      for (const [sev, d] of Object.entries(data.bySeverity)) {
        rows.push([sev, mins(d.avgFirstResponse), mins(d.avgResolution), mins(d.medianResolution)]);
      }
      return { csv: generateCsv(['Severity', 'Avg First Response', 'Avg Resolution', 'Median Resolution'], rows) };
    }
    case 'agent_performance': {
      const data = await getAgentPerformanceData(range, agentScope);
      const csv = generateCsv(
        ['Agent', 'Assigned', 'Resolved', 'Avg Response Time', 'Avg Resolution Time', 'Avg CSAT'],
        data.map((a) => [a.displayName, a.assigned, a.resolved, mins(a.avgResponseTime), mins(a.avgResolutionTime), a.avgCsat !== null ? a.avgCsat.toFixed(1) : '']),
      );
      return { csv };
    }
    case 'csat_summary': {
      const data = await getCsatSummaryData(range, agentScope, undefined, filters);
      const hasRatings = Object.values(data.distribution).some((n) => n > 0);
      const rows: (string | number)[][] = [
        ['Average', hasRatings ? data.average.toFixed(2) : '', '', ''],
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
        ['Overall First Response', pct(data.firstResponseCompliance), '', '', ''],
        ['Overall Resolution', pct(data.resolutionCompliance), '', '', ''],
      ];
      for (const [sev, d] of Object.entries(data.bySeverity)) {
        rows.push([`${sev} - First Response`, pct(d.firstResponseCompliance), '', '', '']);
        rows.push([`${sev} - Resolution`, pct(d.resolutionCompliance), '', '', '']);
      }
      for (const b of data.breachedTickets) {
        rows.push([`Breached: ${b.slaType}`, b.ticketId, b.title, mins(b.target), mins(b.actual)]);
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
