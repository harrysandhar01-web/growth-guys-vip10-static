import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const cfg = {vip10:'VIP10',growth10:'GROWTH10'}[process.env.SITE_PROFILE];
const fail = message => { throw new Error(message); };
if (!cfg || process.env.GITHUB_ACTIONS !== 'true' || process.env.GITHUB_ACTOR !== 'harrysandhar01-web' || process.env.OWNER_CONFIRMED !== 'true') fail('authenticated_owner_required');
const origin = 'https://growthguys' + cfg.toLowerCase() + '.ca';
const title = (process.env.UPDATE_TITLE || '').trim();
const body = (process.env.UPDATE_TEXT || '').trim();
const upload = (process.env.UPDATE_IMAGE || '').trim();
const run = process.env.GITHUB_RUN_ID || '';
if (!/^\d+$/.test(run) || !title || title.length > 160 || !body || body.length > 12000) fail('invalid_content_or_run');
const root = path.resolve('public');
const read = relative => fs.readFileSync(path.join(root,relative),'utf8');
// Ordinary owner content must not depend on the verification record being readable or current.
if (read('CNAME').trim() !== new URL(origin).hostname) fail('wrong_site');
const now = new Date().toISOString();
const key = 'owner-' + run;
const route = '/owner-updates/' + key + '/';
const latest = '/owner-updates/';
const esc = value => String(value).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'","&#39;");
let bytes, imageName, digest;
if (upload) {
  if (!/^owner-uploads\/[a-zA-Z0-9_-]+\/[a-zA-Z0-9_.-]+\.(png|jpe?g|webp)$/i.test(upload)) fail('image_must_be_in_owner_uploads');
  const base = path.resolve('owner-uploads');
  const full = fs.realpathSync(upload);
  if (!full.startsWith(base + path.sep) || !fs.statSync(full).isFile()) fail('invalid_image_path');
  bytes = fs.readFileSync(full);
  if (bytes.length > 12*1024*1024 || bytes.length < 12) fail('invalid_image_size');
  let ext;
  if (bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) ext='png';
  else if (bytes[0]===255 && bytes[1]===216 && bytes[2]===255) ext='jpg';
  else if (bytes.toString('ascii',0,4)==='RIFF' && bytes.toString('ascii',8,12)==='WEBP') ext='webp';
  else fail('unsupported_image');
  imageName = 'submitted-image.' + ext;
  digest = crypto.createHash('sha256').update(bytes).digest('hex');
}
const manifest = JSON.parse(read('deployment-manifest.json'));
const map = JSON.parse(read('static-route-map.json'));
let sitemap = read('sitemap.xml');
if (!sitemap.includes('</urlset>') || !manifest.canonicalSnapshot || !Number.isInteger(manifest.canonicalSnapshot.publicRouteCount)) fail('invalid_site_route_metadata');
const statePath = 'owner-updates/index.json';
const history = fs.existsSync(path.join(root,statePath)) ? JSON.parse(read(statePath)) : {site:cfg,updates:[]};
if (history.site !== cfg || !Array.isArray(history.updates)) fail('invalid_owner_update_index');
const entry = {id:key,title,body,published_at:now,route,source:'owner_submitted',verification_status:'not_independently_verified',image_url:imageName?route+imageName:null,image_sha256:digest||null};
const prior = history.updates.find(x=>x.id===key);
if (prior) {
  if (prior.title !== title || prior.body !== body || prior.image_sha256 !== entry.image_sha256) fail('run_id_already_used_with_different_content');
  console.log('Owner update already staged; reuse existing source.');
  process.exit(0);
}
history.updates.unshift(entry);
const label = 'Owner-submitted update — not independently verified';
const item = x => '<article><h2>'+esc(x.title)+'</h2><p><strong>'+label+'</strong></p><p>Published <time datetime="'+esc(x.published_at)+'">'+esc(x.published_at)+'</time></p><p style="white-space:pre-wrap">'+esc(x.body)+'</p>'+(x.image_url?'<img src="'+esc(x.image_url)+'" alt="Owner-submitted image" style="max-width:100%;height:auto">':'')+'</article>';
const page = (pageTitle,canonical,content) => '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>'+esc(pageTitle)+'</title><meta name="description" content="Owner-submitted website updates. Separate from independently verified records."><link rel="canonical" href="'+origin+canonical+'"></head><body style="font:17px/1.6 system-ui,sans-serif;max-width:850px;margin:auto;padding:20px"><nav><a href="/">Home</a> · <a href="/owner-updates/">Owner updates</a></nav><h1>'+esc(pageTitle)+'</h1><p>These updates are supplied by the site owner. They do not change the independently verified record.</p>'+content+'</body></html>\n';
const writes = new Map();
const put = (p,v) => writes.set(p,typeof v==='string'||Buffer.isBuffer(v)?v:JSON.stringify(v,null,2)+'\n');
put(route.slice(1)+'index.html',page(title,route,item(entry)));
put(latest.slice(1)+'index.html',page('Owner updates',latest,item(entry)+'<h2>Previous owner updates</h2><ul>'+history.updates.slice(1).map(x=>'<li><a href="'+esc(x.route)+'">'+esc(x.title)+'</a> — '+esc(x.published_at)+'</li>').join('')+'</ul>'));
put(statePath,history);
if (bytes) put(route.slice(1)+imageName,bytes);
const marker = '<!-- OWNER_UPDATE_START -->';
const block = marker+'<section aria-label="Owner-submitted update" style="margin:16px auto;padding:16px;max-width:1100px;border:1px solid #777;border-radius:8px"><h2>Owner update: '+esc(title)+'</h2><p>'+label+' · Published <time datetime="'+now+'">'+now.slice(0,10)+'</time></p><p><a href="'+route+'">Read the latest owner update'+(bytes?' and view the submitted image':'')+'</a></p></section><!-- OWNER_UPDATE_END -->';
for (const p of ['index.html',cfg.toLowerCase()+'/index.html']) {
  const html = read(p).replace(/<!-- OWNER_UPDATE_START -->[\s\S]*?<!-- OWNER_UPDATE_END -->/g,'');
  if (!/<\/body>/i.test(html)) fail('missing_body:'+p);
  put(p,html.replace(/<\/body>/i,()=>block+'</body>'));
}
function touchSitemap(p) {
  const url = origin+p;
  let found = false;
  sitemap = sitemap.replace(/<url\b[^>]*>[\s\S]*?<\/url>/g, old=>{
    if (!old.includes('<loc>'+url+'</loc>')) return old;
    found = true;
    return /<lastmod>/.test(old)?old.replace(/<lastmod>[^<]*<\/lastmod>/,'<lastmod>'+now+'</lastmod>'):old.replace('</url>','<lastmod>'+now+'</lastmod></url>');
  });
  if (!found) {
    if (p==='/'||p==='/'+cfg.toLowerCase()+'/') fail('missing_existing_sitemap_entry');
    sitemap=sitemap.replace('</urlset>','<url><loc>'+url+'</loc><lastmod>'+now+'</lastmod></url>\n</urlset>');
    manifest.canonicalSnapshot.publicRouteCount++;
  }
}
for (const p of ['/', '/'+cfg.toLowerCase()+'/',latest,route]) touchSitemap(p);
for (const p of [latest,route]) {
  map[p]=p+'index.html';
  if (manifest.staticRoutes) manifest.staticRoutes[p]=p+'index.html';
}
manifest.generatedAt=now;
if ((sitemap.match(/<loc>/g)||[]).length!==manifest.canonicalSnapshot.publicRouteCount) fail('sitemap_count_mismatch');
put('sitemap.xml',sitemap);
put('static-route-map.json',map);
put('deployment-manifest.json',manifest);
for (const [p,v] of writes) {
  const file=path.join(root,p);
  fs.mkdirSync(path.dirname(file),{recursive:true});
  fs.writeFileSync(file,v);
}
console.log(JSON.stringify({status:'owner_content_staged',site:cfg,route,published_at:now,verification_record_unchanged:true}));
