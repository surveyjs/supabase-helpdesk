import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';

const DIR = 'deploy/supabase';
// Created by the containers at runtime (gitignored upstream).
const RUNTIME = ['volumes/db/data', 'volumes/storage', 'volumes/snippets'];

describe('vendored Supabase self-hosted setup', () => {
  it('is pinned to the release tag the bundle is tested with', () => {
    expect(readFileSync(`${DIR}/VENDORED`, 'utf8')).toMatch(/^ref=self-hosted\/v0\.8\.3$/m);
  });

  it('has every file its docker-compose.yml mounts', () => {
    const compose = readFileSync(`${DIR}/docker-compose.yml`, 'utf8');
    const mounts = [...compose.matchAll(/^\s+- \.\/(volumes\/[^:]+):/gm)].map((m) => m[1]);
    expect(mounts.length).toBeGreaterThan(5);
    for (const path of mounts.filter((p) => !RUNTIME.includes(p))) {
      expect(existsSync(`${DIR}/${path}`), path).toBe(true);
    }
  });

  it("keeps LF line endings (Envoy's entrypoint breaks on CRLF)", () => {
    expect(readFileSync(`${DIR}/volumes/api/envoy/docker-entrypoint.sh`, 'utf8')).not.toContain('\r');
  });

  it('keeps the executable bit upstream has (Windows checkouts lose it)', () => {
    const modes = new Map(
      execFileSync('git', ['ls-files', '-s', 'deploy'], { encoding: 'utf8' })
        .split('\n')
        .filter(Boolean)
        .map((l) => [l.split('\t')[1], l.split(' ')[0]] as const),
    );
    // Upstream ships utils/*.sh as 100644 (run as `bash utils/x.sh`); keep as is.
    const scripts = [...modes.keys()].filter(
      (p) => p.endsWith('.sh') && !p.startsWith('deploy/supabase/utils/'),
    );
    expect(scripts.length).toBeGreaterThan(5);
    for (const p of scripts) expect(modes.get(p), p).toBe('100755');
    expect(modes.get('deploy/supabase/volumes/api/envoy/docker-entrypoint.sh')).toBe('100755');
  });
});
