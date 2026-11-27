import fs from "node:fs";
import path from "node:path";

const configs = {
  vip10: { code: "VIP10", domain: "growthguysvip10.ca", route: "vip10" },
  growth10: { code: "GROWTH10", domain: "growthguysgrowth10.ca", route: "growth10" }
};
const profile = process.env.SITE_PROFILE;
const cfg = configs[profile];
if (!cfg) throw new Error("unknown_profile");
if (process.env.GITHUB_ACTOR !== "harrysandhar01-web" || process.env.OWNER_CONFIRMED !== "true") {
  throw new Error("authenticated_owner_confirmation_required");
}
const mode = process.env.PUBLICATION_MODE;
if (!["new","correction"].includes(mode)) throw new Error("invalid_publication_mode");
const scope = (process.env.OBSERVATION_SCOPE || "").trim();
if (scope !== "cart-only") throw new Error("observation_scope_must_be_cart_only");
const reason = (process.env.OWNER_REASON || "").trim();
if (reason.length < 8 || reason.length > 700) throw new Error("owner_reason_required");
const eastern = String(process.env.OBSERVED_EASTERN || "").trim();
const parts = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})$/.exec(eastern);
if (!parts) throw new Error("enter_observed_eastern_as_YYYY-MM-DD_HH:MM");
const [year,month,day,hour,minute] = parts.slice(1).map(Number);
if (month < 1 || month > 12 || day < 1 || day > 31 || hour > 23 || minute > 59) throw new Error("invalid_date_time");
const fmt = new Intl.DateTimeFormat("en-US",{ timeZone:"America/Toronto", year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit",hourCycle:"h23" });
const candidates = [4,5].map(offset=>new Date(Date.UTC(year,month-1,day,hour+offset,minute))).filter(d=>{
  const o = Object.fromEntries(fmt.formatToParts(d).map(x=>[x.type,x.value]));
  return +o.year===year && +o.month===month && +o.day===day && +o.hour===hour && +o.minute===minute;
});
if (candidates.length!==1) throw new Error("Eastern_time_ambiguous_or_invalid_choose_an_unambiguous_time");
const observedAt = candidates[0].toISOString();
if (candidates[0].getTime()>Date.now()+300000) throw new Error("future_evidence_time_not_allowed");
const pub = path.resolve("public");
const p=(f)=>path.join(pub,f);
const read=(f)=>fs.readFileSync(p(f),"utf8");
const readJson=(f)=>JSON.parse(read(f));
const write=(f,s)=>{fs.mkdirSync(path.dirname(p(f)),{recursive:true});fs.writeFileSync(p(f),s)};
const writeJson=(f,v)=>write(f,JSON.stringify(v,null,2)+"\n");
const prev=readJson("api/current-record.json");
if (prev.code!==cfg.code) throw new Error("record_site_identity_mismatch");
if (!prev.record_reference || !prev.observed_at) throw new Error("previous_record_incomplete");
if (mode==="new" && candidates[0].getTime()<new Date(prev.observed_at).getTime()) throw new Error("new_record_cannot_precede_existing_record");
const oldRef=prev.record_reference;
const toCents=(value,label)=>{
  if (!/^\d+(?:\.\d{1,2})?$/.test(value??"")) throw new Error(label+"_must_be_CAD_number");
  const cents=Math.round(Number(value)*100);
  if (!Number.isSafeInteger(cents)) throw new Error(label+"_too_large");
  return cents;
};
const existingProduct=prev.product_name || prev.product || "";
const existingSubtotal=prev.cart_subtotal || prev.subtotal_cad || "";
const existingDiscount=prev.discount_amount || prev.discount_cad || "";
const existingTotal=prev.observed_total || prev.total_cad || "";
const product=(process.env.PRODUCT_NAME || (mode==="correction"?existingProduct:"")).trim();
if (!product || product.length>250) throw new Error("product_required");
const subtotal=toCents(process.env.CART_SUBTOTAL || (mode==="correction"?existingSubtotal:""),"subtotal");
const discount=toCents(process.env.DISCOUNT_AMOUNT || (mode==="correction"?existingDiscount:""),"discount");
const total=toCents(process.env.DISPLAYED_TOTAL || (mode==="correction"?existingTotal:""),"total");
const bitcoin=toCents(process.env.BITCOIN_ADJUSTMENT || "0","bitcoin_adjustment");
if (subtotal<=0 || discount<=0 || discount>subtotal) throw new Error("positive_discount_within_subtotal_required");
if (bitcoin<0 || total<0 || subtotal-discount-bitcoin!==total) throw new Error("cart_total_must_preserve_separate_bitcoin_adjustment");
const timestampUncertainty=(process.env.TIMESTAMP_UNCERTAINTY || "").trim();
if (!timestampUncertainty) throw new Error("timestamp_uncertainty_required");
const timestampPrecision=(process.env.TIMESTAMP_PRECISION || "").trim();
if (!timestampPrecision) throw new Error("timestamp_precision_required");
const evidence=(process.env.EVIDENCE_URL || (mode==="correction"?prev.evidence_url:"") || "").trim();
if (!evidence) throw new Error("evidence_link_required");
const allowRelative=/^\/(?:evidence|manus-storage|verification-archive|observations|owner-records)\/[a-zA-Z0-9_./-]+\/?$/;
const allowPublic=new RegExp("^https://"+cfg.domain.replaceAll(".","\\.")+"/(?:evidence|manus-storage|verification-archive|observations|owner-records)/[a-zA-Z0-9_./-]+/?$");
if (!allowRelative.test(evidence) && !allowPublic.test(evidence)) throw new Error("evidence_must_be_existing_site_record_or_screenshot_link");
const rel=evidence.startsWith("/") ? evidence : new URL(evidence).pathname;
if (!fs.existsSync(p(rel.slice(1)))) throw new Error("evidence_does_not_exist_in_site_files");
const id=profile+"-owner-"+observedAt.replace(/[-:TZ.]/g,"").slice(0,14)+"-"+(process.env.GITHUB_RUN_ID || "manual");
if (fs.existsSync(p("owner-records/"+id+"/index.html"))) throw new Error("duplicate_owner_publication");
const dollars=n=>(n/100).toFixed(2);
const escapeHtml=v=>String(v).replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;").replaceAll('"',"&quot;");
const dateLabel = new Intl.DateTimeFormat("en-CA",{timeZone:"America/Toronto",month:"long",day:"numeric",year:"numeric"}).format(candidates[0]);
const timeLabel = new Intl.DateTimeFormat("en-CA",{timeZone:"America/Toronto",year:"numeric",month:"long",day:"numeric",hour:"numeric",minute:"2-digit",timeZoneName:"short"}).format(candidates[0]);
const url="/owner-records/"+id+"/";
const record={
  version:prev.version || "1.1", currency:"CAD", observation_type:"cart", published_at:new Date().toISOString(),
  code:cfg.code, record_reference:id,record_url:url,
  observed_at:observedAt, observed_timezone:"America/Toronto", status:"Verified cart-only observation",
  product_name:product,product,
  cart_subtotal:dollars(subtotal), subtotal_cad:dollars(subtotal),
  discount_amount:dollars(discount),discount_cad:dollars(discount),
  observed_total:dollars(total),total_cad:dollars(total),
  evidence_url:evidence,
  source_record_reference:oldRef,
  method:"Verified cart-only evidence",
  payment_method_selected:false,
  bitcoin_adjustment_cad:dollars(bitcoin),
  timestamp_precision:timestampPrecision,
  timestamp_uncertainty:timestampUncertainty,
  scope:"Documented pre-payment cart observation; no checkout, identity, address, payment details, order submission or purchase was used."
};
// Never inherit product metadata from the previous record. These fields are
// published only when explicitly supplied for this exact cart event.
const explicitProductUrl=(process.env.PRODUCT_URL || "").trim();
if (explicitProductUrl) record.product_url=explicitProductUrl; else delete record.product_url;
const explicitLineItems=(process.env.LINE_ITEMS_JSON || "").trim();
if (explicitLineItems) {
  try { record.line_items=JSON.parse(explicitLineItems); }
  catch { throw new Error("line_items_json_must_be_valid_json"); }
} else delete record.line_items;
const now=new Date().toISOString();
const audit={schemaVersion:1,profile,code:cfg.code,mode,observationScope:scope,recordReference:id,sourceRecordReference:oldRef,previousObservedAt:prev.observed_at,observedAt,owner:"harrysandhar01-web",reason,originalEvidence:evidence,bitcoinAdjustmentCad:dollars(bitcoin),timestampUncertainty, publishedByRun:process.env.GITHUB_RUN_ID||null,submittedAt:now};
const badge = "<!-- OWNER_RECORD_START --><section aria-label=\"Current verified cart-only record\" data-owner-current-record=\""+id+"\" style=\"margin:12px auto;padding:16px;max-width:1200px;background:#f0f8ed;color:#16391c;border:3px solid #248044;font:16px/1.5 Arial,sans-serif;position:relative;z-index:10\"><strong>Latest verified "+escapeHtml(cfg.code)+" cart observation — "+escapeHtml(dateLabel)+"</strong><p style=\"margin:5px 0\">Cart observed "+escapeHtml(timeLabel)+" · "+escapeHtml(product)+" · CAD "+dollars(subtotal)+" subtotal · CAD "+dollars(discount)+" code discount · CAD "+dollars(bitcoin)+" separate Bitcoin adjustment · CAD "+dollars(total)+" displayed total.</p><p style=\"margin:5px 0\">"+(mode==="correction"?"Correction to a previously documented cart event.":"Documented new cart event.")+" No checkout, payment, identity, address, order submission or purchase was used. <a href=\""+url+"\">View record and evidence</a>.</p></section><!-- OWNER_RECORD_END -->";
const summary = "<!doctype html><html lang=\"en\"><head><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width,initial-scale=1\"><title>"+cfg.code+" verified cart-only record — "+dateLabel+"</title><link rel=\"canonical\" href=\"https://"+cfg.domain+url+"\"></head><body style=\"font:18px/1.6 Arial,sans-serif;max-width:820px;margin:auto;padding:20px\"><p><a href=\"/\">Home</a></p><h1>"+cfg.code+" documented cart-only record</h1><p><strong>Observed:</strong> "+escapeHtml(timeLabel)+"</p><p><strong>Product:</strong> "+escapeHtml(product)+"</p><p><strong>Subtotal:</strong> CAD "+dollars(subtotal)+"</p><p><strong>Code discount:</strong> CAD "+dollars(discount)+"</p><p><strong>Separate Bitcoin adjustment:</strong> CAD "+dollars(bitcoin)+"</p><p><strong>Displayed total:</strong> CAD "+dollars(total)+"</p><p><strong>Source evidence:</strong> <a href=\""+escapeHtml(evidence)+"\">View evidence</a></p><p><strong>Record type:</strong> "+(mode==="correction"?"Verified cart-only correction of documented observation":"Verified cart-only dated observation")+"</p><p>This reports a pre-payment cart observation. The timestamp is retained from the provenance record and is not visibly embedded in the screenshot. No checkout, payment, identity, address, order submission or purchase was used.</p></body></html>";
// Stage every file in memory first; invalid input must cause no partial writes.
const out=new Map();
const put=(f,v)=>out.set(f,typeof v==="string"?v:JSON.stringify(v,null,2)+"\n");
put("owner-records/"+id+"/index.html",summary);
put("owner-records/"+id+"/record.json",record);
put("owner-records/"+id+"/audit.json",audit);
put("api/current-record.json",record);
put("api/current-record",record);
put("owner-records/current.json",record);
const feed=readJson("verification-feed.json");
if (profile==="vip10"){
  if(!Array.isArray(feed.records)) throw Error("vip10_feed_schema_changed");
  feed.records.push({recordReference:id,recordUrl:url,checkedAt:observedAt,status:"accepted",recordType:mode==="correction"?"Verified cart-only correction":"Documented cart-only result",productName:product,currency:"CAD",code:cfg.code,discountAmount:dollars(discount),bitcoinAdjustment:dollars(bitcoin),cartSubtotal:dollars(subtotal),displayedTotal:dollars(total),evidenceUrl:evidence});
}else{
  if(!Array.isArray(feed.items)) throw Error("growth10_feed_schema_changed");
  feed.items.unshift({id,url:"https://"+cfg.domain+url,title:cfg.code+" verified checkout record",date_published:observedAt,date_modified:now,content_text:product+": "+cfg.code+" reduced a CAD "+dollars(subtotal)+" cart by CAD "+dollars(discount)+" to CAD "+dollars(total)+". No purchase was made.",attachments:[{url:evidence.startsWith("/")?"https://"+cfg.domain+evidence:evidence,title:"Documented original evidence"}]});
}
put("verification-feed.json",feed);
put("api/verification-feed.json",feed);
const xml=read("feed.xml");
if(!xml.includes("<channel>")) throw Error("unsupported_rss_format");
const description=escapeHtml(cfg.code+" "+product+" observed "+timeLabel+"; subtotal CAD "+dollars(subtotal)+", discount CAD "+dollars(discount)+", total CAD "+dollars(total)+".");
const item="<item><guid>https://"+cfg.domain+url+"</guid><title>"+escapeHtml(cfg.code+" verified checkout record")+"</title><link>https://"+cfg.domain+url+"</link><pubDate>"+candidates[0].toUTCString()+"</pubDate><description>"+description+"</description></item>";
put("feed.xml",xml.replace("<channel>","<channel>"+item).replace(/<lastBuildDate>[^<]*<\/lastBuildDate>/,"<lastBuildDate>"+new Date().toUTCString()+"</lastBuildDate>"));
for(const file of ["index.html",cfg.route+"/index.html","growth-guys-discount-code/index.html","does-vip10-work/index.html","verification-archive/index.html","verification-history/index.html","how-we-verify/index.html"]){
  if(!fs.existsSync(p(file))) continue;
  let html=read(file);
  if(!/<body(?:\s[^>]*)?>/i.test(html)) throw Error("missing_body_in_"+file);
  html=html.replace(/<!-- OWNER_RECORD_START -->[\s\S]*?<!-- OWNER_RECORD_END -->/g,"");
  html=html.replace(/(<body(?:\s[^>]*)?>)/i,(_match,opening)=>opening+badge);
  if(file==="index.html" || file===cfg.route+"/index.html"){
    html=html.replace(/<section class="current-record-refresh"[\s\S]*?<\/section>/i,"");
    html=html.replace(/<strong>Latest verified checkout record — [^<]+<\/strong>/i,"<strong>Latest verified checkout record — "+dateLabel+"</strong>");
    html=html.replace(/(<meta name="verification:date" content=")[^"]*(")/i,"$1"+escapeHtml(timeLabel)+"$2");
    html=html.replace(/(<meta name="verification:record-reference" content=")[^"]*(")/i,"$1"+id+"$2");
  }
  put(file,html);
}
const sitemap=read("sitemap.xml");
if(!sitemap.includes("</urlset>")) throw Error("sitemap_missing_urlset");
put("sitemap.xml",sitemap.replace("</urlset>","<url><loc>https://"+cfg.domain+url+"</loc><lastmod>"+now.slice(0,10)+"</lastmod></url></urlset>"));
const routeMap=readJson("static-route-map.json");
routeMap[url]=" /owner-records/"+id+"/index.html";
routeMap[url]=routeMap[url].trim();
put("static-route-map.json",routeMap);
const manifest=readJson("deployment-manifest.json");
if (!Number.isInteger(manifest.canonicalSnapshot?.publicRouteCount)) throw Error("unexpected_route_count_metadata");
manifest.canonicalSnapshot.publicRouteCount += 1;
manifest.eventKey=id;
manifest.recordPublishedAt=now;
manifest.generatedAt=now;
manifest.ownerControlled=true;
put("deployment-manifest.json",manifest);
put("owner-publication-state.json",{latest:id,profile,code:cfg.code,observedAt,submittedAt:now,mode,previousReference:oldRef});
for(const [file,content] of out) write(file,content);
if(process.env.GITHUB_OUTPUT) fs.appendFileSync(process.env.GITHUB_OUTPUT,"record_reference="+id+"\n");
console.log("OWNER_PUBLICATION_STAGED "+JSON.stringify({id,profile,mode,files:out.size,dateLabel}));
