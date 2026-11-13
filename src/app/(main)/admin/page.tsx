import Link from 'next/link';
import { createServerClient } from '@/lib/supabase/server';
import { requireAdmin } from '@/lib/supabase/auth';
import { getTierApiSecretStatus } from '@/lib/actions/tiers';

type Stat = { label: string; value: number | string };

function StatCard({
  title,
  stats,
  testId,
}: {
  title: string;
  stats: Stat[];
  testId: string;
}) {
  return (
    <section className="bg-white rounded-lg border border-gray-200 p-5" data-testid={testId}>
      <h2 className="text-sm font-semibold text-gray-900 mb-3">
        {title}
      </h2>
      <dl className="grid grid-cols-2 gap-x-4 gap-y-2">
        {stats.map((s) => (
          <div key={s.label}>
            <dt className="text-xs text-gray-500">{s.label}</dt>
            <dd className="text-lg font-semibold text-gray-900">{s.value}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

export default async function AdminPage() {
  await requireAdmin();
  const supabase = await createServerClient();

  // Head-only count queries: the instance can hold thousands of users/tickets.
  const count = async (table: 'profiles' | 'tickets', column?: string, value?: string | boolean) => {
    let q = supabase.from(table).select('*', { count: 'exact', head: true });
    if (column) q = q.eq(column, value as string);
    const { count: n } = await q;
    return n ?? 0;
  };

  const [
    totalUsers,
    agents,
    admins,
    blocked,
    open,
    pending,
    closed,
    authSettings,
    emailConfig,
    tierApi,
  ] = await Promise.all([
    count('profiles'),
    count('profiles', 'role', 'agent'),
    count('profiles', 'role', 'admin'),
    count('profiles', 'is_blocked', true),
    count('tickets', 'status', 'open'),
    count('tickets', 'status', 'pending'),
    count('tickets', 'status', 'closed'),
    supabase
      .from('app_settings')
      .select('key, value')
      .in('key', ['auth_mode', 'auth_external_provider_name']),
    supabase.from('email_config').select('smtp_host, is_verified').limit(1).maybeSingle(),
    getTierApiSecretStatus(),
  ]);

  const settings: Record<string, string> = {};
  for (const row of authSettings.data ?? []) settings[row.key] = row.value;
  const authMode = settings.auth_mode || 'built-in';
  const providerName = settings.auth_external_provider_name || '';
  const emailConfigured = !!emailConfig.data?.smtp_host;

  const attention: { text: string; href: string }[] = [];
  if (!emailConfigured) {
    attention.push({ text: 'Outbound e-mail is not configured, so notifications are not sent.', href: '/admin/email' });
  }
  if (!tierApi.configured) {
    attention.push({ text: 'Tier API secret is not set, so external tier assignment is unavailable.', href: '/admin/tiers' });
  }

  return (
    <div>
      <h1 className="text-2xl font-bold text-gray-900 mb-6">Setup</h1>

      <section
        className="mb-6 rounded-lg border border-amber-200 bg-amber-50 p-4"
        aria-labelledby="needs-attention"
        data-testid="admin-needs-attention"
      >
        <h2 id="needs-attention" className="text-sm font-semibold text-amber-900 mb-2">
          Needs attention
        </h2>
        {attention.length === 0 ? (
          <p className="text-sm text-amber-900">Nothing needs attention.</p>
        ) : (
          <ul className="space-y-1 text-sm text-amber-900">
            {attention.map((a) => (
              <li key={a.href}>
                {a.text}{' '}
                <Link href={a.href} prefetch={false} className="font-medium underline">
                  Fix this
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        <StatCard
          testId="admin-card-users"
          title="Users"
          stats={[
            { label: 'Total', value: totalUsers.toLocaleString('en-US') },
            { label: 'Agents', value: agents.toLocaleString('en-US') },
            { label: 'Admins', value: admins.toLocaleString('en-US') },
            { label: 'Blocked', value: blocked.toLocaleString('en-US') },
          ]}
        />
        <StatCard
          testId="admin-card-tickets"
          title="Tickets"
          stats={[
            { label: 'Open', value: open.toLocaleString('en-US') },
            { label: 'Pending', value: pending.toLocaleString('en-US') },
            { label: 'Closed', value: closed.toLocaleString('en-US') },
          ]}
        />
        <StatCard
          testId="admin-card-auth"
          title="Authentication"
          stats={[
            { label: 'Mode', value: authMode === 'external' ? 'External' : 'Built-in' },
            ...(authMode === 'external' && providerName ? [{ label: 'Provider', value: providerName }] : []),
          ]}
        />
        <StatCard
          testId="admin-card-email"
          title="Outbound e-mail"
          stats={[{ label: 'Configured', value: emailConfigured ? 'Yes' : 'No' }]}
        />
      </div>
    </div>
  );
}
