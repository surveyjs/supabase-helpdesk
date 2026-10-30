// Migration versions: the image's files vs. the database's history.
// Used by the app's startup check (docker/check-schema.mjs) and by the explicit
// `migrate` command (docker/versions-cli.mjs), so both always agree.

const FILE = /^(\d+)_.+\.sql$/;

/** @param {string[]} fileNames @returns {string[]} */
export function migrationVersions(fileNames) {
  /** @type {Map<string, string>} */
  const seen = new Map();
  for (const name of [...fileNames].sort()) {
    const match = FILE.exec(name);
    if (!match) continue;
    const previous = seen.get(match[1]);
    if (previous) throw new Error(`Duplicate migration version ${match[1]}: ${previous} and ${name}`);
    seen.set(match[1], name);
  }
  return [...seen.keys()].sort();
}

/**
 * @param {string[]} image versions shipped in the image
 * @param {string[]} db versions recorded in supabase_migrations.schema_migrations
 * @returns {{ status: 'ok'|'pending'|'newer'|'diverged', pending: string[], dbOnly: string[] }}
 */
export function compareVersions(image, db) {
  const inDb = new Set(db);
  const inImage = new Set(image);
  const pending = image.filter((v) => !inDb.has(v));
  const dbOnly = db.filter((v) => !inImage.has(v)).sort();
  const status = pending.length && dbOnly.length ? 'diverged'
    : dbOnly.length ? 'newer'
    : pending.length ? 'pending'
    : 'ok';
  return { status, pending, dbOnly };
}

/** @param {ReturnType<typeof compareVersions>} result */
export function explain(result) {
  switch (result.status) {
    case 'ok':
      return 'Database schema matches this image.';
    case 'pending':
      return `Database schema is behind this image. Pending migrations: ${result.pending.join(', ')}.\n`
        + 'Run the migration explicitly: docker compose run --rm migrate';
    case 'newer':
      return `Database schema is newer than this image (applied, unknown here: ${result.dbOnly.join(', ')}).\n`
        + 'An older image cannot run on a newer schema. Roll back the database with the app: ./upgrade.sh --rollback';
    case 'diverged':
      return `Migration history has diverged: pending here ${result.pending.join(', ')}; `
        + `applied but unknown here ${result.dbOnly.join(', ')}.\nNothing was changed; this needs manual investigation.`;
  }
}
