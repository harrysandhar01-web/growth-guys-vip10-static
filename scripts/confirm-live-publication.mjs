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
let fullAuditStarted = false;
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
    fullAuditStarted = true;
    const audits = await Promise.allSettled([confirmAllSlashVariants(expected, recordDir), confirmApiAliases(expected)]);
    const auditErrors = audits.filter(x=>x.status==='rejected').map(x=>x.reason.message);
    assert(!auditErrors.length, auditErrors.join('; '));
    console.log(JSON.stringify({status:'published_and_live_confirmed',code,record_reference:expected.record_reference,observed_at:expected.observed_at,run_id:process.env.GITHUB_RUN_ID,confirmed_at:new Date().toISOString()}));
    process.exit(0);
  } catch (error) {
    lastError = error;
    console.log('Readback attempt ' + attempt + ': ' + error.message);
    if (fullAuditStarted) break; // per-route retries already ran; do not repeat the entire site crawl
    if (attempt < 10) await new Promise(resolve => setTimeout(resolve, 8000));
  }
}
throw lastError;

/** Audit all declared directory routes, not just the three primary routes.
 * Historical pages are compared to their own deployed source, not relabelled as current. */
async function confirmAllSlashVariants(expected, recordDir) {
  const routes = JSON.parse(readFileSync('public/static-route-map.json','utf8'));
  const targets = new Map();
  for (const [route, file] of Object.entries(routes)) {
    if (route !== '/' && route.endsWith('/') && typeof file === 'string' && file.endsWith('/index.html') && /^\/[a-zA-Z0-9_./-]+$/.test(route) && !route.split('/').includes('..')) targets.set(route, file);
  }
  targets.set('/'+slug+'/', '/'+slug+'/index.html');
  targets.set('/verification-archive/', '/verification-archive/index.html');
  targets.set(recordDir, recordDir+'index.html');
  const digest = b => createHash('sha256').update(b).digest('hex');
  const report = [];
  const queue = [...targets.entries()];
  const fetchPage = async (route, fresh) => {
    const url = new URL(route, origin);
    if (fresh) url.searchParams.set('variant_check', (process.env.GITHUB_RUN_ID || 'manual')+'-'+Date.now());
    const res = await fetch(url, {headers:fresh?{'Cache-Control':'no-cache, no-store','Pragma':'no-cache'}:{},signal:AbortSignal.timeout(12000)});
    assert(res.ok && new URL(res.url).origin === origin,'variant HTTP/origin mismatch '+route);
    return {body:Buffer.from(await res.arrayBuffer()),final:res.url};
  };
  const workers = Array.from({length:8}, async () => {
    while (queue.length) {
      const [route,file] = queue.shift();
      let last;
      for(let retry=1;retry<=3;retry++){
        try {
          const local = readFileSync('public'+file);
          const variants = [route, route.slice(0,-1)];
          const results = await Promise.all(variants.flatMap(v=>[false,true].map(async fresh=>{
            const result=await fetchPage(v,fresh);
            assert(digest(result.body)===digest(local),'stale or different content '+v+' cache-busted='+fresh);
            return {path:v,cache_busted:fresh,final:result.final,status:'match'};
          })));
          report.push({route,status:'match',variants:results}); last=null; break;
        } catch(err){last=err.message;if(retry<3)await new Promise(r=>setTimeout(r,1000*retry));}
      }
      if(last) report.push({route,status:'unconfirmed',error:last});
    }
  });
  await Promise.all(workers);
  // Root's explicit index.html is also a supported static entry point.
  try {
    const source=readFileSync('public/index.html');
    for(const variant of ['/','/index.html'])for(const fresh of [false,true]){
      const result=await fetchPage(variant,fresh);
      assert(digest(result.body)===digest(source),'homepage variant mismatch '+variant);
      report.push({route:variant,cache_busted:fresh,status:'match',final:result.final});
    }
  }catch(err){report.push({route:'/index.html',status:'unconfirmed',error:err.message});}
  console.log(JSON.stringify({stage:'all_declared_slash_variants',code,record_reference:expected.record_reference,results:report}));
  const failures=report.filter(x=>x.status!=='match');
  assert(!failures.length,'slash variant readback unresolved: '+failures.map(x=>x.route).join(', '));
}
async function confirmApiAliases(expected) {
  const aliases=['/api/current-record.json','/api/current-record','/owner-records/current.json','/verification-feed.json','/api/verification-feed.json','/feed.xml','/api/verification-history.json','/api/evidence-index.json','/sitemap.xml'];
  for(const route of aliases) {
    const local=readFileSync('public'+route);
    for(const fresh of [false,true]){
      const u=new URL(route,origin);
      if(fresh)u.searchParams.set('alias_check',(process.env.GITHUB_RUN_ID||'manual')+'-'+Date.now());
      const r=await fetch(u,{headers:fresh?{'Cache-Control':'no-cache, no-store','Pragma':'no-cache'}:{},signal:AbortSignal.timeout(12000)});
      assert(r.ok&&new URL(r.url).origin===origin,'API alias unavailable '+route);
      const remote=Buffer.from(await r.arrayBuffer());
      assert(createHash('sha256').update(remote).digest('hex')===createHash('sha256').update(local).digest('hex'),'API/feed/cache mismatch '+route);
      console.log(JSON.stringify({stage:'alias_readback',route,cache_busted:fresh,status:'match',record_reference:expected.record_reference}));
    }
  }
}
