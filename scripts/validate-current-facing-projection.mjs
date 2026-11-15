import { readFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { execFileSync } from 'node:child_process';
const root = resolve(process.argv[2] || 'public');
const baseline = process.argv[3];
const read = f => readFileSync(join(root, f), 'utf8');
const record = JSON.parse(read('api/current-record.json'));
const date = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Toronto', month: 'long', day: 'numeric', year: 'numeric' }).format(new Date(record.observed_at));
const pages = ['index.html', 'vip10/index.html', 'growth-guys-discount-code/index.html', 'does-vip10-work/index.html', 'how-we-verify/index.html', 'verification-archive/index.html'];
const selectors = /current-record-refresh|verification-record-summary|current-verification-banner|search-evidence-module|verification-artifact|ledger-section/;
function assert(ok, message) { if (!ok) throw new Error(message); }
for (const file of pages) {
  const html = read(file);
  const head = html.split('</head>')[0];
  assert(head.includes(date) && head.includes(record.record_reference), file + ': current metadata missing');
  assert(!/(?:October \d+|November (?!15\b)\d+), 2026/.test(head), file + ': stale current metadata');
  for (const tag of head.match(/<meta\b[^>]*>/g) || []) {
    if (/(?:name|property)="(?:description|og:description|twitter:description)"/.test(tag)) {
      for (const field of [record.product_name, record.total_cad, date]) assert(tag.includes(field), file + ': metadata field missing ' + field);
    }
  }
  for (const block of html.match(/<section\b[^>]*>[\s\S]*?<\/section>/g) || []) {
    if (!selectors.test(block.split('>')[0])) continue;
    assert(block.includes(date), file + ': stale current module date');
    assert(block.includes(record.record_url), file + ': stale current record link');
    assert(!/October \d+, 2026|November (?!15\b)\d+, 2026|32\.40|36\.00|45\.00|BPC-157/.test(block), file + ': stale current module field');
    if (/current-record-refresh|verification-record-summary|search-evidence-module/.test(block.split('>')[0])) {
      assert(block.includes(record.total_cad), file + ': current total missing');
    }
  }
  if (baseline) {
    const old = execFileSync('git', ['show', baseline + ':public/' + file], { encoding: 'utf8' });
    for (const pattern of [/<tr\b[\s\S]*?<\/tr>/g, /<section class="historical-record-refresh"[\s\S]*?<\/section>/g, /<div class="verification-calendar"[\s\S]*?<\/div><\/div>/g]) {
      assert(JSON.stringify(html.match(pattern)) === JSON.stringify(old.match(pattern)), file + ': historical region changed');
    }
  }
}
if (baseline) {
  const changed = execFileSync('git', ['diff', '--name-only', baseline], { encoding: 'utf8' }).trim().split('\n');
  assert(!changed.some(f => /^public\/(?:api\/|owner-records\/|owner-publication-state|evidence\/|verification-feed|feed\.xml|verification-archive\/[^/]+\/)/.test(f)), 'accepted data, evidence or history changed');
}
console.log(JSON.stringify({ currentFacingPages: pages.length, record: record.record_reference, observedAt: record.observed_at, displayDate: date, product: record.product_name, subtotal: record.subtotal_cad, discount: record.discount_cad, total: record.total_cad, historyPreserved: Boolean(baseline) }));
