// `admin create` / `admin reset-password` (docker/admin.mjs): the first
// administrator of a new installation, and access recovery. Talks to Supabase
// over HTTP with the service-role key: GoTrue's admin API creates the user, the
// on_auth_user_created trigger creates its profile, PostgREST sets the role.
import { randomBytes } from 'node:crypto';

const ACTIONS = ['create', 'reset-password'];

/** Strict `<action> --email <value>`; the email is trimmed and lowercased (GoTrue stores it that way). */
export function parseAdminArgs(argv) {
  const [action, flag, value, ...rest] = argv;
  if (!ACTIONS.includes(action ?? '')) throw new Error(`Unknown action: ${action ?? '(none)'}`);
  if (flag !== '--email' || value === undefined || rest.length > 0) {
    throw new Error(`Expected exactly: ${action} --email EMAIL`);
  }
  const email = value.trim().toLowerCase();
  if (email.startsWith('-')) throw new Error(`Invalid email: ${value}`);
  if (!email.includes('@')) throw new Error(`Invalid email: ${value}`);
  return { action, email };
}

export function generatePassword(rand = randomBytes) {
  return rand(18).toString('base64url');
}

async function call(fetchImpl, url, key, init, what) {
  const res = await fetchImpl(url, {
    ...init,
    signal: AbortSignal.timeout(15_000),
    headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', ...init.headers },
  });
  const body = await res.json().catch(() => null);
  if (!res.ok) {
    throw new Error(`${what} failed: HTTP ${res.status} ${body?.msg ?? body?.message ?? JSON.stringify(body)}`);
  }
  return body;
}

export async function createAdmin({ supabaseUrl, serviceRoleKey, email, password, fetchImpl = fetch }) {
  const user = await call(fetchImpl, `${supabaseUrl}/auth/v1/admin/users`, serviceRoleKey, {
    method: 'POST',
    body: JSON.stringify({ email, password, email_confirm: true }),
  }, 'Creating the user');
  if (!user || typeof user.id !== 'string' || !user.id) {
    throw new Error('Creating the user failed: the response has no user id');
  }
  try {
    const updated = await call(fetchImpl, `${supabaseUrl}/rest/v1/profiles?id=eq.${user.id}`, serviceRoleKey, {
      method: 'PATCH',
      headers: { Prefer: 'return=representation' },
      body: JSON.stringify({ role: 'admin' }),
    }, 'Granting the admin role');
    if (!Array.isArray(updated) || updated.length !== 1) {
      throw new Error(`Granting the admin role failed: no profile for user ${user.id}`);
    }
  } catch (grantErr) {
    const reason = grantErr instanceof Error ? grantErr.message : String(grantErr);
    try {
      await call(fetchImpl, `${supabaseUrl}/auth/v1/admin/users/${user.id}`, serviceRoleKey, { method: 'DELETE' }, 'Removing the user');
    } catch (rollbackErr) {
      const why = rollbackErr instanceof Error ? rollbackErr.message : String(rollbackErr);
      throw new Error(`${reason}. Rollback failed (${why}): user ${user.id} exists without the admin role; delete or fix it manually.`);
    }
    throw new Error(`${reason}. The user was removed (rolled back); create can be re-run.`);
  }
  return user.id;
}

export async function resetPassword({ supabaseUrl, serviceRoleKey, email, password, fetchImpl = fetch }) {
  const rows = await call(fetchImpl, `${supabaseUrl}/rest/v1/profiles?select=id&email=eq.${encodeURIComponent(email)}`,
    serviceRoleKey, { method: 'GET' }, 'Looking up the user');
  if (!Array.isArray(rows) || rows.length === 0) throw new Error(`No user with email ${email}`);
  await call(fetchImpl, `${supabaseUrl}/auth/v1/admin/users/${rows[0].id}`, serviceRoleKey, {
    method: 'PUT',
    body: JSON.stringify({ password }),
  }, 'Setting the password');
}
