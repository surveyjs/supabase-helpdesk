import { createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';
import { generateSupabaseSecrets, parseInitEnvArgs, renderEnv, signApiKey } from './init-env.mjs';

const example = readFileSync('deploy/supabase/.env.example', 'utf8');
const env = (text: string) => Object.fromEntries(
  text.split('\n').filter((l) => /^[A-Z0-9_]+=/.test(l)).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]),
);
const claims = (jwt: string) => JSON.parse(Buffer.from(jwt.split('.')[1], 'base64url').toString());

describe('signApiKey', () => {
  it('signs an HS256 JWT like Supabase generate-keys.sh', () => {
    const jwt = signApiKey('anon', 'secret', 1_000);
    const [h, p, s] = jwt.split('.');
    expect(JSON.parse(Buffer.from(h, 'base64url').toString())).toEqual({ alg: 'HS256', typ: 'JWT' });
    expect(claims(jwt)).toEqual({ role: 'anon', iss: 'supabase', iat: 1_000, exp: 1_000 + 5 * 365 * 24 * 3600 });
    expect(s).toBe(createHmac('sha256', 'secret').update(`${h}.${p}`).digest('base64url'));
  });
});

describe('generateSupabaseSecrets', () => {
  it('meets the length rules of the Supabase services', () => {
    const s = generateSupabaseSecrets();
    expect(s.REALTIME_DB_ENC_KEY).toHaveLength(16);
    expect(s.VAULT_ENC_KEY).toHaveLength(32);
    expect(s.SECRET_KEY_BASE.length).toBeGreaterThanOrEqual(64);
    expect(s.JWT_SECRET.length).toBeGreaterThanOrEqual(32);
    expect(s.POSTGRES_PASSWORD).toMatch(/^[0-9a-f]{32}$/); // URL-safe inside MIGRATION_DB_URL
  });
});

describe('renderEnv bundled', () => {
  const text = renderEnv({ mode: 'bundled', appUrl: 'https://help.example.com/', version: '1.2.0', supabaseEnvExample: example });
  const e = env(text);

  it('selects the bundled stack', () => {
    expect(e.COMPOSE_FILE).toBe('compose.yaml:compose.bundled.yaml');
    expect(e.HELPDESK_VERSION).toBe('1.2.0');
    expect(e.SUPABASE_URL).toBe('');
  });

  it('serves Supabase on the app domain', () => {
    expect(e.APP_URL).toBe('https://help.example.com');
    expect(e.SUPABASE_PUBLIC_URL).toBe('https://help.example.com');
    expect(e.SITE_URL).toBe('https://help.example.com');
    expect(e.API_EXTERNAL_URL).toBe('https://help.example.com/auth/v1');
    expect(e.API_GW_HTTP_PORT).toBe('127.0.0.1:8000');
    expect(e.SITE_ADDRESS).toBe('help.example.com');
  });

  it('replaces every demo secret and signs the keys with the generated JWT secret', () => {
    expect(text).not.toMatch(/your-super-secret|this_password_is_insecure|supabase-demo/);
    expect(claims(e.ANON_KEY).role).toBe('anon');
    expect(claims(e.SERVICE_ROLE_KEY).role).toBe('service_role');
    const [h, p, s] = e.ANON_KEY.split('.');
    expect(s).toBe(createHmac('sha256', e.JWT_SECRET).update(`${h}.${p}`).digest('base64url'));
  });

  it('keeps one value per variable and every variable of the upstream example', () => {
    const names = text.split('\n').filter((l) => /^[A-Z0-9_]+=/.test(l)).map((l) => l.slice(0, l.indexOf('=')));
    expect(new Set(names).size).toBe(names.length);
    for (const name of Object.keys(env(example))) expect(names, name).toContain(name);
  });

  it('generates the HelpDesk secrets', () => {
    expect(e.CRON_SECRET).toMatch(/^[0-9a-f]{64}$/);
    expect(e.INBOUND_EMAIL_WEBHOOK_SECRET).toMatch(/^[0-9a-f]{64}$/);
  });

  it('lets Caddy take the public ports and the certificate by default', () => {
    expect(e.PROXY_HTTP_PORT).toBe('80');
    expect(e.PROXY_HTTPS_PORT).toBe('443');
  });

  it('with --edge caddy trusts no forwarded headers (Caddy is the edge)', () => {
    expect(e.TRUSTED_PROXIES).toBeUndefined();
  });

  it('serves plain HTTP on the port of an http APP_URL and keeps 443 on localhost', () => {
    const e2 = env(renderEnv({ mode: 'bundled', appUrl: 'http://localhost:8080', version: 'x', supabaseEnvExample: example }));
    expect(e2.SITE_ADDRESS).toBe(':80');
    expect(e2.PROXY_HTTP_PORT).toBe('8080');
    expect(e2.PROXY_HTTPS_PORT).toBe('127.0.0.1:443');
  });

  it('with --edge own, leaves TLS to your proxy and listens on localhost only', () => {
    const e3 = env(renderEnv({ mode: 'bundled', appUrl: 'https://help.example.com', version: 'x', edge: 'own', supabaseEnvExample: example }));
    expect(e3.SITE_ADDRESS).toBe(':80');
    expect(e3.PROXY_HTTP_PORT).toBe('127.0.0.1:8080');
    expect(e3.PROXY_HTTPS_PORT).toBe('127.0.0.1:8443');
  });

  it('with --edge own, trusts the X-Forwarded-* headers of your proxy (private networks)', () => {
    const e3 = env(renderEnv({ mode: 'bundled', appUrl: 'https://help.example.com', version: 'x', edge: 'own', supabaseEnvExample: example }));
    expect(e3.TRUSTED_PROXIES).toBe('private_ranges');
  });

  it('rejects an unknown edge', () => {
    expect(() => renderEnv({ mode: 'bundled', appUrl: 'https://h.example.com', version: 'x', edge: 'nginx' as 'own', supabaseEnvExample: example }))
      .toThrow(/edge/);
  });

  it('fails loudly if the upstream example lacks a variable it must set', () => {
    expect(() => renderEnv({ mode: 'bundled', appUrl: 'https://h.example.com', version: 'x', supabaseEnvExample: 'FOO=1\n' }))
      .toThrow(/POSTGRES_PASSWORD/);
  });
});

describe('renderEnv external', () => {
  const e = env(renderEnv({ mode: 'external', appUrl: 'https://help.example.com', version: '1.2.0' }));

  it('selects the external mode and leaves the Supabase settings to fill in', () => {
    expect(e.COMPOSE_FILE).toBe('compose.yaml');
    expect(e.SUPABASE_URL).toBe('');
    expect(e.SUPABASE_ANON_KEY).toBe('');
    expect(e.SUPABASE_SERVICE_ROLE_KEY).toBe('');
    expect(e.MIGRATION_DB_URL).toBe('');
    expect(e.POSTGRES_PASSWORD).toBeUndefined();
  });
});

describe('renderEnv output shape', () => {
  it('ends with exactly one newline', () => {
    const text = renderEnv({ mode: 'bundled', appUrl: 'https://h.example.com', version: 'x', supabaseEnvExample: 'COMPOSE_FILE=a\n' + example });
    expect(text.endsWith('\n')).toBe(true);
    expect(text.endsWith('\n\n')).toBe(false);
  });
});

describe('parseInitEnvArgs', () => {
  const ok = ['--mode', 'bundled', '--app-url', 'https://help.example.com'];

  it('parses a full set', () => {
    expect(parseInitEnvArgs([...ok, '--edge', 'own', '--version', '1.2.0']))
      .toEqual({ mode: 'bundled', appUrl: 'https://help.example.com', edge: 'own', version: '1.2.0' });
  });

  it('defaults edge to caddy and leaves version undefined', () => {
    const r = parseInitEnvArgs(ok);
    expect(r.edge).toBe('caddy');
    expect(r.version).toBeUndefined();
  });

  it('accepts a root slash and an http URL with a port', () => {
    expect(parseInitEnvArgs(['--mode', 'external', '--app-url', 'https://h.example.com/']).appUrl).toBe('https://h.example.com/');
    expect(parseInitEnvArgs(['--mode', 'bundled', '--app-url', 'http://localhost:8080']).appUrl).toBe('http://localhost:8080');
  });

  it.each([
    ['unknown flag', [...ok, '--bogus', 'x'], /Unknown argument/],
    ['flag without value at the end', [...ok, '--edge'], /--edge needs a value/],
    ['flag followed by a flag', ['--mode', 'bundled', '--app-url', '--edge', 'own'], /--app-url needs a value/],
    ['version without value', [...ok, '--version', '--edge', 'own'], /--version needs a value/],
    ['empty version', [...ok, '--version', ''], /--version needs a value/],
    ['empty mode', ['--mode', '', '--app-url', 'https://h.example.com'], /--mode needs a value/],
    ['missing mode', ['--app-url', 'https://h.example.com'], /--mode/],
    ['bad mode', ['--mode', 'x', '--app-url', 'https://h.example.com'], /--mode/],
    ['bad edge', [...ok, '--edge', 'nginx'], /--edge/],
    ['missing app-url', ['--mode', 'bundled'], /--app-url/],
    ['no scheme', ['--mode', 'bundled', '--app-url', 'help.example.com'], /absolute URL/],
    ['non-http scheme', ['--mode', 'bundled', '--app-url', 'ftp://h.example.com'], /http/],
    ['path', ['--mode', 'bundled', '--app-url', 'https://h.example.com/app'], /without a path/],
    ['https with port', ['--mode', 'bundled', '--app-url', 'https://h.example.com:8443'], /443/],
  ])('rejects %s', (_name, argv, message) => {
    expect(() => parseInitEnvArgs(argv)).toThrow(message);
  });
});
