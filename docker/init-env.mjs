// `init-env --mode bundled|external --app-url URL [--edge caddy|own] [--version V]`
// prints a new .env to stdout (src/lib/deploy/init-env.mjs).
import { readFileSync } from 'node:fs';
import { parseInitEnvArgs, renderEnv } from './lib/init-env.mjs';

const usage = 'usage: init-env --mode bundled|external --app-url https://help.example.com [--edge caddy|own] [--version X.Y.Z]';
let options;
try {
  options = parseInitEnvArgs(process.argv.slice(2));
} catch (err) {
  console.error(`[init-env] ${err instanceof Error ? err.message : String(err)}`);
  console.error(usage);
  process.exit(64);
}
try {
  const { mode, appUrl, edge } = options;
  const version = options.version ?? process.env.HELPDESK_VERSION ?? 'dev';
  const supabaseEnvExample = mode === 'bundled' ? readFileSync('/app/docker/supabase.env.example', 'utf8') : '';
  process.stdout.write(renderEnv({ mode, appUrl, version, edge, supabaseEnvExample }));
} catch (err) {
  console.error(`[init-env] ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
}
