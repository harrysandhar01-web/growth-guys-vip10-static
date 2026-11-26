import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { validateCheckoutPackage } from './validate-checkout-evidence.mjs';

const configs = { vip10: { code: 'VIP10', domain: 'growthguysvip10.ca', route: 'vip10' }, growth10: { code: 'GROWTH10', domain: 'growthguysgrowth10.ca', route: 'growth10' } };
const profile = process.env.SITE_PROFILE, cfg = configs[profile];
if (!cfg) throw new Error('unknown_site_profile');
const previewIndex = process.argv.indexOf('--preview');
const preview = previewIndex !== -1;
const sourceRoot = process.cwd();
let root = sourceRoot;
if (preview) {
  root = path.resolve(process.argv[previewIndex + 1] || '');
  if (root === sourceRoot || root.startsWith(path.join(sourceRoot, 'public'))) throw new Error('preview_must_use_separate_private_directory');
} else {
  if (process.env.GITHUB_ACTIONS !== 'true' || process.env.GITHUB_ACTOR !== 'harrysandhar01-web' || process.env.OWNER_CONFIRMED !== 'true' || !/^\d+$/.test(process.env.GITHUB_RUN_ID || '')) throw new Error('real_GitHub_owner_confirmation_required');
  if (!String(process.env.OWNER_REASON || '').trim()) throw new Error('owner_reason_required');
}
const packageInput = process.env.EVIDENCE_PACKAGE;
const validation = validateCheckoutPackage(packageInput, profile);
const candidate = JSON.parse(fs.readFileSync(packageInput, 'utf8'));
const previous = JSON.parse(fs.readFileSync('public/api/current-record.json', 'utf8'));
const now = new Date().toISOString();
const runId = preview ? '0' : process.env.GITHUB_RUN_ID;
const id = `${profile}-owner-${candidate.observed_at.replace(/[-:TZ.]/g, '').slice(0,14)}-${runId}`;
const recordUrl = `/owner-records/${id}/`;
const candidateFolder = path.relative(path.resolve('public'), path.dirname(path.resolve(packageInput)));
if (candidateFolder.startsWith('..') || path.isAbsolute(candidateFolder) || !/^evidence\/[a-zA-Z0-9_.\/-]+$/.test(candidateFolder)) throw new Error('candidate_must_be_same_site_evidence');
const evidenceUrl = '/' + candidateFolder + '/' + candidate.original_screenshot.path;
const excerptUrl = '/' + candidateFolder + '/' + candidate.source_excerpt.path;
const record = {
  version: '1.1', status: 'Verified at checkout', code: cfg.code,
  record_reference: id, record_url: recordUrl,
  canonical_url: `https://${cfg.domain}/${cfg.route}/#current-record`,
  observed_at: candidate.observed_at, observed_timezone: 'America/Toronto',
  observed_time_precision: 'milliseconds', timestamp_precision: 'milliseconds',
  timestamp_uncertainty: candidate.timestamp_uncertainty,
  published_at: now, method: 'Automated laptop checkout verification',
  run_type: 'automated', browser_route: candidate.browser_route, observation_type: 'checkout',
  scope: 'Automated verification stopped at the checkout/payment screen. No personal, contact, identity, address or payment details were entered, and no order or payment was submitted.',
  product: candidate.product, product_name: candidate.product, product_url: candidate.product_url,
  quantity: 1, currency: 'CAD', cart_subtotal: candidate.subtotal, subtotal_cad: candidate.subtotal,
  discount_amount: candidate.discount, discount_cad: candidate.discount, discount_percent: 10,
  shipping_cad: candidate.shipping, currency_fee_discount_cad: candidate.currency_fee_discount,
  bitcoin_adjustment_cad: '0.00', observed_total: candidate.total, total_cad: candidate.total,
  charge_usd: candidate.charge_usd, tax_cad: null, tax_scope: candidate.tax_scope,
  payment_method_selected: true, payment_method_changed: candidate.payment_method_changed,
  payment_method: candidate.payment_method, payment_details_entered: false, order_submitted: false,
  evidence_url: evidenceUrl, source_excerpt_url: excerptUrl, evidence_sha256: candidate.original_screenshot.sha256,
  evidence_event_key: candidate.event_key, source_record_reference: previous.record_reference,
  source_task: candidate.source_task,
  line_items: [{ name: candidate.product, quantity: 1, price_cad: candidate.subtotal }],
  publication_phase: preview ? 'local_validation_only' : 'owner_accepted',
};
const observed = new Date(record.observed_at);
const date = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Toronto', month: 'long', day: 'numeric', year: 'numeric' }).format(observed);
const time = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Toronto', month: 'long', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit', second: '2-digit', timeZoneName: 'short' }).format(observed);
const esc = value => String(value).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
const offerText = `${cfg.code} applied a 10% code discount: CAD $${record.discount_cad} off the CAD $${record.subtotal_cad} ${record.product_name}.`;
const totalText = `The merchant displayed CAD $${record.total_cad} including CAD $${record.shipping_cad} shipping and a separate CAD $${record.currency_fee_discount_cad} currency-fee discount. The selected card option displayed USD $${record.charge_usd}.`;
const badge = `<!-- OWNER_RECORD_START --><section class="current-record-refresh" id="current-record" aria-label="Current verified ${cfg.code} offer" data-owner-current-record="${id}" style="margin:12px auto;padding:16px;max-width:1200px;background:#f0f8ed;color:#16391c;border:2px solid #248044;font:16px/1.5 Arial,sans-serif"><h2 style="margin:0">${cfg.code}: 10% code savings verified at checkout</h2><p><strong>Verified ${esc(date)}</strong> · ${esc(offerText)}</p><p>${esc(totalText)}</p><p><a href="${recordUrl}">See the verified record and original evidence</a>. This automated laptop check stopped before order submission. Customer shipping and tax conditions may vary.</p></section><!-- OWNER_RECORD_END -->`;
const summary = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${cfg.code} checkout verification — ${date}</title><meta name="description" content="${esc(cfg.code + ': CAD $' + record.discount_cad + ' code discount verified on ' + date + '. See the item, checkout totals and original evidence.')}"/><link rel="canonical" href="https://${cfg.domain}${recordUrl}"></head><body style="font:18px/1.6 Arial,sans-serif;max-width:820px;margin:auto;padding:20px"><p><a href="/">Home</a></p><h1>${cfg.code}: verified 10% code discount</h1><p><strong>Observed:</strong> <time datetime="${record.observed_at}">${esc(time)}</time></p><p>${esc(offerText)}</p><dl><dt>Product subtotal</dt><dd>CAD $${record.subtotal_cad}</dd><dt>${cfg.code} code discount</dt><dd>CAD $${record.discount_cad}</dd><dt>Displayed shipping</dt><dd>CAD $${record.shipping_cad}</dd><dt>Separate currency-fee discount</dt><dd>CAD $${record.currency_fee_discount_cad}</dd><dt>Final displayed total</dt><dd>CAD $${record.total_cad}</dd><dt>Displayed card charge</dt><dd>USD $${record.charge_usd}</dd></dl><p><a href="${esc(record.product_url)}">View the merchant product</a> · <a href="${evidenceUrl}">Original checkout screenshot</a> · <a href="${excerptUrl}">Privacy-safe checkout summary excerpt</a></p><img src="${evidenceUrl}" alt="Original ${cfg.code} checkout screenshot showing the applied coupon, item price, discount and final total" style="width:100%;height:auto"/><p>Automated laptop verification. Credit or Visa Debit was selected, with all personal and payment fields blank. No order or payment was submitted. No separate tax line was displayed and no address was entered; other customer checkout totals may vary.</p><p>The exact browser capture time is retained as ${record.observed_at}; it is not visibly embedded in the screenshot. Products are for research use only, not human consumption.</p></body></html>\n`;
const read = relative => fs.readFileSync(path.join(sourceRoot, 'public', relative), 'utf8');
const out = new Map();
const put = (file, value) => out.set(file, typeof value === 'string' ? value : JSON.stringify(value, null, 2) + '\n');
const state = { latest: id, profile, code: cfg.code, observedAt: record.observed_at, submittedAt: now, mode: 'new', previousReference: previous.record_reference, evidenceEventKey: candidate.event_key, publicationPhase: record.publication_phase };
const audit = { schemaVersion: 2, profile, code: cfg.code, mode: 'new', observationType: 'checkout', runType: 'automated', browserRoute: candidate.browser_route, recordReference: id, sourceRecordReference: previous.record_reference, observedAt: record.observed_at, originalEvidence: evidenceUrl, originalEvidenceSha256: record.evidence_sha256, sourceHtmlSha256: candidate.source_excerpt.original_html_sha256, validation, owner: preview ? null : process.env.GITHUB_ACTOR, ownerConfirmed: !preview, reason: preview ? 'Local validation preview; not owner acceptance or publication.' : process.env.OWNER_REASON, publishedByRun: preview ? null : runId, submittedAt: now, publicationPhase: record.publication_phase };
for (const alias of ['api/current-record.json', 'api/current-record', 'owner-records/current.json']) put(alias, record);
put(`owner-records/${id}/record.json`, record); put(`owner-records/${id}/audit.json`, audit); put(`owner-records/${id}/index.html`, summary);
put('owner-publication-state.json', state);
const feed = JSON.parse(read('verification-feed.json'));
if (profile === 'vip10') {
  if (!Array.isArray(feed.records)) throw new Error('VIP10_feed_contract');
  feed.records.push({ recordReference: id, recordUrl, checkedAt: record.observed_at, status: preview ? 'local_validation_only' : 'accepted', recordType: 'Automated checkout verification', productName: record.product_name, currency: 'CAD', code: cfg.code, cartSubtotal: record.subtotal_cad, discountAmount: record.discount_cad, displayedTotal: record.total_cad, shipping: record.shipping_cad, currencyFeeDiscount: record.currency_fee_discount_cad, evidenceUrl });
} else {
  if (!Array.isArray(feed.items)) throw new Error('GROWTH10_feed_contract');
  feed.items.unshift({ id, url: `https://${cfg.domain}${recordUrl}`, title: `${cfg.code}: 10% code discount verified ${date}`, date_published: record.observed_at, date_modified: now, content_text: offerText + ' ' + totalText + ' Automated laptop verification; no order submitted.', attachments: [{ url: `https://${cfg.domain}${evidenceUrl}`, title: 'Original checkout evidence' }] });
}
put('verification-feed.json', feed); put('api/verification-feed.json', feed);
const item = `<item><guid>https://${cfg.domain}${recordUrl}</guid><title>${esc(cfg.code + ': 10% code discount verified ' + date)}</title><link>https://${cfg.domain}${recordUrl}</link><pubDate>${observed.toUTCString()}</pubDate><description>${esc(offerText + ' ' + totalText)}</description></item>`;
put('feed.xml', read('feed.xml').replace('<channel>', '<channel>' + item).replace(/<lastBuildDate>[^<]*<\/lastBuildDate>/, '<lastBuildDate>' + new Date(now).toUTCString() + '</lastBuildDate>'));
const pages = profile === 'vip10' ? ['index.html','vip10/index.html','growth-guys-discount-code/index.html','does-vip10-work/index.html','verification-archive/index.html','verification-history/index.html','how-we-verify/index.html'] : ['index.html','growth10/index.html','discount-codes/index.html','verification-archive/index.html','verification-history/index.html','how-we-verify/index.html','growth10-offer-status-and-checkout-help/index.html','guides/growth-guys-growth10-promo-code-savings/index.html'];
for (const file of pages) {
  if (!fs.existsSync(path.join(sourceRoot, 'public', file))) continue;
  let html = read(file).replace(/<!-- OWNER_RECORD_START -->[\s\S]*?<!-- OWNER_RECORD_END -->/g, '');
  if (!/<body(?:\s[^>]*)?>/i.test(html)) throw new Error('missing_body:' + file);
  html = html.replace(/(<body(?:\s[^>]*)?>)/i, '$1' + badge);
  put(file, html);
}
let sitemap = read('sitemap.xml');
if (!sitemap.includes('</urlset>')) throw new Error('invalid_sitemap');
const currentUrls = new Set(pages.map(f => `https://${cfg.domain}/` + f.replace(/index\.html$/, '')));
sitemap = sitemap.replace(/<url\b[^>]*>[\s\S]*?<\/url>/g, block => {
  const loc = block.match(/<loc>([^<]+)<\/loc>/)?.[1];
  if (!currentUrls.has(loc)) return block;
  return /<lastmod>/.test(block) ? block.replace(/<lastmod>[^<]*<\/lastmod>/, `<lastmod>${now}</lastmod>`) : block.replace('</url>', `<lastmod>${now}</lastmod></url>`);
});
put('sitemap.xml', sitemap.replace('</urlset>', `<url><loc>https://${cfg.domain}${recordUrl}</loc><lastmod>${now}</lastmod></url></urlset>`));
const map = JSON.parse(read('static-route-map.json')); map[recordUrl] = `${recordUrl}index.html`; put('static-route-map.json', map);
const manifest = JSON.parse(read('deployment-manifest.json'));
manifest.canonicalSnapshot.publicRouteCount += 1; manifest.eventKey = id; manifest.recordPublishedAt = now; manifest.generatedAt = now; manifest.ownerControlled = !preview;
if (manifest.staticRoutes) manifest.staticRoutes[recordUrl] = `${recordUrl}index.html`;
put('deployment-manifest.json', manifest);
if (preview) {
  fs.mkdirSync(root, { recursive: true });
  fs.cpSync(path.join(sourceRoot, 'public'), path.join(root, 'public'), { recursive: true });
  fs.cpSync(path.join(sourceRoot, 'scripts'), path.join(root, 'scripts'), { recursive: true });
  fs.writeFileSync(path.join(root, 'LOCAL_VALIDATION_ONLY.json'), JSON.stringify({ phase: 'local-validation-only', ownerAccepted: false, published: false, sourceEvidenceEvent: candidate.event_key }, null, 2) + '\n');
}
for (const [relative, content] of out) {
  const file = path.join(root, 'public', relative); fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, content);
}
execFileSync('python3', [path.join(root, 'scripts/project-existing-current-record.py')], { cwd: root, stdio: 'inherit' });
if (profile === 'vip10') execFileSync('python3', [path.join(root, 'scripts/repair-static-root-runtime.py'), path.join(root, 'public')], { cwd: root, stdio: 'inherit' });
const checks = ['validate-current-record-projection.mjs', profile === 'vip10' ? 'validate-current-facing-projection.mjs' : 'validate-customer-facing-site.mjs', 'validate-canonical-snapshot.mjs'];
for (const check of checks) execFileSync('node', [path.join(root, 'scripts', check), 'public'], { cwd: root, stdio: 'inherit' });
if (!preview && process.env.GITHUB_OUTPUT) fs.appendFileSync(process.env.GITHUB_OUTPUT, 'record_reference=' + id + '\n');
console.log(JSON.stringify({ status: preview ? 'local_preview_validated_not_accepted' : 'owner_checkout_record_staged', profile, record_reference: id, observed_at: record.observed_at, total_cad: record.total_cad, output: root }));
