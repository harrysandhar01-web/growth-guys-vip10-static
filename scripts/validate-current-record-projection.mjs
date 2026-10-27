import { existsSync, readFileSync } from "node:fs";
import { join as joinFile, resolve as resolveDir } from "node:path";
const ownerDir = resolveDir(process.argv[2] ?? "public");
if (existsSync(joinFile(ownerDir,"owner-publication-state.json"))) {
  const j = f => JSON.parse(readFileSync(joinFile(ownerDir,f),"utf8"));
  const record=j("api/current-record.json");
  const alias=j("api/current-record");
  const state=j("owner-publication-state.json");
  const cfg={vip10:{code:"VIP10",route:"vip10"},growth10:{code:"GROWTH10",route:"growth10"}}[state.profile];
  if (!cfg || record.code!==cfg.code || state.latest!==record.record_reference || alias.record_reference!==state.latest) throw Error("owner_current_record_identity_mismatch");
  const feed=j("verification-feed.json");
  const has=state.profile==="vip10" ? feed.records.some(x=>x.recordReference===state.latest) : feed.items.some(x=>x.id===state.latest);
  if (!has) throw Error("owner_record_absent_from_public_feed");
  for (const file of ["index.html",cfg.route+"/index.html","verification-archive/index.html"]) {
    if (!readFileSync(joinFile(ownerDir,file),"utf8").includes('data-owner-current-record="'+state.latest+'"')) throw Error("stale_owner_banner:"+file);
  }
  if (!existsSync(joinFile(ownerDir,"owner-records",state.latest,"index.html"))) throw Error("owner_record_archive_missing");
  if (!readFileSync(joinFile(ownerDir,"sitemap.xml"),"utf8").includes("/owner-records/"+state.latest+"/")) throw Error("owner_record_sitemap_missing");
  if (new Date(record.observed_at).toISOString()!==state.observedAt) throw Error("owner_time_not_consistent");
  console.log(JSON.stringify({ownerPublishedRecord:state.latest,profile:state.profile,status:"source_consistent"}));
  process.exit(0);
}
import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
const publicDir=resolve(process.argv[2]??"public");
const r=JSON.parse(await readFile(join(publicDir,"api/current-record.json"),"utf8"));
const pages=["index.html","vip10/index.html","growth-guys-discount-code/index.html","verification-archive/index.html","does-vip10-work/index.html","how-we-verify/index.html"];
for(const rel of pages){const html=await readFile(join(publicDir,rel),"utf8"); if(rel==="index.html"||rel==="vip10/index.html"){for(const value of [r.record_reference,r.observed_at,r.product_name,r.discount_amount,r.observed_total]){if(!html.includes(value)) throw new Error(`${rel}: missing authoritative current record field ${value}`);} if(!html.includes("/observations/2026-10-27/")) throw new Error(`${rel}: missing separate October 27 observation link`);} else {for(const value of [r.record_reference,r.observed_at]) if(!html.includes(value)) throw new Error(`${rel}: missing ${value}`);}}
const archive=await readFile(join(publicDir,"verification-archive/index.html"),"utf8"); for(const value of [r.product_name,r.cart_subtotal,r.discount_amount]) if(!archive.includes(value)) throw new Error(`archive: missing ${value}`);
const feed=JSON.parse(await readFile(join(publicDir,"verification-feed.json"),"utf8")); if(!feed.records.some(x=>x.recordReference===r.record_reference)) throw new Error("current_record_missing_from_feed");
console.log(JSON.stringify({pagesChecked:pages.length,record:r.record_reference,product:r.product_name,total:r.observed_total}));
