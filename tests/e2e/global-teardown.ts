import { createServiceRoleClient } from '../helpers/supabase';

export default async function globalTeardown() {
  const admin = createServiceRoleClient();
  // Restore rate limit to default after all tests complete
  await admin.from('app_settings').update({ value: '10' }).eq('key', 'ticket_creation_rate_limit');
}
