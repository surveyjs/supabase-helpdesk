import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';

const dockerfile = readFileSync('Dockerfile', 'utf8');
const arg = (name: string) => new RegExp(`^ARG ${name}=(\\S+)$`, 'm').exec(dockerfile)?.[1];
const label = (name: string) =>
  new RegExp(`^\\s*(?:LABEL\\s+)?org\\.opencontainers\\.image\\.${name}="([^"]*)"`, 'm').exec(dockerfile)?.[1];

describe('Dockerfile pins', () => {
  it('ships the Supabase CLI version package.json pins (the one CI and developers use)', () => {
    const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
    expect(arg('SUPABASE_CLI_VERSION')).toBe(/supabase@(\S+)/.exec(pkg.scripts.supabase)?.[1]);
  });

  it('uses the Node major from .nvmrc', () => {
    expect(arg('NODE_VERSION')).toBe(readFileSync('.nvmrc', 'utf8').trim());
  });
});

describe('Dockerfile labels', () => {
  // GHCR links the package to the repository the source label names, which is
  // what gives the workflow's GITHUB_TOKEN write access to the package.
  it('names, as source, the repository of the image deploy/compose.yaml pulls', () => {
    const compose = readFileSync('deploy/compose.yaml', 'utf8');
    const image = /\$\{HELPDESK_IMAGE:-ghcr\.io\/([^}]+)\}/.exec(compose)?.[1];
    expect(image).toBe('surveyjs/supabase-helpdesk');
    expect(label('source')).toBe(`https://github.com/${image}`);
  });

  it('declares the license of LICENSE', () => {
    const title = readFileSync('LICENSE', 'utf8').split('\n')[0].trim(); // "MIT License"
    expect(label('licenses')).toBe(/^(\S+) License$/.exec(title)?.[1]);
  });
});
