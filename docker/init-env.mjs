// `init-env --mode bundled|external --app-url URL [--version V]` prints a new
// .env to stdout (src/lib/deploy/init-env.mjs).
import { readFileSync } from 'node:fs';
import { renderEnv } from './lib/init-env.mjs';

const usage = 'usage: init-env --mode bundled|external --app-url https://help.example.com [--edge caddy|own] [--version X.Y.Z]';
const args = process.argv.slice(2);
const opt = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
const mode = opt('--mode');
const appUrl = opt('--app-url');
const version = opt('--version') ?? process.env.HELPDESK_VERSION ?? 'dev';
const edge = opt('--edge') ?? 'caddy';
if (!['bundled', 'external'].includes(mode ?? '') || !appUrl || !['caddy', 'own'].includes(edge)) {
  console.error(usage);
  process.exit(64);
}
try {
  const supabaseEnvExample = mode === 'bundled' ? readFileSync('/app/docker/supabase.env.example', 'utf8') : '';
  process.stdout.write(renderEnv({ mode, appUrl, version, edge, supabaseEnvExample }));
} catch (err) {
  console.error(`[init-env] ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
}
