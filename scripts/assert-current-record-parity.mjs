import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";

const publicDir = resolve(process.argv[2] ?? "public");
const expected = { vip10: "VIP10", growth10: "GROWTH10" };
const read = (name) => readFileSync(join(publicDir, name), "utf8");
const record = JSON.parse(read("api/current-record.json"));
const code = record.code;
if (!Object.values(expected).includes(code)) throw new Error("invalid_record_code");
const stamp = Date.parse(record.observed_at);
if (!Number.isFinite(stamp)) throw new Error("invalid_observed_at");
const html = read("index.html");
const alias = JSON.parse(read("api/current-record"));
if (JSON.stringify(alias) !== JSON.stringify(record)) throw new Error("current_api_alias_mismatch");
const manifest = JSON.parse(read("deployment-manifest.json"));
if (manifest.code !== code || manifest.eventKey !== record.record_reference) {
  throw new Error("deployment_manifest_current_identity_mismatch");
}
// Check the actual current-record projection, not any dated historical card.
// A passing build must not advertise October 27 when its API still says October 25.
const markers = [...html.matchAll(/<section\b[^>]*class="[^"]*\bcurrent-record-refresh\b[^"]*"[^>]*data-observed-at="([^"]+)"/g)];
if (!markers.length) throw new Error("current_record_html_marker_missing");
for (const [,observed] of markers) {
  if (Date.parse(observed) !== stamp) throw new Error(`current_record_html_date_mismatch: html=${observed}, api=${record.observed_at}`);
}
const date = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/Toronto", month: "long", day: "numeric", year: "numeric"
}).format(new Date(stamp));
const latest = html.match(/Latest verified checkout record\s*[—-]\s*(January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2},\s+\d{4}/);
if (!latest) throw new Error("latest_verified_checkout_label_missing");
if (!latest[0].includes(date)) throw new Error(`latest_checkout_label_mismatch: expected ${date}; found ${latest[0]}`);
if (!html.includes(record.record_reference)) throw new Error("current_record_reference_missing_from_home");
console.log(JSON.stringify({ code, reference: record.record_reference, observedAt: record.observed_at, easternDate: date, currentMarkers: markers.length, status: "consistent" }));
