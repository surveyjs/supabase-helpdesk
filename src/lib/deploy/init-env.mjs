// `init-env`: the .env of a new installation (docker/init-env.mjs). Bundled
// mode starts from Supabase's own .env.example (shipped in the image) and fills
// in fresh secrets the way its utils/generate-keys.sh does; external mode lists
// only HelpDesk's settings.
import { createHmac, randomBytes } from 'node:crypto';

const b64url = (value) => Buffer.from(value).toString('base64url');
const FIVE_YEARS = 5 * 365 * 24 * 3600;

/** HS256 API key: { role, iss: 'supabase', iat, exp: +5 years }, as generate-keys.sh. */
export function signApiKey(role, secret, nowSeconds) {
  const header = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const payload = b64url(JSON.stringify({ role, iss: 'supabase', iat: nowSeconds, exp: nowSeconds + FIVE_YEARS }));
  const signature = createHmac('sha256', secret).update(`${header}.${payload}`).digest('base64url');
  return `${header}.${payload}.${signature}`;
}

/** Secrets of the bundled Supabase stack (lengths as in utils/generate-keys.sh). */
export function generateSupabaseSecrets(rand = randomBytes, nowSeconds = Math.floor(Date.now() / 1000)) {
  const b64 = (n) => rand(n).toString('base64');
  const hex = (n) => rand(n).toString('hex');
  const JWT_SECRET = b64(30);
  return {
    POSTGRES_PASSWORD: hex(16),
    JWT_SECRET,
    ANON_KEY: signApiKey('anon', JWT_SECRET, nowSeconds),
    SERVICE_ROLE_KEY: signApiKey('service_role', JWT_SECRET, nowSeconds),
    DASHBOARD_PASSWORD: hex(16),
    SECRET_KEY_BASE: b64(48),
    REALTIME_DB_ENC_KEY: hex(8),
    VAULT_ENC_KEY: hex(16),
    PG_META_CRYPTO_KEY: b64(24),
    LOGFLARE_PUBLIC_ACCESS_TOKEN: b64(24),
    LOGFLARE_PRIVATE_ACCESS_TOKEN: b64(24),
    S3_PROTOCOL_ACCESS_KEY_ID: hex(16),
    S3_PROTOCOL_ACCESS_KEY_SECRET: hex(32),
    MINIO_ROOT_PASSWORD: hex(16),
  };
}

// Who takes public traffic: the bundled Caddy (TLS for the domain in APP_URL),
// or the operator's own proxy (Traefik, nginx) in front of proxy:80.
function edgeLines(edge, url) {
  if (edge === 'own') {
    return [
      '# Your proxy terminates TLS and forwards everything to proxy:80 (see examples/traefik.yml)',
      '# or to 127.0.0.1:8080 on this host.',
      'SITE_ADDRESS=:80',
      'PROXY_HTTP_PORT=127.0.0.1:8080',
      'PROXY_HTTPS_PORT=127.0.0.1:8443',
    ];
  }
  if (edge !== 'caddy') throw new Error(`Unknown edge "${edge}": use caddy or own`);
  const https = url.protocol === 'https:';
  return [
    '# The bundled Caddy takes ports 80/443 and gets the certificate for APP_URL',
    `SITE_ADDRESS=${https ? url.hostname : ':80'}`,
    `PROXY_HTTP_PORT=${!https && url.port ? url.port : '80'}`,
    'PROXY_HTTPS_PORT=443',
  ];
}

function helpdeskSection({ mode, appUrl, version, edge, rand }) {
  const url = new URL(appUrl);
  const lines = [
    '# ---- HelpDesk (written by init-env) -------------------------------------',
    `COMPOSE_FILE=${mode === 'bundled' ? 'compose.yaml:compose.bundled.yaml' : 'compose.yaml'}`,
    ...edgeLines(edge, url),
    `HELPDESK_VERSION=${version}`,
    `APP_URL=${appUrl}`,
    `CRON_SECRET=${rand(32).toString('hex')}`,
    `INBOUND_EMAIL_WEBHOOK_SECRET=${rand(32).toString('hex')}`,
    '# Optional AI features: AI_PROVIDER, AI_API_KEY, AI_MODEL, AI_CUSTOM_ENDPOINT_URL',
  ];
  if (mode === 'bundled') {
    lines.push('# Empty: Supabase runs in this stack, on APP_URL', 'SUPABASE_URL=');
  } else {
    lines.push(
      '# Your Supabase project (Cloud: Project Settings -> API / Database)',
      'SUPABASE_URL=',
      'SUPABASE_ANON_KEY=',
      'SUPABASE_SERVICE_ROLE_KEY=',
      '# Direct or session-pooler connection string, used only by `migrate`',
      'MIGRATION_DB_URL=',
    );
  }
  return lines.join('\n');
}

/**
 * @param {{ mode: 'bundled'|'external', appUrl: string, version: string, edge?: 'caddy'|'own',
 *   supabaseEnvExample?: string, rand?: (n: number) => Buffer, nowSeconds?: number }} options
 */
export function renderEnv({ mode, appUrl, version, edge = 'caddy', supabaseEnvExample = '', rand = randomBytes, nowSeconds }) {
  const app = appUrl.trim().replace(/\/+$/, '');
  const ours = helpdeskSection({ mode, appUrl: app, version, edge, rand });
  if (mode === 'external') return `${ours}\n`;

  const values = {
    ...generateSupabaseSecrets(rand, nowSeconds),
    SUPABASE_PUBLIC_URL: app,
    API_EXTERNAL_URL: `${app}/auth/v1`,
    SITE_URL: app,
    ADDITIONAL_REDIRECT_URLS: `${app}/**`,
    API_GW_HTTP_PORT: '127.0.0.1:8000',
    POOLER_TENANT_ID: 'helpdesk',
  };
  const lines = supabaseEnvExample.split(/\r?\n/);
  for (const [name, value] of Object.entries(values)) {
    const i = lines.findIndex((l) => l.startsWith(`${name}=`));
    if (i < 0) throw new Error(`Supabase's .env.example has no ${name}= line — re-check deploy/supabase after re-vendoring`);
    lines[i] = `${name}=${value}`;
  }
  // HelpDesk's section sets COMPOSE_FILE.
  const upstream = lines.filter((l) => !l.startsWith('COMPOSE_FILE=')).join('\n');
  return `${ours}\n\n# ---- Supabase (from deploy/supabase/.env.example) -------------------------\n${upstream}\n`;
}
