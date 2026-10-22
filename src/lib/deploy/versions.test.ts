import { describe, it, expect } from 'vitest';
import { compareVersions, explain, migrationVersions } from './versions.mjs';

describe('migrationVersions', () => {
  it('extracts numeric prefixes in order and ignores other files', () => {
    expect(migrationVersions(['002_b.sql', '001_a.sql', '.gitkeep', 'README.md', 'notes.sql']))
      .toEqual(['001', '002']);
  });

  it('rejects two files with one version (the CLI would silently skip one)', () => {
    expect(() => migrationVersions(['002_a.sql', '002_b.sql']))
      .toThrow('Duplicate migration version 002: 002_a.sql and 002_b.sql');
  });
});

describe('compareVersions', () => {
  const image = ['001', '002', '003'];

  it('ok when identical', () => {
    expect(compareVersions(image, ['001', '002', '003'])).toEqual({ status: 'ok', pending: [], dbOnly: [] });
  });

  it('pending on an empty database', () => {
    expect(compareVersions(image, [])).toEqual({ status: 'pending', pending: image, dbOnly: [] });
  });

  it('pending when the database is behind', () => {
    expect(compareVersions(image, ['001'])).toEqual({ status: 'pending', pending: ['002', '003'], dbOnly: [] });
  });

  it('newer when the database has versions this image does not ship', () => {
    expect(compareVersions(['001', '002'], image)).toEqual({ status: 'newer', pending: [], dbOnly: ['003'] });
  });

  it('diverged when both sides have versions the other lacks', () => {
    expect(compareVersions(['001', '002', '004'], image))
      .toEqual({ status: 'diverged', pending: ['004'], dbOnly: ['003'] });
  });
});

describe('explain', () => {
  it('pending: names the migrations and the migrate command', () => {
    expect(explain(compareVersions(['001', '002', '003'], ['001'])))
      .toMatch(/Pending migrations: 002, 003[\s\S]*docker compose run --rm migrate/);
  });

  it('newer: points to the rollback, never to a bypass', () => {
    const text = explain(compareVersions(['001'], ['001', '002']));
    expect(text).toMatch(/newer than this image[\s\S]*002[\s\S]*\.\/upgrade\.sh --rollback/);
  });

  it('diverged: says nothing was changed', () => {
    expect(explain(compareVersions(['001', '004'], ['001', '003']))).toMatch(/diverged[\s\S]*nothing was changed/i);
  });
});
