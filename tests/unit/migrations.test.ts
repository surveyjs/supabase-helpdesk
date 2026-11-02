import { readdirSync } from 'node:fs';
import { describe, it, expect } from 'vitest';
import { migrationVersions } from '@/lib/deploy/versions.mjs';

// The Supabase CLI identifies a migration by its numeric prefix only: a second
// file with a used prefix is skipped in production without any error.
const files = readdirSync('supabase/migrations');

describe('supabase/migrations', () => {
  it('every migration has a unique version', () => {
    expect(() => migrationVersions(files)).not.toThrow();
  });

  it('no .sql file is silently ignored', () => {
    expect(files.filter((f) => f.endsWith('.sql') && !/^\d+_.+\.sql$/.test(f))).toEqual([]);
  });
});
