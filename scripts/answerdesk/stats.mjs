#!/usr/bin/env node
// Aggregate-only report on the AnswerDesk export: record counts and value
// distributions of enum-like columns. Prints NO row content (no names, emails,
// subjects or bodies), so its output is safe to share.
//
//   node scripts/answerdesk/stats.mjs <answerdesk-migration dir>

import { loadSchema, readTable, readAll } from './lib/source.mjs';

const pkg = process.argv[2];
if (!pkg) {
  console.error('usage: node stats.mjs <answerdesk-migration dir>');
  process.exit(2);
}
const schema = loadSchema(pkg);

const count = (it) => { let n = 0; for (const _ of it) n++; return n; };
const tally = (m, k) => m.set(k, (m.get(k) ?? 0) + 1);
const show = (title, m) => {
  console.log(`\n${title}`);
  for (const [k, v] of [...m].sort((a, b) => b[1] - a[1])) console.log(`  ${String(k).padEnd(40)} ${v}`);
};

for (const t of ['Users', 'ExternalLogin', 'UserInRole', 'Tickets', 'TicketProperties', 'Attachments', 'FileItems', 'TicketTags', 'Favorites', 'Feedbacks', 'UserNotificationAddresses', 'DraftPosts', 'EditorTemplates']) {
  console.log(`${t.padEnd(28)} ${count(readTable(pkg, schema, t))}`);
}

// Users: email duplicates (case-insensitive) and shape problems.
const users = readAll(pkg, schema, 'Users');
const byEmail = new Map();
let badEmail = 0;
for (const u of users) {
  const e = u.Email.trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+$/.test(e)) badEmail++;
  tally(byEmail, e);
}
console.log(`\nUsers: ${users.length}, distinct lowercase emails ${byEmail.size}, emails shared by >1 user ${[...byEmail.values()].filter((n) => n > 1).length}, malformed emails ${badEmail}`);
console.log(`Users: IsEmployee=1 ${users.filter((u) => u.IsEmployee === '1').length}, IsDisabled=1 ${users.filter((u) => u.IsDisabled === '1').length}, SupportNotification=0 ${users.filter((u) => u.SupportNotification === '0').length}`);
const userIds = new Set(users.map((u) => u.Id));
const ext = readAll(pkg, schema, 'ExternalLogin');
const extPerUser = new Map();
for (const e of ext) tally(extPerUser, e.User_Id);
const extSub = new Map();
for (const e of ext) tally(extSub, e.UserId.toLowerCase());
console.log(`ExternalLogin: users with >1 login ${[...extPerUser.values()].filter((n) => n > 1).length}, subs used by >1 row ${[...extSub.values()].filter((n) => n > 1).length}, rows whose user is missing ${ext.filter((e) => !userIds.has(e.User_Id)).length}`);

// Posts: type x parent x privacy x text presence, and depth.
const posts = new Map();
for (const p of readTable(pkg, schema, 'Posts')) {
  posts.set(p.Id, { type: p.Type, parent: p.Parent_Id, ticket: p.Ticket_Id, priv: p.IsPrivate, hasText: p.Text !== '', hasAuto: p.AutoText !== '', owner: p.Owner, html: /<[a-z][^>]*>/i.test(p.Text), img: /<img\b/i.test(p.Text) });
}
console.log(`\nPosts: ${posts.size}`);
const combo = new Map();
const parentType = new Map();
const depthBy = new Map();
const misc = new Map();
for (const [, p] of posts) {
  tally(combo, `type=${p.type} parent=${p.parent ? 'Y' : 'N'} private=${p.priv}`);
  if (p.parent) {
    const par = posts.get(p.parent);
    tally(parentType, `type=${p.type} -> parent type=${par ? par.type : 'MISSING'}${par && par.ticket !== p.ticket ? ' (other ticket!)' : ''}`);
  }
  let d = 1;
  let c = p;
  const seen = new Set();
  while (c.parent && posts.has(c.parent) && !seen.has(c.parent) && d < 50) { seen.add(c.parent); c = posts.get(c.parent); d++; }
  tally(depthBy, `type=${p.type} depth=${d}`);
  if (!p.hasText) tally(misc, `type=${p.type} empty Text (AutoText ${p.hasAuto ? 'set' : 'empty'})`);
  if (!p.owner) tally(misc, `type=${p.type} no Owner`);
  else if (!userIds.has(p.owner)) tally(misc, `type=${p.type} Owner not in Users`);
  if (p.html) tally(misc, `type=${p.type} Text looks like HTML`);
  if (p.img) tally(misc, `type=${p.type} Text has <img>`);
}
show('Posts by type/parent/private', combo);
show('Replies by parent type', parentType);
show('Posts by type/depth', depthBy);
show('Posts misc', misc);

const typeZeroPerTicket = new Map();
for (const [, p] of posts) if (p.type === '0') tally(typeZeroPerTicket, p.ticket);
const tickets = readAll(pkg, schema, 'Tickets');
const z = new Map();
for (const t of tickets) tally(z, `type-0 posts per ticket = ${typeZeroPerTicket.get(t.Id) ?? 0}`);
show('Tickets by number of type-0 posts', z);
const tm = new Map();
for (const t of tickets) {
  tally(tm, `EntityType=${t.EntityType || 'NULL'} IsPrivate=${t.IsPrivate} IsArchived=${t.IsArchived || 'NULL'}`);
  if (!userIds.has(t.Owner)) tally(tm, 'Owner not in Users');
}
show('Tickets', tm);

// <img src> host patterns (host + path prefix only).
const hosts = new Map();
for (const p of readTable(pkg, schema, 'Posts')) {
  for (const m of p.Text.matchAll(/<img\b[^>]*?\bsrc\s*=\s*["']?([^"'\s>]+)/gi)) {
    const src = m[1];
    let key;
    if (/^data:/i.test(src)) key = 'data: URI';
    else {
      const u = src.match(/^(https?:)?\/\/([^/]+)(\/[^/?#]*)?/i);
      key = u ? `${u[2].toLowerCase()}${(u[3] ?? '').replace(/[0-9a-f-]{36}/gi, '{guid}')}` : `relative ${src.split(/[/?#]/).slice(0, 2).join('/').replace(/[0-9a-f-]{36}/gi, '{guid}')}`;
    }
    tally(hosts, key);
  }
}
show('<img src> host + first path segment (top 25)', new Map([...hosts].sort((a, b) => b[1] - a[1]).slice(0, 25)));
