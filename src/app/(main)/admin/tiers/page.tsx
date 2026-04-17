import { createServerClient } from '@/lib/supabase/server';
import { requireAdmin } from '@/lib/supabase/auth';
import { createTier, updateTier, deleteTier, reorderTiers, saveTierApiSecret, deleteTierApiSecret, getTierApiSecretStatus } from '@/lib/actions/tiers';
import { TierApiSecretCard } from './TierApiSecretCard';

const COLOR_DOT_MAP: Record<string, string> = {
  gray: 'bg-gray-400',
  blue: 'bg-blue-400',
  purple: 'bg-purple-400',
  green: 'bg-green-400',
  red: 'bg-red-400',
  yellow: 'bg-yellow-400',
  orange: 'bg-orange-400',
  pink: 'bg-pink-400',
  indigo: 'bg-indigo-400',
  teal: 'bg-teal-400',
};

export default async function TiersPage() {
  await requireAdmin();
  const supabase = await createServerClient();

  const { data: tiers } = await supabase
    .from('subscription_tiers')
    .select('*')
    .order('sort_order');

  // Get user counts per tier
  const tierUserCounts: Record<string, number> = {};
  for (const tier of tiers ?? []) {
    const { count } = await supabase
      .from('profiles')
      .select('id', { count: 'exact', head: true })
      .eq('tier_id', tier.id);
    tierUserCounts[tier.id] = count ?? 0;
  }

  const apiStatus = await getTierApiSecretStatus();
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';

  return (
    <div>
      <h1 className="text-2xl font-bold text-gray-900 mb-6">Subscription Tiers</h1>

      {/* Create Tier Form */}
      <div className="bg-white rounded-lg border border-gray-200 p-6 mb-6">
        <h2 className="text-lg font-semibold text-gray-900 mb-4">Create New Tier</h2>
        <form action={createTier}>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 mb-4">
            <div>
              <label htmlFor="tier-key" className="block text-xs font-medium text-gray-500 mb-1">Key</label>
              <input
                id="tier-key"
                name="key"
                type="text"
                required
                maxLength={50}
                pattern="^[a-z0-9](-?[a-z0-9])*$"
                placeholder="e.g., premium"
                className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none"
              />
              <p className="text-xs text-gray-500 mt-0.5">Lowercase, alphanumeric, hyphens. Immutable after creation.</p>
            </div>
            <div>
              <label htmlFor="tier-display-name" className="block text-xs font-medium text-gray-500 mb-1">Display Name</label>
              <input
                id="tier-display-name"
                name="display_name"
                type="text"
                required
                maxLength={100}
                placeholder="e.g., Premium"
                className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none"
              />
            </div>
            <div>
              <label htmlFor="tier-color" className="block text-xs font-medium text-gray-500 mb-1">Color</label>
              <select
                id="tier-color"
                name="color"
                defaultValue="gray"
                className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none"
              >
                {['gray', 'blue', 'purple', 'green', 'red', 'yellow', 'orange', 'pink', 'indigo', 'teal'].map((c) => (
                  <option key={c} value={c}>{c.charAt(0).toUpperCase() + c.slice(1)}</option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="tier-icon" className="block text-xs font-medium text-gray-500 mb-1">Icon (emoji, optional)</label>
              <input
                id="tier-icon"
                name="icon"
                type="text"
                maxLength={10}
                placeholder="e.g., 🌟"
                className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none"
              />
            </div>
          </div>

          <div className="mb-4">
            <h3 className="text-sm font-medium text-gray-700 mb-2">Capability Overrides</h3>
            <div className="flex flex-wrap gap-4">
              {[
                { name: 'cap_change_visibility', label: 'Change Visibility' },
                { name: 'cap_set_severity', label: 'Set Severity' },
                { name: 'cap_change_status', label: 'Change Status' },
                { name: 'cap_change_type', label: 'Change Type' },
                { name: 'cap_add_remove_tags', label: 'Add/Remove Tags' },
              ].map((cap) => (
                <label key={cap.name} className="inline-flex items-center gap-1.5 text-sm text-gray-700">
                  <input type="checkbox" name={cap.name} value="on" className="rounded border-gray-300" />
                  {cap.label}
                </label>
              ))}
            </div>
          </div>

          <div className="mb-4">
            <h3 className="text-sm font-medium text-gray-700 mb-2">Limit Overrides (blank = use global default)</h3>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div>
                <label htmlFor="tier-limit-rate" className="block text-xs font-medium text-gray-500 mb-1">Ticket Rate (per 24h)</label>
                <input id="tier-limit-rate" name="limit_ticket_rate" type="number" min={1} className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm outline-none" />
              </div>
              <div>
                <label htmlFor="tier-limit-filesize" className="block text-xs font-medium text-gray-500 mb-1">Max File Size (bytes)</label>
                <input id="tier-limit-filesize" name="limit_max_file_size" type="number" min={1} max={52428800} className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm outline-none" />
              </div>
              <div>
                <label htmlFor="tier-limit-files" className="block text-xs font-medium text-gray-500 mb-1">Max Files per Post</label>
                <input id="tier-limit-files" name="limit_max_files_per_post" type="number" min={1} max={20} className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm outline-none" />
              </div>
            </div>
          </div>

          <button type="submit" className="px-4 py-2 bg-blue-600 text-white text-sm rounded hover:bg-blue-700 font-medium">
            Create Tier
          </button>
        </form>
      </div>

      {/* Tier List */}
      <div className="bg-white rounded-lg border border-gray-200 overflow-hidden mb-6">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 border-b border-gray-200">
            <tr>
              <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase">Order</th>
              <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase">Key</th>
              <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase">Display Name</th>
              <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase">Color</th>
              <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase">Capabilities</th>
              <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase">Limits</th>
              <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase">Users</th>
              <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200">
            {(!tiers || tiers.length === 0) ? (
              <tr>
                <td colSpan={8} className="px-4 py-8 text-center text-gray-500">No tiers defined.</td>
              </tr>
            ) : tiers.map((tier, idx) => {
              const caps = [
                tier.cap_change_visibility && 'Vis',
                tier.cap_set_severity && 'Sev',
                tier.cap_change_status && 'Stat',
                tier.cap_change_type && 'Type',
                tier.cap_add_remove_tags && 'Tags',
              ].filter(Boolean).join(', ') || '—';

              const limits = [
                tier.limit_ticket_rate != null && `${tier.limit_ticket_rate}/day`,
                tier.limit_max_file_size != null && `${(tier.limit_max_file_size / 1024 / 1024).toFixed(0)}MB`,
                tier.limit_max_files_per_post != null && `${tier.limit_max_files_per_post} files`,
              ].filter(Boolean).join(', ') || '—';

              return (
                <tr key={tier.id} data-testid={`tier-row-${tier.key}`}>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-1">
                      <span className="text-gray-600">{tier.sort_order}</span>
                      {idx > 0 && (
                        <form action={reorderTiers}>
                          <input type="hidden" name="tier_ids" value={JSON.stringify(
                            tiers.map((t, i) => i === idx - 1 ? tier.id : i === idx ? tiers[idx - 1].id : t.id)
                          )} />
                          <button type="submit" className="text-xs text-gray-500 hover:text-gray-700" title="Move up">↑</button>
                        </form>
                      )}
                      {idx < tiers.length - 1 && (
                        <form action={reorderTiers}>
                          <input type="hidden" name="tier_ids" value={JSON.stringify(
                            tiers.map((t, i) => i === idx ? tiers[idx + 1].id : i === idx + 1 ? tier.id : t.id)
                          )} />
                          <button type="submit" className="text-xs text-gray-500 hover:text-gray-700" title="Move down">↓</button>
                        </form>
                      )}
                    </div>
                  </td>
                  <td className="px-4 py-3 font-mono text-xs text-gray-700">{tier.key}</td>
                  <td className="px-4 py-3 text-gray-900">{tier.icon && `${tier.icon} `}{tier.display_name}</td>
                  <td className="px-4 py-3">
                    <span className={`inline-block w-4 h-4 rounded-full ${COLOR_DOT_MAP[tier.color] ?? COLOR_DOT_MAP.gray}`} title={tier.color} />
                  </td>
                  <td className="px-4 py-3 text-xs text-gray-600">{caps}</td>
                  <td className="px-4 py-3 text-xs text-gray-600">{limits}</td>
                  <td className="px-4 py-3 text-gray-600">{tierUserCounts[tier.id] ?? 0}</td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <details className="relative">
                        <summary className="text-xs text-blue-600 hover:text-blue-800 cursor-pointer">Edit</summary>
                        <div className="absolute z-10 bg-white border border-gray-200 rounded-lg shadow-lg p-4 mt-1 w-80 right-0">
                          <form action={updateTier}>
                            <input type="hidden" name="tier_id" value={tier.id} />
                            <div className="space-y-3">
                              <div>
                                <label className="block text-xs font-medium text-gray-500 mb-1">Display Name</label>
                                <input name="display_name" type="text" required maxLength={100} defaultValue={tier.display_name} className="w-full rounded border border-gray-300 px-2 py-1 text-sm" />
                              </div>
                              <div>
                                <label className="block text-xs font-medium text-gray-500 mb-1">Color</label>
                                <select name="color" defaultValue={tier.color} className="w-full rounded border border-gray-300 px-2 py-1 text-sm">
                                  {['gray', 'blue', 'purple', 'green', 'red', 'yellow', 'orange', 'pink', 'indigo', 'teal'].map((c) => (
                                    <option key={c} value={c}>{c.charAt(0).toUpperCase() + c.slice(1)}</option>
                                  ))}
                                </select>
                              </div>
                              <div>
                                <label className="block text-xs font-medium text-gray-500 mb-1">Icon</label>
                                <input name="icon" type="text" maxLength={10} defaultValue={tier.icon ?? ''} className="w-full rounded border border-gray-300 px-2 py-1 text-sm" />
                              </div>
                              <div className="space-y-1">
                                <span className="block text-xs font-medium text-gray-500">Capabilities</span>
                                {[
                                  { name: 'cap_change_visibility', label: 'Change Visibility', checked: tier.cap_change_visibility },
                                  { name: 'cap_set_severity', label: 'Set Severity', checked: tier.cap_set_severity },
                                  { name: 'cap_change_status', label: 'Change Status', checked: tier.cap_change_status },
                                  { name: 'cap_change_type', label: 'Change Type', checked: tier.cap_change_type },
                                  { name: 'cap_add_remove_tags', label: 'Add/Remove Tags', checked: tier.cap_add_remove_tags },
                                ].map((cap) => (
                                  <label key={cap.name} className="flex items-center gap-1.5 text-xs text-gray-700">
                                    <input type="checkbox" name={cap.name} value="on" defaultChecked={cap.checked} className="rounded border-gray-300" />
                                    {cap.label}
                                  </label>
                                ))}
                              </div>
                              <div className="grid grid-cols-3 gap-2">
                                <div>
                                  <label className="block text-xs text-gray-500 mb-0.5">Rate/24h</label>
                                  <input name="limit_ticket_rate" type="number" min={1} defaultValue={tier.limit_ticket_rate ?? ''} className="w-full rounded border border-gray-300 px-2 py-1 text-xs" />
                                </div>
                                <div>
                                  <label className="block text-xs text-gray-500 mb-0.5">File size (B)</label>
                                  <input name="limit_max_file_size" type="number" min={1} max={52428800} defaultValue={tier.limit_max_file_size ?? ''} className="w-full rounded border border-gray-300 px-2 py-1 text-xs" />
                                </div>
                                <div>
                                  <label className="block text-xs text-gray-500 mb-0.5">Files/post</label>
                                  <input name="limit_max_files_per_post" type="number" min={1} max={20} defaultValue={tier.limit_max_files_per_post ?? ''} className="w-full rounded border border-gray-300 px-2 py-1 text-xs" />
                                </div>
                              </div>
                              <button type="submit" className="w-full px-3 py-1.5 bg-blue-600 text-white text-xs rounded hover:bg-blue-700">
                                Save
                              </button>
                            </div>
                          </form>
                        </div>
                      </details>
                      <form action={deleteTier} className="inline">
                        <input type="hidden" name="tier_id" value={tier.id} />
                        <button
                          type="submit"
                          className="text-xs text-red-600 hover:text-red-800"
                          data-testid={`delete-tier-${tier.key}`}
                        >
                          Delete
                        </button>
                      </form>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* External API Settings */}
      <TierApiSecretCard
        configured={apiStatus.configured}
        masked={apiStatus.masked}
        apiEndpoint={`${appUrl}/api/tiers/assign`}
        saveTierApiSecret={saveTierApiSecret}
        deleteTierApiSecret={deleteTierApiSecret}
      />
    </div>
  );
}
