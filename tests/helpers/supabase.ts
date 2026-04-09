import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'http://127.0.0.1:54321';
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

export function createAnonClient() {
  return createClient(supabaseUrl, anonKey);
}

export function createServiceRoleClient() {
  return createClient(supabaseUrl, serviceRoleKey);
}
