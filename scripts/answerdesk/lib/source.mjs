// Reader for the AnswerDesk export package (see HANDOFF.md in the package).
//
// CSVs were produced by `bcp ... queryout -c -t"|@|" -r"\n" -C 65001` from
// `SELECT * FROM <table>`, so:
//   * field delimiter `|@|`, no header, no quoting/escaping, NULL = empty field;
//   * records end with CRLF (bcp on Windows), but text fields may contain
//     embedded CR/LF too, so records are cut by field count, not by line;
//   * column order = the table's column order in source-schema.sql.

import fs from 'node:fs';
import path from 'node:path';

const SCHEMA_NAME = 'e7b3a05f-0afb-4eb6-b170-4b987807c7a2';
const DELIM = '|@|';

/** Parser counters (e.g. text values that contained the delimiter). */
export const stats = { delimiterInText: 0 };

/** Parses source-schema.sql (UTF-16 LE) into { [table]: [{ name, type }] }. */
export function loadSchema(pkgDir) {
  const buf = fs.readFileSync(path.join(pkgDir, 'source-schema.sql'));
  const text = buf[0] === 0xff && buf[1] === 0xfe ? buf.toString('utf16le').slice(1) : buf.toString('utf16le');
  const tables = {};
  const re = new RegExp(String.raw`CREATE TABLE \[${SCHEMA_NAME}\]\.\[(\w+)\]\(([\s\S]*?)\n\)`, 'g');
  for (const m of text.matchAll(re)) {
    const cols = [];
    for (const line of m[2].split('\n')) {
      const c = line.match(/^\s*\[([^\]]+)\]\s+\[(\w+)\]/);
      if (c && !/^\s*CONSTRAINT/.test(line)) cols.push({ name: c[1], type: c[2].toLowerCase() });
    }
    tables[m[1]] = cols;
  }
  return tables;
}

const UUID_RE = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
const INT_RE = /^-?\d+$/;

const DT_RE = /^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d(\.\d+)?$/;
const TEXT_TYPES = new Set(['nvarchar', 'varchar', 'nchar', 'char', 'ntext', 'text']);

function validatorFor(type) {
  if (type === 'uniqueidentifier') return (v) => v === '' || UUID_RE.test(v);
  if (['int', 'bigint', 'smallint', 'tinyint', 'bit'].includes(type)) return (v) => v === '' || INT_RE.test(v);
  if (['datetime', 'datetime2', 'smalldatetime', 'date'].includes(type)) return (v) => v === '' || DT_RE.test(v);
  return null;
}

/**
 * Yields one object per record of `<pkgDir>/source-data/<table>.csv`, keyed by
 * column name. Values are raw strings; '' means NULL. GUIDs are lowercased.
 */
export function* readTable(pkgDir, schema, table) {
  const cols = schema[table];
  if (!cols) throw new Error(`Table ${table} not found in source-schema.sql`);
  const file = path.join(pkgDir, 'source-data', `${table}.csv`);
  let text = fs.readFileSync(file, 'utf8');
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  const n = cols.length;
  const firstValid = validatorFor(cols[0].type) ?? (() => true);
  const checks = cols.map((c) => validatorFor(c.type));

  const pieces = text.split(DELIM);
  // pieces[0] = first field of record 1. Between records, one piece holds
  // "<last field>\r\n<first field of next record>".
  let carry = pieces[0];
  let idx = 1;
  let recNo = 0;
  // Splits "<last field>\r\n<next record's first field>" -> [last, next|null].
  const splitBoundary = (s) => {
    let from = 0;
    while (true) {
      const p = s.indexOf('\r\n', from);
      if (p < 0) return [s, null];
      const rest = s.slice(p + 2);
      if (firstValid(rest) && !rest.includes('\n')) return [s.slice(0, p), rest];
      from = p + 2;
    }
  };

  while (true) {
    if (idx >= pieces.length) {
      if (carry.replace(/[\r\n]/g, '') === '') return; // trailing newline
      throw new Error(`${table}: truncated final record #${recNo + 1}`);
    }
    const fields = [carry];
    let lastText = TEXT_TYPES.has(cols[0].type) ? 0 : -1;
    let next = null;
    // A text value that itself contains `|@|` shows up as a typed column that
    // fails validation (or a last field with no record boundary): fold the
    // stray piece back into the preceding text column and continue.
    while (fields.length < n) {
      const i = fields.length;
      if (idx >= pieces.length) throw new Error(`${table}: truncated record #${recNo + 1} (${i}/${n} fields)`);
      const piece = pieces[idx++];
      let v = piece;
      let rest = null;
      if (i === n - 1) {
        [v, rest] = splitBoundary(piece);
        if (rest === null) {
          if (idx < pieces.length) v = null; // no boundary but data follows: misaligned
          else v = piece.replace(/\r?\n$/, ''); // end of file
        }
      }
      const bad = v === null || (checks[i] && !checks[i](v));
      if (bad) {
        const target = v === null && TEXT_TYPES.has(cols[i].type) ? i : lastText;
        if (target < 0) throw new Error(`${table}: record #${recNo + 1} column ${cols[i].name} is misaligned`);
        if (target === i) {
          // Last column is text containing `|@|`: glue the next piece on and retry.
          pieces[idx] = piece + DELIM + pieces[idx];
          continue;
        }
        const tail = fields.splice(target + 1);
        fields[target] = [fields[target], ...tail, piece].join(DELIM);
        stats.delimiterInText++;
        continue;
      }
      fields.push(v);
      if (TEXT_TYPES.has(cols[i].type)) lastText = i;
      if (i === n - 1) next = rest;
    }
    carry = next;
    recNo++;

    const row = {};
    for (let i = 0; i < n; i++) {
      let v = fields[i];
      if (checks[i] && !checks[i](v)) {
        throw new Error(`${table}: record #${recNo} column ${cols[i].name} has an unexpected value shape (misaligned parse?)`);
      }
      if (cols[i].type === 'uniqueidentifier') v = v.toLowerCase();
      row[cols[i].name] = v;
    }
    yield row;
    if (carry === null) return;
  }
}

export function readAll(pkgDir, schema, table) {
  return Array.from(readTable(pkgDir, schema, table));
}

/** bcp datetime "2015-03-04 12:34:56.123" (assumed UTC) -> ISO string, or null. */
export function toTs(v) {
  if (!v) return null;
  return v.replace(' ', 'T') + 'Z';
}

export const bit = (v) => v === '1';

/** Blob path for a FileItems.Id inside the package. */
export function blobPath(pkgDir, fileId) {
  return path.join(pkgDir, 'source-data', 'files', fileId.slice(0, 2), fileId.slice(0, 4), `${fileId}.dat`);
}
