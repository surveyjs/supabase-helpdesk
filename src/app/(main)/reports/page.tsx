import { redirect } from 'next/navigation';
import { createServerClient, createServiceRoleClient } from '@/lib/supabase/server';
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
import { ReportControls } from '@/components/features/reports/ReportControls';
import { TicketVolumeChart } from '@/components/features/reports/TicketVolumeChart';
import { ResolutionMetricsPanel } from '@/components/features/reports/ResolutionMetricsPanel';
import { AgentPerformanceTable } from '@/components/features/reports/AgentPerformanceTable';
import { CsatSummaryChart } from '@/components/features/reports/CsatSummaryChart';
import { SlaCompliancePanel } from '@/components/features/reports/SlaCompliancePanel';
import { BacklogOverview } from '@/components/features/reports/BacklogOverview';

type Props = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function ReportsPage({ searchParams }: Props) {
  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const svc = createServiceRoleClient();
  const { data: profile } = await svc
    .from('profiles')
    .select('id, role')
    .eq('id', user.id)
    .single();

  if (!profile || !['agent', 'admin'].includes(profile.role)) {
    redirect('/');
  }

  const isAdmin = profile.role === 'admin';
  const agentScope = isAdmin ? undefined : profile.id;

  // Parse search params
  const params = await searchParams;
  const startParam = typeof params.start === 'string' ? params.start : undefined;
  const endParam = typeof params.end === 'string' ? params.end : undefined;
  const groupBy = (typeof params.groupBy === 'string' ? params.groupBy : 'day') as 'day' | 'week' | 'month';

  const now = new Date();
  const defaultStart = new Date(now);
  defaultStart.setDate(defaultStart.getDate() - 30);

  const timeRange: TimeRange = {
    start: startParam ? new Date(startParam) : defaultStart,
    end: endParam ? new Date(endParam + 'T23:59:59.999Z') : now,
  };

  const filters: ReportFilters = {
    status: typeof params.status === 'string' ? params.status : undefined,
    severity: typeof params.severity === 'string' ? params.severity : undefined,
    type: typeof params.type === 'string' ? params.type : undefined,
    category: typeof params.category === 'string' ? params.category : undefined,
    tier: typeof params.tier === 'string' ? params.tier : undefined,
  };

  // Fetch filter options for admin
  let types: { id: string; name: string }[] = [];
  let categories: { id: string; name: string }[] = [];
  let tiers: { key: string; display_name: string }[] = [];
  if (isAdmin) {
    const { data: t } = await svc.from('ticket_types').select('id, name').order('name');
    types = t || [];
    const { data: c } = await svc.from('ticket_categories').select('id, name').order('name');
    categories = c || [];
    const { data: tr } = await svc.from('subscription_tiers').select('key, display_name').order('sort_order');
    tiers = tr || [];
  }

  // Fetch all report data in parallel
  const [
    volumeData,
    resolutionData,
    agentData,
    csatData,
    slaData,
    backlogData,
  ] = await Promise.all([
    getTicketVolumeData(timeRange, groupBy, filters, agentScope, svc),
    getResolutionMetrics(timeRange, filters, agentScope, svc),
    getAgentPerformanceData(timeRange, agentScope, svc),
    getCsatSummaryData(timeRange, agentScope, svc, filters),
    getSlaComplianceData(timeRange, agentScope, svc),
    getBacklogData(agentScope, svc),
  ]);

  return (
    <div>
      <h1 className="text-2xl font-semibold text-gray-900 mb-6">Reports</h1>

      <ReportControls isAdmin={isAdmin} types={types} categories={categories} tiers={tiers} />

      <div className="space-y-8">
        <section className="bg-white border border-gray-200 rounded-lg p-6">
          <TicketVolumeChart data={volumeData} />
        </section>

        <section className="bg-white border border-gray-200 rounded-lg p-6">
          <ResolutionMetricsPanel data={resolutionData} />
        </section>

        <section className="bg-white border border-gray-200 rounded-lg p-6">
          <AgentPerformanceTable data={agentData} />
        </section>

        <section className="bg-white border border-gray-200 rounded-lg p-6">
          <CsatSummaryChart data={csatData} />
        </section>

        <section className="bg-white border border-gray-200 rounded-lg p-6">
          <SlaCompliancePanel data={slaData} />
        </section>

        <section className="bg-white border border-gray-200 rounded-lg p-6">
          <BacklogOverview data={backlogData} />
        </section>
      </div>
    </div>
  );
}
