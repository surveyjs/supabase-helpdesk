#!/usr/bin/env node
// Step 2 of the AnswerDesk import: upload the blobs listed in <work>/upload.tsv
// to the `attachments` Storage bucket at `migrated/<FileItems.Id>`, using the
// service-role key. Resumable: finished ids are appended to <work>/uploaded.txt
// and skipped on the next run.
//
//   node scripts/answerdesk/upload-attachments.mjs --work <work dir> \
//        --env <deploy dir>/.env [--url http://127.0.0.1:8000] [--concurrency 4]
//
// The key is read from the env file (SERVICE_ROLE_KEY) or $SERVICE_ROLE_KEY
// and never printed.

import fs from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';

const { values: args } = parseArgs({
  options: {
    work: { type: 'string' },
    env: { type: 'string' },
    url: { type: 'string', default: 'http://127.0.0.1:8000' },
    concurrency: { type: 'string', default: '4' },
  },
});
if (!args.work) {
  console.error('usage: node upload-attachments.mjs --work <work dir> --env <deploy .env> [--url http://127.0.0.1:8000] [--concurrency 4]');
  process.exit(2);
}

function readEnvKey(file, key) {
  if (!file) return undefined;
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && m[1] === key) return m[2].replace(/^(['"])(.*)\1$/, '$2');
  }
  return undefined;
}
const KEY = process.env.SERVICE_ROLE_KEY || readEnvKey(args.env, 'SERVICE_ROLE_KEY');
if (!KEY) throw new Error('SERVICE_ROLE_KEY not found (pass --env <deploy .env> or set $SERVICE_ROLE_KEY)');
const BASE = args.url.replace(/\/$/, '');

const unesc = (s) => s.replace(/\\(.)/g, (_m, c) => ({ t: '\t', n: '\n', r: '\r', '\\': '\\' })[c] ?? c);
const rows = fs.readFileSync(path.join(args.work, 'upload.tsv'), 'utf8').split('\n').filter(Boolean).map((l) => {
  const [id, file, size, mime] = l.split('\t').map(unesc);
  return { id, file, size: Number(size), mime };
});
const doneFile = path.join(args.work, 'uploaded.txt');
const done = new Set(fs.existsSync(doneFile) ? fs.readFileSync(doneFile, 'utf8').split('\n').filter(Boolean) : []);
const todo = rows.filter((r) => !done.has(r.id));
const failFile = path.join(args.work, 'upload-failed.txt');
fs.writeFileSync(failFile, '');
console.log(`blobs: ${rows.length}, already uploaded: ${rows.length - todo.length}, to upload: ${todo.length}`);

let ok = 0;
let failed = 0;
let bytes = 0;
const started = Date.now();

async function uploadOne(r) {
  const body = fs.readFileSync(r.file);
  for (let attempt = 1; attempt <= 4; attempt++) {
    try {
      const res = await fetch(`${BASE}/storage/v1/object/attachments/migrated/${r.id}`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${KEY}`,
          apikey: KEY,
          'Content-Type': r.mime,
          'x-upsert': 'true',
          'cache-control': 'max-age=3600',
        },
        body,
      });
      if (res.ok) return null;
      const text = (await res.text()).slice(0, 200);
      if (res.status < 500 && res.status !== 429) return `HTTP ${res.status} ${text}`;
      if (attempt === 4) return `HTTP ${res.status} ${text}`;
    } catch (e) {
      if (attempt === 4) return String(e?.cause?.code ?? e?.message ?? e);
    }
    await new Promise((r2) => setTimeout(r2, 1000 * attempt));
  }
  return 'unreachable';
}

let next = 0;
async function worker() {
  while (next < todo.length) {
    const r = todo[next++];
    const err = await uploadOne(r);
    if (err) {
      failed++;
      fs.appendFileSync(failFile, `${r.id}\t${r.size}\t${err}\n`);
    } else {
      ok++;
      bytes += r.size;
      fs.appendFileSync(doneFile, `${r.id}\n`);
    }
    const n = ok + failed;
    if (n % 100 === 0 || n === todo.length) {
      const s = (Date.now() - started) / 1000;
      console.log(`  ${n}/${todo.length}  ok=${ok} failed=${failed}  ${(bytes / 1024 / 1024).toFixed(0)} MB  ${(bytes / 1024 / 1024 / s).toFixed(1)} MB/s`);
    }
  }
}
await Promise.all(Array.from({ length: Math.max(1, Number(args.concurrency)) }, worker));
console.log(`done: uploaded ${ok}, failed ${failed}${failed ? ` (see ${failFile})` : ''}`);
process.exit(failed ? 1 : 0);
