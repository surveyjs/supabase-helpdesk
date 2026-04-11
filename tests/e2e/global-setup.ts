import { createServiceRoleClient } from '../helpers/supabase';

export default async function globalSetup() {
  const admin = createServiceRoleClient();
  // Bump rate limit so parallel ticket creation tests don't clash
  await admin.from('app_settings').update({ value: '100' }).eq('key', 'ticket_creation_rate_limit');
}
