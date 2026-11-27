import fs from 'node:fs';
import crypto from 'node:crypto';
const origin='https://'+fs.readFileSync('public/CNAME','utf8').trim();
const names=['verification-history.json','evidence-index.json'];
const digest=b=>crypto.createHash('sha256').update(b).digest('hex');
for (let i=1;i<=6;i++){
  try{
    for(const name of names){
      const expected=fs.readFileSync('public/api/'+name);
      const res=await fetch(origin+'/api/'+name+'?index_check='+process.env.GITHUB_RUN_ID+'-'+i,{headers:{'Cache-Control':'no-cache, no-store'},signal:AbortSignal.timeout(12000)});
      if(!res.ok||new URL(res.url).origin!==origin||digest(Buffer.from(await res.arrayBuffer()))!==digest(expected))throw Error('index_readback_mismatch:'+name);
    }
    console.log('public_history_and_evidence_indexes_live_confirmed '+origin);
    process.exit(0);
  }catch(e){console.log(e.message);if(i<6)await new Promise(r=>setTimeout(r,8000));}
}
process.exitCode=1;
