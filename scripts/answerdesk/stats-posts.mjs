#!/usr/bin/env node
// Aggregate-only report on Posts body format and authorship (no content).
//   node scripts/answerdesk/stats-posts.mjs <answerdesk-migration dir>
import { loadSchema, readTable, readAll, stats } from './lib/source.mjs';

const pkg = process.argv[2];
const schema = loadSchema(pkg);
const users = readAll(pkg, schema, 'Users');
const staff = new Set(users.filter((u) => u.IsEmployee === '1').map((u) => u.Id));
for (const r of readAll(pkg, schema, 'UserInRole')) staff.add(r.User_Id);

const markers = {
  'html block tag <p|div|br|ul|li|table|pre>': /<(p|div|br|ul|ol|li|table|pre|h[1-6])\b[^>]*>/i,
  'html entity &nbsp;|&lt;|&amp;': /&(nbsp|lt|gt|amp|quot);/,
  'markdown fence ```': /```/,
  'markdown inline `code`': /`[^`\n]+`/,
  'markdown link [x](y)': /\[[^\]\n]+\]\([^)\s]+\)/,
  'markdown image ![x](y)': /!\[[^\]\n]*\]\([^)\s]+\)/,
  'markdown heading # / **bold**': /(^|\n)#{1,6} |\*\*[^*\n]+\*\*/,
  'leading 4-space code lines': /(^|\n) {4}\S/,
  'contains CR or LF': /[\r\n]/,
  'url to answerdesk/surveyjs ticket': /answerdesk\.io|surveyjs\.io\/(support|answerdesk)/i,
  'guid in text': /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i,
};
const by = new Map();
const get = (k) => { if (!by.has(k)) by.set(k, { n: 0, staff: 0, auto: 0, len: 0, max: 0, over50k: 0, m: Object.fromEntries(Object.keys(markers).map((x) => [x, 0])) }); return by.get(k); };
for (const p of readTable(pkg, schema, 'Posts')) {
  const k = `type=${p.Type} private=${p.IsPrivate}`;
  const s = get(k);
  s.n++;
  if (staff.has(p.Owner)) s.staff++;
  if (p.AutoText) s.auto++;
  s.len += p.Text.length;
  s.max = Math.max(s.max, p.Text.length);
  if (p.Text.length > 50000) s.over50k++;
  for (const [name, re] of Object.entries(markers)) if (re.test(p.Text)) s.m[name]++;
}
for (const [k, s] of [...by].sort()) {
  console.log(`\n${k}: n=${s.n} by-staff=${s.staff} AutoText-set=${s.auto} avg-len=${Math.round(s.len / s.n)} max-len=${s.max} >50k=${s.over50k}`);
  for (const [name, c] of Object.entries(s.m)) console.log(`  ${name.padEnd(45)} ${c}`);
}
console.log(`\nparser: text values containing the delimiter: ${stats.delimiterInText}`);
