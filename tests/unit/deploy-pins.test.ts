import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';

const dockerfile = readFileSync('Dockerfile', 'utf8');
const arg = (name: string) => new RegExp(`^ARG ${name}=(\\S+)$`, 'm').exec(dockerfile)?.[1];

describe('Dockerfile pins', () => {
  it('ships the Supabase CLI version package.json pins (the one CI and developers use)', () => {
    const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
    expect(arg('SUPABASE_CLI_VERSION')).toBe(/supabase@(\S+)/.exec(pkg.scripts.supabase)?.[1]);
  });

  it('uses the Node major from .nvmrc', () => {
    expect(arg('NODE_VERSION')).toBe(readFileSync('.nvmrc', 'utf8').trim());
  });
});
