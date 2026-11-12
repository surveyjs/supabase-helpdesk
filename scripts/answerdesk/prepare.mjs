#!/usr/bin/env node
// Step 1 of the AnswerDesk import: read the export package, pick a
// deterministic sample of tickets, transform everything into the target
// shape, and write tab-separated staging files (PostgreSQL COPY text format)
// that load.sql loads into the `adimport` schema.
//
//   node scripts/answerdesk/prepare.mjs --pkg <answerdesk-migration dir> \
//        --out <work dir> --fraction 0.1 --admin-email someone@example.com
//
// Output contains real customer data: keep --out outside the repo.
// The console output and report.txt hold counts only.
//
// Mapping decisions (see MAPPING.md / INSPECTION.md in the package):
//   * Sampling: a ticket is in the sample when md5(ticket id) falls below
//     `fraction`, so a larger fraction is a superset of a smaller one and a
//     re-run with a larger fraction only adds tickets.
//   * Users: all users are staged (cheap; lets every SSO user sign in); their
//     source UUIDs are kept. ExternalLogin rows become `custom:external`
//     identities (provider_id = auth.surveyjs.io subject).
//   * Post bodies are already Markdown in AnswerDesk; they are kept as-is.
//     Inline attachment references `({'Id':'<FileItems.Id>','CheckAnswerDesk':...})`
//     and `/attachment/file/<id>` URLs are rewritten to `/attachments/<attachment id>`.
//   * Posts.Type: 0 = question (original post), 1 = answer (top-level post),
//     2 = comment, 3 = staff comment -> comment. Comments hang off their
//     top-level ancestor (parent_post_id); deeper chains are flattened to two
//     levels (parent_comment_id = the level-1 comment).

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { loadSchema, readTable, readAll, toTs, bit, blobPath, stats as parserStats } from './lib/source.mjs';

const { values: args } = parseArgs({
  options: {
    pkg: { type: 'string' },
    out: { type: 'string' },
    fraction: { type: 'string', default: '0.1' },
    'admin-email': { type: 'string', default: '' },
    'max-file-mb': { type: 'string', default: '50' },
  },
});
if (!args.pkg || !args.out) {
  console.error('usage: node prepare.mjs --pkg <answerdesk-migration dir> --out <work dir> [--fraction 0.1] [--admin-email a@b.c] [--max-file-mb 50]');
  process.exit(2);
}
const PKG = args.pkg;
const OUT = args.out;
const FRACTION = Number(args.fraction);
const ADMIN_EMAIL = args['admin-email'].trim().toLowerCase();
const MAX_FILE = Number(args['max-file-mb']) * 1024 * 1024;
if (!(FRACTION > 0 && FRACTION <= 1)) throw new Error('--fraction must be in (0, 1]');
if (path.resolve(OUT).startsWith(path.resolve(process.cwd())) && fs.existsSync(path.join(process.cwd(), '.git'))) {
  throw new Error('--out must be outside the repository (it will hold customer data)');
}
fs.mkdirSync(OUT, { recursive: true });

const schema = loadSchema(PKG);
const warn = new Map();
const note = (k, n = 1) => warn.set(k, (warn.get(k) ?? 0) + n);

// ---------- COPY text-format writer ----------
const esc = (v) => {
  if (v === null || v === undefined) return '\\N';
  if (typeof v === 'boolean') return v ? 't' : 'f';
  if (typeof v === 'object') v = JSON.stringify(v);
  return String(v).replace(/\\/g, '\\\\').replace(/\t/g, '\\t').replace(/\n/g, '\\n').replace(/\r/g, '\\r');
};
const files = {};
function writer(name) {
  const fd = fs.openSync(path.join(OUT, `${name}.tsv`), 'w');
  files[name] = 0;
  return (...cols) => {
    fs.writeSync(fd, cols.map(esc).join('\t') + '\n');
    files[name]++;
  };
}
// Strip NULs / control chars Postgres text can't hold, normalise newlines.
const clean = (s) => (s ?? '').replace(/\u0000/g, '').replace(/\r\n?/g, '\n');
const cut = (s, n) => (s.length > n ? s.slice(0, n) : s);

// ---------- Sampling ----------
const inSample = (id) => {
  if (FRACTION >= 1) return true;
  const h = crypto.createHash('md5').update(id).digest();
  return h.readUInt32BE(0) / 0x100000000 < FRACTION;
};

// ---------- Users ----------
const users = readAll(PKG, schema, 'Users');
const userById = new Map(users.map((u) => [u.Id, u]));
const staff = new Set(users.filter((u) => bit(u.IsEmployee)).map((u) => u.Id));
for (const r of readAll(PKG, schema, 'UserInRole')) if (r.User_Id) staff.add(r.User_Id);
const externalLogins = readAll(PKG, schema, 'ExternalLogin');
const ssoUsers = new Set(externalLogins.map((e) => e.User_Id));

const wUsers = writer('users');
const wIdent = writer('identities');
let adminFound = false;
for (const u of users) {
  const email = u.Email.trim().toLowerCase();
  let name = clean(u.PublicName).trim();
  if (!name) name = clean([u.FirstName, u.LastName].filter(Boolean).join(' ')).trim();
  if (!name) name = email.split('@')[0];
  name = cut(name.replace(/\s+/g, ' '), 100);
  if (name.startsWith('Deleted User #')) { name = cut(`User ${name}`, 100); note('display name started with reserved "Deleted User #"'); }
  let role = staff.has(u.Id) ? 'agent' : 'user';
  if (ADMIN_EMAIL && email === ADMIN_EMAIL) { role = 'admin'; adminFound = true; }
  const created = toTs(u.RegisterDate);
  wUsers(u.Id, email, name, role, bit(u.IsDisabled), created, ssoUsers.has(u.Id));
  // email identity (what GoTrue itself creates for an email user)
  wIdent(u.Id, 'email', u.Id, email, created);
}
if (ADMIN_EMAIL && !adminFound) note('--admin-email not found among source users');
for (const e of externalLogins) {
  const u = userById.get(e.User_Id);
  if (!u) { note('ExternalLogin row for unknown user'); continue; }
  wIdent(e.User_Id, 'custom:external', e.UserId.trim().toLowerCase(), u.Email.trim().toLowerCase(), toTs(u.RegisterDate));
}

// ---------- Reference data ----------
const cats = readAll(PKG, schema, 'Categories');
const catById = new Map(cats.map((c) => [c.Id, c]));
const catName = (c, depth = 0) => {
  const own = clean(c.Name).trim();
  const parent = c.ParentId && depth < 5 ? catById.get(c.ParentId) : null;
  return parent ? `${catName(parent, depth + 1)} / ${own}` : own;
};
const wCats = writer('categories');
const usedCat = new Set();
for (const c of cats) {
  let n = cut(catName(c), 100);
  if (usedCat.has(n)) n = cut(`${n} (${c.Id})`, 100);
  usedCat.add(n);
  wCats(Number(c.Id), n);
}
const wTypes = writer('ticket_types');
for (const t of readAll(PKG, schema, 'EntityTypes')) wTypes(Number(t.Id), cut(clean(t.DisplayName).trim(), 100), bit(t.IsDefault));
const wTags = writer('tags');
for (const t of readAll(PKG, schema, 'Tags')) wTags(Number(t.Id), cut(clean(t.Name).trim(), 50));

const CF_LICENSE_STATUS = 'License Status';
const CF_LICENSE_OWNER = 'Is License Owner';
const wCf = writer('custom_fields');
wCf(CF_LICENSE_STATUS, 'dropdown', JSON.stringify(['Licensed', 'Unlicensed', 'Enterprise']), 1);
wCf(CF_LICENSE_OWNER, 'checkbox', null, 2);

// ---------- Tickets ----------
const tickets = readAll(PKG, schema, 'Tickets').filter((t) => inSample(t.Id));
const ticketIds = new Set(tickets.map((t) => t.Id));
const props = new Map();
for (const p of readTable(PKG, schema, 'TicketProperties')) {
  if (!ticketIds.has(p.Ticket_Id)) continue;
  if (!props.has(p.Ticket_Id)) props.set(p.Ticket_Id, {});
  props.get(p.Ticket_Id)[p.Name] = p.Value;
}

// ---------- Posts (sampled tickets only) ----------
const posts = new Map();
for (const p of readTable(PKG, schema, 'Posts')) if (ticketIds.has(p.Ticket_Id)) posts.set(p.Id, p);
const lastPostAt = new Map();
for (const p of posts.values()) {
  const ts = toTs(p.Created);
  if (!lastPostAt.has(p.Ticket_Id) || lastPostAt.get(p.Ticket_Id) < ts) lastPostAt.set(p.Ticket_Id, ts);
}

const wTickets = writer('tickets');
const STATUS = { Active: 'open', Closed: 'closed' };
const SEVERITY = { Severe: 'critical', Moderate: 'medium', Minor: 'low' };
for (const t of tickets) {
  const pr = props.get(t.Id) ?? {};
  if (!userById.has(t.Owner)) { note('ticket skipped: owner not in Users'); continue; }
  let title = clean(t.Subject).replace(/\s+/g, ' ').trim() || '(no subject)';
  title = cut(title, 300);
  let status = STATUS[pr.TicketStatus];
  if (!status) { status = bit(t.IsArchived) ? 'closed' : 'open'; note(`ticket status missing/unknown -> ${status}`); }
  const urgency = pr.Urgent ? 'high' : 'medium';
  const severity = SEVERITY[pr.Severity] ?? 'medium';
  const cf = {};
  if (pr.LicenseStatus && ['Licensed', 'Unlicensed', 'Enterprise'].includes(pr.LicenseStatus)) cf[CF_LICENSE_STATUS] = pr.LicenseStatus;
  if (pr.TF100002 === 'True') cf[CF_LICENSE_OWNER] = true;
  const assignee = pr.Assignee && userById.has(pr.Assignee.toLowerCase()) ? pr.Assignee.toLowerCase() : null;
  const created = toTs(t.Created);
  const updated = [created, toTs(t.Modified), toTs(t.Updated), lastPostAt.get(t.Id)].filter(Boolean).sort().at(-1);
  const guid = (v) => (v && /^[0-9a-f-]{36}$/i.test(v) ? v.toLowerCase() : null);
  wTickets(t.Id, title, status, urgency, severity, bit(t.IsPrivate), t.EntityType ? Number(t.EntityType) : null,
    pr.Category && /^\d+$/.test(pr.Category) ? Number(pr.Category) : null,
    t.Owner, assignee, guid(pr.Duplicate), guid(pr.ClonedFrom), cf, created, updated);
}

// ---------- Attachments ----------
const fileItems = new Map(readAll(PKG, schema, 'FileItems').map((f) => [f.Id, f]));
const attRows = readAll(PKG, schema, 'Attachments').filter((a) => a.Post_Id && posts.has(a.Post_Id));
// (post, file) -> attachment id that will exist in the target
const attFor = new Map();
const attAnyPost = new Map();
const wAtt = writer('attachments');
const wUpload = writer('upload');
const uploaded = new Set();
let uploadBytes = 0;
const MIME = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', bmp: 'image/bmp',
  svg: 'image/svg+xml', ico: 'image/x-icon', pdf: 'application/pdf', doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', xls: 'application/vnd.ms-excel',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', ppt: 'application/vnd.ms-powerpoint',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation', txt: 'text/plain', log: 'text/plain',
  csv: 'text/csv', md: 'text/markdown', json: 'application/json', xml: 'application/xml', html: 'text/html', htm: 'text/html',
  js: 'text/javascript', ts: 'text/plain', css: 'text/css', zip: 'application/zip', rar: 'application/vnd.rar',
  '7z': 'application/x-7z-compressed', gz: 'application/gzip', mp4: 'video/mp4', webm: 'video/webm', mov: 'video/quicktime',
  avi: 'video/x-msvideo', gif89: 'image/gif',
};
const mimeOf = (name) => {
  const m = name.toLowerCase().match(/\.([a-z0-9]+)$/);
  return (m && MIME[m[1]]) || 'application/octet-stream';
};
const seenPair = new Set();
for (const a of attRows) {
  const f = fileItems.get(a.Attachment_Id);
  if (!f) { note('attachment skipped: FileItems row missing'); continue; }
  if (f.ScanStatus === '1') { note('attachment skipped: infected (ScanStatus=1)'); continue; }
  const pair = `${a.Post_Id}|${f.Id}`;
  if (seenPair.has(pair)) { note('attachment skipped: duplicate (post, file)'); continue; }
  const bp = blobPath(PKG, f.Id);
  let size;
  try { size = fs.statSync(bp).size; } catch { note('attachment skipped: blob missing on disk'); continue; }
  if (size > MAX_FILE) { note(`attachment skipped: larger than ${args['max-file-mb']} MB`); continue; }
  seenPair.add(pair);
  const post = posts.get(a.Post_Id);
  const fname = cut(clean(f.Name).trim() || `file-${f.Id}`, 255);
  const uploader = f.Owner && userById.has(f.Owner) ? f.Owner : post.Owner;
  const mime = mimeOf(fname);
  wAtt(a.Id, a.Post_Id, uploader, f.Id, fname, size, mime, toTs(post.Created));
  if (!uploaded.has(f.Id)) { uploaded.add(f.Id); uploadBytes += size; wUpload(f.Id, bp, size, mime); }
  attFor.set(pair, a.Id);
  if (!attAnyPost.has(f.Id)) attAnyPost.set(f.Id, a.Id);
}

// ---------- Posts -> target ----------
const wPosts = writer('posts');
const kindOf = (p) => (p.Type === '0' ? 'original' : p.Type === '1' || !p.Parent_Id || !posts.has(p.Parent_Id) ? 'root' : 'comment');
const INLINE_MD = /(!?)\[([^\]\n]*)\]\(\s*<?\{'Id':'([0-9a-fA-F-]{36})','CheckAnswerDesk':'[0-9a-fA-F-]{36}'\}>?\s*\)/g;
const INLINE_BARE = /\{'Id':'([0-9a-fA-F-]{36})','CheckAnswerDesk':'[0-9a-fA-F-]{36}'\}/g;
const LEGACY_URL = /(?:https?:\/\/[^\s/)"'>]+)?\/attachment\/file\/([0-9a-fA-F-]{36})/g;
const resolveAtt = (postId, fileId) => {
  const id = fileId.toLowerCase();
  return attFor.get(`${postId}|${id}`) ?? attAnyPost.get(id) ?? null;
};
for (const p of posts.values()) {
  const kind = kindOf(p);
  if (!userById.has(p.Owner)) { note('post skipped: author not in Users'); continue; }
  let parentPost = null;
  let parentComment = null;
  if (kind === 'comment') {
    // Walk up to the top-level ancestor; remember the comment right below it.
    const chain = [];
    let cur = posts.get(p.Parent_Id);
    const seen = new Set([p.Id]);
    while (cur && kindOf(cur) === 'comment' && !seen.has(cur.Id)) {
      seen.add(cur.Id);
      chain.push(cur);
      cur = posts.get(cur.Parent_Id);
    }
    if (!cur || seen.has(cur.Id)) { note('comment re-parented to ticket root: broken parent chain'); }
    parentPost = cur && !seen.has(cur.Id) ? cur.Id : null;
    if (chain.length > 0) parentComment = chain.at(-1).Id;
    if (chain.length > 1) note('comment flattened from depth > 3');
    if (!parentPost) { parentComment = null; }
  }
  let body = clean(p.Text);
  body = body.replace(INLINE_MD, (_m, bang, label, fid) => {
    const att = resolveAtt(p.Id, fid);
    if (att) { note('inline attachment reference rewritten'); return `${bang}[${label}](/attachments/${att})`; }
    note('inline attachment reference not migrated (file missing/skipped)');
    return `${label || 'attachment'} _(attachment not migrated)_`;
  });
  body = body.replace(INLINE_BARE, (_m, fid) => {
    const att = resolveAtt(p.Id, fid);
    note(att ? 'inline attachment reference rewritten' : 'inline attachment reference not migrated (file missing/skipped)');
    return att ? `/attachments/${att}` : '(attachment not migrated)';
  });
  body = body.replace(LEGACY_URL, (m, fid) => {
    const att = resolveAtt(p.Id, fid);
    note(att ? 'legacy /attachment/file URL rewritten' : 'legacy /attachment/file URL left as-is');
    return att ? `/attachments/${att}` : m;
  });
  if (!body.trim()) { body = '_(empty post)_'; note('post body empty'); }
  if (body.length > 50000) { body = body.slice(0, 49900) + '\n\n_(truncated during migration)_'; note('post body truncated to 50k chars'); }
  const created = toTs(p.Created);
  const modified = toTs(p.Modified);
  const edited = modified && Date.parse(modified) - Date.parse(created) > 1000 ? modified : null;
  const postType = kind === 'comment' && parentPost ? 'comment' : 'post';
  wPosts(p.Id, p.Ticket_Id, p.Owner, postType === 'comment' ? parentPost : null, postType === 'comment' ? parentComment : null,
    postType, body, bit(p.IsPrivate), kind === 'original', edited, created);
}

// ---------- Tags, followers, CSAT ----------
const wTicketTags = writer('ticket_tags');
for (const r of readTable(PKG, schema, 'TicketTags')) if (r.Tickets && ticketIds.has(r.Tickets) && r.Tags) wTicketTags(r.Tickets, Number(r.Tags));
const ownerOf = new Map(tickets.map((t) => [t.Id, t.Owner]));
const wFollow = writer('followers');
const seenFollow = new Set();
for (const f of readTable(PKG, schema, 'Favorites')) {
  if (!ticketIds.has(f.Ticket_Id) || !userById.has(f.User_Id) || ownerOf.get(f.Ticket_Id) === f.User_Id) continue;
  const k = `${f.Ticket_Id}|${f.User_Id}`;
  if (seenFollow.has(k)) continue;
  seenFollow.add(k);
  wFollow(f.Ticket_Id, f.User_Id);
}
const latestFeedback = new Map();
for (const f of readTable(PKG, schema, 'Feedbacks')) {
  if (!f.Ticket_Id || !ticketIds.has(f.Ticket_Id)) continue;
  const r = Number(f.Satisfaction);
  if (!(r >= 1 && r <= 5)) { note('feedback skipped: rating outside 1..5'); continue; }
  const prev = latestFeedback.get(f.Ticket_Id);
  if (!prev || (f.Created ?? '') > (prev.Created ?? '')) latestFeedback.set(f.Ticket_Id, f);
}
const wCsat = writer('csat');
for (const f of latestFeedback.values()) {
  wCsat(f.Ticket_Id, Number(f.Satisfaction), f.Message ? cut(clean(f.Message), 5000) : null, toTs(f.Created) ?? toTs(tickets.find((t) => t.Id === f.Ticket_Id).Created));
}

// ---------- Report ----------
const totalBytes = uploadBytes;
const report = [
  `prepared ${new Date().toISOString()}  fraction=${FRACTION}`,
  `sampled tickets: ${tickets.length} of ${readAll(PKG, schema, 'Tickets').length}`,
  '',
  'staging rows:',
  ...Object.entries(files).map(([k, v]) => `  ${k.padEnd(16)} ${v}`),
  `  blobs to upload  ${files.upload} (${(totalBytes / 1024 / 1024).toFixed(1)} MB)`,
  '',
  'notes:',
  ...[...warn].sort().map(([k, v]) => `  ${String(v).padStart(7)}  ${k}`),
  `  parser: text values containing the |@| delimiter: ${parserStats.delimiterInText}`,
];
fs.writeFileSync(path.join(OUT, 'report.txt'), report.join('\n') + '\n');
fs.writeFileSync(path.join(OUT, 'manifest.json'), JSON.stringify({ fraction: FRACTION, preparedAt: new Date().toISOString(), files }, null, 2));
console.log(report.join('\n'));
