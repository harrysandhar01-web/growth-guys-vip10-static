import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const root = path.resolve(process.argv[2] || 'public');
const read = p => JSON.parse(fs.readFileSync(path.join(root,p),'utf8'));
const host = fs.readFileSync(path.join(root,'CNAME'),'utf8').trim();
const code = {'growthguysgrowth10.ca':'GROWTH10','growthguysvip10.ca':'VIP10'}[host];
if (!code) throw Error('unknown_site');
const origin = 'https://' + host;
const current = read('api/current-record.json');
if(current.code!==code || !current.record_reference) throw Error('current_record_identity_mismatch');
const feed = read('verification-feed.json');
const refs = new Map();
const local = value => {
  if(typeof value!=='string'||!value) return null;
  try { const u = new URL(value,origin); if(u.origin!==origin || u.username || u.password || u.search || u.hash) return null;
    const decoded=decodeURIComponent(u.pathname);
    if(decoded.includes('\\')||decoded.split('/').includes('..'))return null;
    return u.pathname;
  } catch { return null; }
};
const validId = value => typeof value==='string' && value.startsWith(code.toLowerCase()+'-') && /^[a-z0-9_-]+$/i.test(value);
const timestamp = value => typeof value==='string' && Number.isFinite(Date.parse(value)) ? value : null;
function add({id,url,observed,published,status,scope,evidence,source,hash,event}){
  if(!validId(id)) return;
  const route=local(url);
  if(!route || !/^\/(?:owner-records|verification-archive)\//.test(route))return;
  const old=refs.get(id);
  const row={record_reference:id,record_url:origin+route,observed_at:timestamp(observed),published_at:timestamp(published),source_status:status||null,observation_scope:scope||null,record_source:source,current:id===current.record_reference,evidence:[]};
  for(const candidate of evidence||[]){
    const p=local(candidate);
    if(p && /^\/(?:evidence|verification-archive|owner-records)\//.test(p)&&!row.evidence.includes(p))row.evidence.push(p);
  }
  if(hash && /^[a-f0-9]{64}$/.test(hash))row.declared_sha256=hash;
  if(event && typeof event==='string')row.event_key=event;
  if(old){row.evidence=[...new Set([...old.evidence,...row.evidence])];row.observed_at??=old.observed_at;row.published_at??=old.published_at;row.observation_scope??=old.observation_scope;row.source_status??=old.source_status;}
  refs.set(id,row);
}
for(const r of feed.records||feed.items||[]){
  if(r.code&&r.code!==code)continue;
  if(feed.records && r.status!=='accepted')continue;
  add({id:r.recordReference||r.id,url:r.recordUrl||r.url,observed:r.checkedAt||r.date_published,published:r.date_modified,status:r.status||'listed_in_existing_verification_feed',scope:r.recordType,evidence:[r.evidenceUrl,...(r.attachments||[]).map(a=>a.url)],source:'existing_public_verification_feed'});
}
const ownerDir=path.join(root,'owner-records');
for(const dir of fs.readdirSync(ownerDir,{withFileTypes:true})){
  if(!dir.isDirectory()||!validId(dir.name))continue;
  try {
    const r=read('owner-records/'+dir.name+'/record.json');
    if(r.code!==code||r.record_reference!==dir.name||!refs.has(dir.name)&&dir.name!==current.record_reference)continue;
    add({id:r.record_reference,url:r.record_url||'/owner-records/'+dir.name+'/',observed:r.observed_at,published:r.published_at,status:r.status,scope:r.observation_type||r.scope,evidence:[r.evidence_url,r.source_excerpt_url],source:'existing_public_record',hash:r.evidence_sha256,event:r.evidence_event_key});
  }catch(e){console.warn('Existing archive could not be read: '+dir.name);}
}
add({id:current.record_reference,url:current.record_url,observed:current.observed_at,published:current.published_at,status:current.status,scope:current.observation_type||current.scope,evidence:[current.evidence_url,current.source_excerpt_url],source:'existing_current_record',hash:current.evidence_sha256,event:current.evidence_event_key});
if(!refs.has(current.record_reference))throw Error('current_reference_not_indexed');
const sorted=[...refs.values()].sort((a,b)=>Number(b.current)-Number(a.current)||(Date.parse(b.observed_at||0)||0)-(Date.parse(a.observed_at||0)||0)||a.record_reference.localeCompare(b.record_reference));
const evidenceMap=new Map();
for(const row of sorted){
  for(const p of row.evidence){
    let info=evidenceMap.get(p);
    if(!info){
      const full=path.resolve(root,'.'+decodeURIComponent(p));
      let state='referenced_not_found_in_snapshot',hash=null,bytes=null;
      if(full.startsWith(root+path.sep)&&fs.existsSync(full)){
        const st=fs.statSync(full);
        if(st.isFile()){state='file_present_in_snapshot';const data=fs.readFileSync(full);bytes=data.length;hash=crypto.createHash('sha256').update(data).digest('hex');}
        else if(st.isDirectory()&&fs.existsSync(path.join(full,'index.html')))state='evidence_page_present_in_snapshot';
      }
      info={evidence_url:origin+p,availability:state,sha256:hash,bytes,record_references:[],declared_hashes:[]};evidenceMap.set(p,info);
    }
    info.record_references.push(row.record_reference);
    if(row.declared_sha256&&p===row.evidence[0]&&!info.declared_hashes.includes(row.declared_sha256))info.declared_hashes.push(row.declared_sha256);
  }
}
const common={schema_version:'1.0',site:code,canonical_origin:origin,current_record_reference:current.record_reference,current_observed_at:current.observed_at,current_record_url:origin+'/api/current-record.json',scope:'Derived index of existing public records only; not a new verification or an independent validation. Historical corrections may have multiple references for one observation.'};
const ledger={...common,record_count:sorted.length,records:sorted.map(({evidence,event_key,declared_sha256,...row})=>({...row,evidence_urls:evidence.map(p=>origin+p)}))};
const evidenceIndex={...common,evidence_count:evidenceMap.size,evidence:[...evidenceMap.values()].map(x=>({...x,declared_hash_match:x.declared_hashes.length&&x.sha256?x.declared_hashes.every(h=>h===x.sha256):null}))};
for(const [name,data] of [['verification-history.json',ledger],['evidence-index.json',evidenceIndex]]){
  const target=path.join(root,'api',name);
  const temp=target+'.tmp';
  fs.writeFileSync(temp,JSON.stringify(data,null,2)+'\n');fs.renameSync(temp,target);
}
console.log(JSON.stringify({status:'derived_indexes_built',site:code,current_record_reference:current.record_reference,record_count:ledger.record_count,evidence_count:evidenceIndex.evidence_count}));
