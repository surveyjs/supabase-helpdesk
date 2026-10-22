import { resolveSupabaseEnv } from './deploy/env.mjs';

/**
 * Instance configuration, read from the environment at request time. Nothing
 * here is inlined by `next build`, so one image serves every instance.
 */
export function runtimeConfig() {
  return resolveSupabaseEnv(process.env);
}

export function serviceRoleKey(): string {
  const key = runtimeConfig().serviceRoleKey;
  if (!key) throw new Error('Missing environment variable: SUPABASE_SERVICE_ROLE_KEY');
  return key;
}
