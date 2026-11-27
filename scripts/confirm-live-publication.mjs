import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
const expected = JSON.parse(readFileSync('public/api/current-record.json', 'utf8'));
const origin = process.env.SITE_ORIGIN;
const code = process.env.SITE_CODE;
const slug = code.toLowerCase();
assertConfiguration();
function assertConfiguration() { if (!['VIP10','GROWTH10'].includes(code) || origin !== 'https://growthguys' + slug + '.ca') throw new Error('site configuration mismatch'); }
const assert = (ok, message) => { if (!ok) throw new Error(message); };
assert(expected.code === code && expected.record_reference && expected.record_url, 'source identity missing');
let lastError;
for (let attempt = 1; attempt <= 10; attempt++) {
  try {
    const get = async (path) => {
      const url = new URL(path, origin);
      assert(url.origin === origin, 'unexpected destination origin');
      url.searchParams.set('readback', process.env.GITHUB_RUN_ID + '-' + attempt);
      const response = await fetch(url, { headers: {'Cache-Control':'no-cache, no-store','Pragma':'no-cache'}, signal: AbortSignal.timeout(20000) });
      assert(response.ok && new URL(response.url).origin === origin, 'readback HTTP/origin mismatch: ' + url.pathname);
      return Buffer.from(await response.arrayBuffer());
    };
    const recordDir = expected.record_url.endsWith('/') ? expected.record_url : expected.record_url + '/';
    const [api, home, archive, feed, detail, sitemap] = await Promise.all([
      get('/api/current-record.json'), get('/'), get('/verification-archive/'),
      get('/verification-feed.json'), get(recordDir + 'record.json'), get('/sitemap.xml')
    ]);
    // Test each directory with and without its trailing slash. Redirects must stay on the canonical origin.
    const canonicalPage = (html, expectedURL) => {
      const canonical = html.match(/<link\b[^>]*\brel=["']canonical["'][^>]*>/i)?.[0];
      const href = canonical?.match(/\bhref=["']([^"']+)["']/i)?.[1];
      assert(href === expectedURL, 'canonical mismatch: ' + expectedURL);
      assert(html.includes(expected.record_reference), 'stale page: ' + expectedURL);
    };
    for (const route of ['/' + slug + '/', '/verification-archive/', recordDir]) {
      const [withSlash, withoutSlash] = await Promise.all([get(route), get(route.slice(0,-1))]);
      canonicalPage(withSlash.toString(), origin + route);
      canonicalPage(withoutSlash.toString(), origin + route);
    }
    canonicalPage(home.toString(), origin + '/');
    const current = JSON.parse(api.toString()), record = JSON.parse(detail.toString()), f = JSON.parse(feed.toString());
    for (const field of ['code','record_reference','observed_at','product_name','total_cad','evidence_url']) {
      assert(current[field] === expected[field] && record[field] === expected[field], 'record mismatch: ' + field);
    }
    const h = home.toString(), a = archive.toString();
    assert(h.includes(expected.record_reference) && h.includes(expected.product_name) && h.includes(expected.total_cad), 'homepage projection mismatch');
    assert(h.split('</head>')[0].includes(expected.record_reference) && h.includes(origin + '/'), 'homepage metadata mismatch');
    assert(a.includes(expected.record_reference), 'archive projection mismatch');
    assert((f.records || f.items || []).some(x => (x.recordReference || x.id) === expected.record_reference), 'feed missing current record');
    assert(sitemap.toString().includes(new URL(recordDir, origin).href), 'sitemap missing current record');
    if (expected.evidence_url) {
      const evidenceURL = new URL(expected.evidence_url, origin);
      if (evidenceURL.origin === origin) {
        const evidence = await get(evidenceURL.href);
        if (expected.evidence_sha256) assert(createHash('sha256').update(evidence).digest('hex') === expected.evidence_sha256, 'evidence hash mismatch');
      } else {
        console.log('External historical evidence URL not fetched; source reference preserved.');
      }
    }
    console.log(JSON.stringify({status:'published_and_live_confirmed',code,record_reference:expected.record_reference,observed_at:expected.observed_at,run_id:process.env.GITHUB_RUN_ID,confirmed_at:new Date().toISOString()}));
    process.exit(0);
  } catch (error) {
    lastError = error;
    console.log('Readback attempt ' + attempt + ': ' + error.message);
    if (attempt < 10) await new Promise(resolve => setTimeout(resolve, 8000));
  }
}
throw lastError;
