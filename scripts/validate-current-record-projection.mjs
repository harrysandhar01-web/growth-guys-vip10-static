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
  const displayDate=new Intl.DateTimeFormat("en-US",{timeZone:"America/Toronto",month:"long",day:"numeric",year:"numeric"}).format(new Date(record.observed_at));
  for (const file of ["index.html",cfg.route+"/index.html","verification-archive/index.html"]) {
    const html=readFileSync(joinFile(ownerDir,file),"utf8");
    // Public pages use the customer-facing current-record block; an internal
    // owner banner is not required and must not be the publication contract.
    if (!html.includes(record.product_name) || !html.includes(displayDate)) throw Error("current_public_projection_missing:"+file);
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
for(const rel of pages){const html=await readFile(join(publicDir,rel),"utf8"); if(rel==="index.html"||rel==="vip10/index.html"){for(const value of [r.record_reference,r.observed_at,r.product_name,r.discount_amount,r.observed_total]){if(!html.includes(value)) throw new Error(`${rel}: missing authoritative current record field ${value}`);} if(!html.includes(r.evidence_url)) throw new Error(`${rel}: missing authoritative evidence link ${r.evidence_url}`);} else {for(const value of [r.record_reference,r.observed_at]) if(!html.includes(value)) throw new Error(`${rel}: missing ${value}`);}}
const archive=await readFile(join(publicDir,"verification-archive/index.html"),"utf8"); for(const value of [r.product_name,r.cart_subtotal,r.discount_amount,r.evidence_url]) if(!archive.includes(value)) throw new Error(`archive: missing ${value}`);
const feed=JSON.parse(await readFile(join(publicDir,"verification-feed.json"),"utf8")); if(!feed.records.some(x=>x.recordReference===r.record_reference)) throw new Error("current_record_missing_from_feed");

const currentBlockPattern = /<section\b[^>]*(?:current-record-refresh|current-verification-banner|verification-record-summary|current-verification-summary-title)[^>]*>[\s\S]*?<\/section>/gi;
for (const relative of pages) {
  const html = (await readFile(join(publicDir, relative), "utf8")).replace(/\s+/g, " ");
  for (const block of html.match(currentBlockPattern) ?? []) {
    if (/\bCurrent\b|\bLatest\b/i.test(block) && !block.includes(displayDate)) {
      throw new Error(`${relative}: stale dated current projection`);
    }
  }
}

console.log(JSON.stringify({pagesChecked:pages.length,record:r.record_reference,product:r.product_name,total:r.observed_total}));
