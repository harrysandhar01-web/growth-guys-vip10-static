import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
const publicDir=resolve(process.argv[2]??"public");
const r=JSON.parse(await readFile(join(publicDir,"api/current-record.json"),"utf8"));
const pages=["index.html","vip10/index.html","growth-guys-discount-code/index.html","verification-archive/index.html","does-vip10-work/index.html","how-we-verify/index.html"];
for(const rel of pages){const html=await readFile(join(publicDir,rel),"utf8"); if(rel==="index.html"||rel==="vip10/index.html"){for(const value of [r.record_reference,r.observed_at,r.product_name,r.discount_amount,r.observed_total]){if(!html.includes(value)) throw new Error(`${rel}: missing authoritative current record field ${value}`);} if(!html.includes("/observations/2026-10-27/")) throw new Error(`${rel}: missing separate October 27 observation link`);} else {for(const value of [r.record_reference,r.observed_at]) if(!html.includes(value)) throw new Error(`${rel}: missing ${value}`);}}
const archive=await readFile(join(publicDir,"verification-archive/index.html"),"utf8"); for(const value of [r.product_name,r.cart_subtotal,r.discount_amount]) if(!archive.includes(value)) throw new Error(`archive: missing ${value}`);
const feed=JSON.parse(await readFile(join(publicDir,"verification-feed.json"),"utf8")); if(!feed.records.some(x=>x.recordReference===r.record_reference)) throw new Error("current_record_missing_from_feed");
console.log(JSON.stringify({pagesChecked:pages.length,record:r.record_reference,product:r.product_name,total:r.observed_total}));
