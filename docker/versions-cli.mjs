// Glue for docker/migrate.sh: reads the database's applied versions (one per
// line) on stdin and prints shell assignments (status, image, db, pending,
// dbonly) for `eval`. Versions are validated as digits, so eval is safe.
import { readFileSync, readdirSync } from 'node:fs';
import { compareVersions, migrationVersions } from './lib/versions.mjs';

const image = migrationVersions(readdirSync(process.argv[2]));
const db = readFileSync(0, 'utf8').split(/\s+/).filter(Boolean);
const bad = db.filter((v) => !/^\d+$/.test(v));
if (bad.length) {
  console.error(`[migrate] unexpected versions in supabase_migrations.schema_migrations: ${bad.join(', ')}`);
  process.exit(1);
}
const { status, pending, dbOnly } = compareVersions(image, db);
const vars = { status, image: image.join(' '), db: db.join(' '), pending: pending.join(' '), dbonly: dbOnly.join(' ') };
for (const [key, value] of Object.entries(vars)) console.log(`${key}='${value}'`);
