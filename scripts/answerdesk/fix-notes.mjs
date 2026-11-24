#!/usr/bin/env node
// List the AnswerDesk staff notes (Posts.Type = 3) so fix-notes.sql can turn
// posts imported before private-tasks#635 back into internal notes.
//
//   node scripts/answerdesk/fix-notes.mjs --pkg <export package> --out <dir>
//
// Writes <dir>/notes.tsv: one source post id per line, nothing else (no
// customer text). Imported posts keep their source ids, so the SQL can match
// them directly.

import fs from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { loadSchema, readTable } from './lib/source.mjs';

const { values: args } = parseArgs({
  options: { pkg: { type: 'string' }, out: { type: 'string' } },
});
if (!args.pkg || !args.out) {
  console.error('Usage: fix-notes.mjs --pkg <export package dir> --out <dir>');
  process.exit(2);
}

const schema = loadSchema(args.pkg);
fs.mkdirSync(args.out, { recursive: true });
const file = path.join(args.out, 'notes.tsv');
const fd = fs.openSync(file, 'w');
let n = 0;
for (const p of readTable(args.pkg, schema, 'Posts')) {
  if (p.Type !== '3') continue;
  fs.writeSync(fd, `${p.Id.toLowerCase()}\n`);
  n++;
}
fs.closeSync(fd);
console.log(`${n} staff notes listed in ${file}`);
