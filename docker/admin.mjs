// `admin create --email E` / `admin reset-password --email E`: prints a one-time
// password for the account (src/lib/deploy/admin.mjs).
import { resolveSupabaseEnv } from './lib/env.mjs';
import { createAdmin, generatePassword, parseAdminArgs, resetPassword } from './lib/admin.mjs';

const usage = 'usage: admin create|reset-password --email EMAIL';
let action;
let email;
try {
  ({ action, email } = parseAdminArgs(process.argv.slice(2)));
} catch (err) {
  console.error(`[admin] ${err instanceof Error ? err.message : String(err)}`);
  console.error(usage);
  process.exit(64);
}
try {
  const env = resolveSupabaseEnv(process.env);
  if (!env.serviceRoleKey) throw new Error('Missing environment variable: SUPABASE_SERVICE_ROLE_KEY');
  const password = generatePassword();
  const options = { supabaseUrl: env.serverSupabaseUrl, serviceRoleKey: env.serviceRoleKey, email, password };
  if (action === 'create') {
    await createAdmin(options);
    console.log(`Administrator ${email} created.`);
  } else {
    await resetPassword(options);
    console.log(`Password of ${email} reset.`);
  }
  console.log(`One-time password: ${password}`);
  console.log('Sign in and change it on the profile page.');
} catch (err) {
  console.error(`[admin] ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
}
