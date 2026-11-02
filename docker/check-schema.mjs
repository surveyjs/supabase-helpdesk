// Startup schema check — `serve` runs it before the server, `status` with
// --report. The app starts only when the database has exactly the migrations
// shipped in this image; otherwise it stops with what to do. Nothing is ever
// migrated here: that is the explicit `migrate` command.
// Exit: 0 match (always 0 with --report when Supabase answered), 78 mismatch,
//       1 configuration error or Supabase unreachable.
import { readdirSync } from 'node:fs';
import { resolveSupabaseEnv } from './lib/env.mjs';
import { compareVersions, explain, migrationVersions } from './lib/versions.mjs';

const EXIT_MISMATCH = 78;
const report = process.argv.includes('--report');
const log = (message) => console.error(`[schema-check] ${message}`);
const waitSeconds = Number(process.env.SCHEMA_CHECK_WAIT_SECONDS ?? 60);
if (!Number.isFinite(waitSeconds) || waitSeconds < 0) {
  log(`SCHEMA_CHECK_WAIT_SECONDS must be a number >= 0, got: ${process.env.SCHEMA_CHECK_WAIT_SECONDS}`);
  process.exit(1);
}
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** One RPC attempt: ok | missing (no function: empty or pre-003 schema) | retry | fatal. */
async function attempt(url, key) {
  try {
    const res = await fetch(`${url}/rest/v1/rpc/schema_migration_versions`, {
      method: 'POST',
      headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: '{}',
      signal: AbortSignal.timeout(10_000),
    });
    const body = await res.json().catch(() => null);
    if (res.ok) return { kind: 'ok', versions: body };
    if (body?.code === 'PGRST202') return { kind: 'missing' };
    const detail = `HTTP ${res.status} ${JSON.stringify(body)}`;
    return res.status >= 500 ? { kind: 'retry', detail } : { kind: 'fatal', detail };
  } catch (err) {
    return { kind: 'retry', detail: err instanceof Error ? err.message : String(err) };
  }
}

/** @returns {Promise<string[] | null>} */
async function appliedVersions(url, key) {
  const deadline = Date.now() + waitSeconds * 1000;
  for (;;) {
    const result = await attempt(url, key);
    if (result.kind === 'ok') return result.versions;
    if (result.kind === 'missing') return null;
    if (result.kind === 'fatal') throw new Error(`Supabase rejected the request: ${result.detail}`);
    if (Date.now() >= deadline) throw new Error(`Supabase did not answer within ${waitSeconds}s: ${result.detail}`);
    await sleep(2000);
  }
}

async function main() {
  const env = resolveSupabaseEnv(process.env);
  if (!env.serviceRoleKey) throw new Error('Missing environment variable: SUPABASE_SERVICE_ROLE_KEY');
  const image = migrationVersions(readdirSync('/app/supabase/migrations'));
  const version = process.env.HELPDESK_VERSION ?? 'dev';
  const applied = await appliedVersions(env.serverSupabaseUrl, env.serviceRoleKey);
  if (applied === null) {
    log(`Image ${version} ships migrations ${image.join(', ')}.`);
    log('Cannot read the schema version: the database is empty or older than migration 003.');
    log('Run the migration explicitly: docker compose run --rm migrate');
    return report ? 0 : EXIT_MISMATCH;
  }
  const result = compareVersions(image, applied);
  log(`Image ${version}: ${image.join(', ')} | database: ${applied.join(', ') || '<empty>'}`);
  for (const line of explain(result).split('\n')) log(line);
  return result.status === 'ok' || report ? 0 : EXIT_MISMATCH;
}

main().then(
  (code) => process.exit(code),
  (err) => { log(err instanceof Error ? err.message : String(err)); process.exit(1); },
);
