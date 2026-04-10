import { createServerClient } from '@/lib/supabase/server';
import { updateRateLimit } from '@/lib/actions/admin';

export default async function AdminRateLimitPage() {
  const supabase = await createServerClient();

  const { data: setting } = await supabase
    .from('app_settings')
    .select('value')
    .eq('key', 'ticket_creation_rate_limit')
    .single();

  const currentLimit = setting?.value ?? '10';

  return (
    <div>
      <h1 className="text-2xl font-semibold text-gray-900 mb-6">Rate Limit</h1>

      <form action={updateRateLimit} className="bg-white rounded-lg border border-gray-200 p-6 space-y-4">
        <div>
          <label htmlFor="ticket_creation_rate_limit" className="block text-sm font-medium text-gray-700 mb-1">
            Tickets per 24 hours
          </label>
          <p className="text-xs text-gray-500 mb-2">
            Set to 0 for unlimited. Agents and admins are exempt from rate limiting.
          </p>
          <input
            id="ticket_creation_rate_limit"
            type="number"
            name="ticket_creation_rate_limit"
            min={0}
            defaultValue={currentLimit}
            required
            className="w-32 rounded border border-gray-300 px-3 py-1.5 text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none"
          />
        </div>

        <button
          type="submit"
          className="px-4 py-2 text-sm bg-blue-600 text-white rounded hover:bg-blue-700 font-medium"
        >
          Save
        </button>
      </form>
    </div>
  );
}
