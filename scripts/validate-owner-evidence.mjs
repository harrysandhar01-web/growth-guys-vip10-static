import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

const root = path.resolve(process.env.EVIDENCE_ROOT || "public/evidence/2026-11-23-vip10-cart-only");
const provenance = JSON.parse(fs.readFileSync(path.join(root, "observation-provenance.json"), "utf8"));
const readJson = name => JSON.parse(fs.readFileSync(path.join(root, name), "utf8"));
const fail = message => { throw new Error(`owner_evidence_invalid: ${message}`); };
const expect = (condition, message) => { if (!condition) fail(message); };
const sha256 = name => crypto.createHash("sha256").update(fs.readFileSync(path.join(root, name))).digest("hex");

expect(provenance.site === "VIP10" && provenance.code === "VIP10", "cross_site_or_code_identity");
expect(provenance.currency === "CAD", "currency_must_be_CAD");
expect(provenance.status === "Unaccepted private cart observation; not published", "source_must_be_unaccepted_candidate");
expect(provenance.payment_method_changed === false, "payment_method_changed");
expect(/no checkout, identity, address, payment details, order submission or purchase/i.test(provenance.notes), "cart_only_boundary_missing");
expect(provenance.product === "Semaglutide 5mg - Single vial", "product_mismatch");
expect(provenance.product_url === "https://growthguys.com/shop/semaglutide/", "product_url_mismatch");
expect(provenance.last_public_product === "Retatrutide 10mg - Single vial", "last_public_product_mismatch");
expect(provenance.last_fallback_product === "TB-500 5mg - Single vial", "fallback_product_mismatch");
expect(provenance.quantity === 1, "quantity_must_be_one");
expect(provenance.merchant_response === "Coupon code applied successfully.", "merchant_coupon_response_missing");
expect(provenance.observed_toronto === "2026-11-23T00:20:59.411000-05:00", "observed_toronto_mismatch");
expect(provenance.timestamp_precision === "milliseconds", "timestamp_precision_not_preserved");
expect(provenance.timestamp_uncertainty === "Timestamp is supplied in provenance; not visibly embedded in screenshot.", "timestamp_uncertainty_not_preserved");

for (const [name, expected] of Object.entries(provenance.sha256)) {
  expect(fs.existsSync(path.join(root, name)), `missing_original:${name}`);
  expect(sha256(name) === expected, `hash_mismatch:${name}`);
}

const current = JSON.parse(fs.readFileSync(path.resolve("public/api/current-record.json"), "utf8"));
const readback = readJson("live-current-record-readback.json");
const feed = JSON.parse(fs.readFileSync(path.resolve("public/verification-feed.json"), "utf8"));
const historicalReadbackAllowed = process.env.ALLOW_HISTORICAL_READBACK === "true";
if (readback.record_reference !== current.record_reference) {
  expect(historicalReadbackAllowed, "readback_not_current_authoritative_record");
  expect(feed.records.some(entry => entry.recordReference === readback.record_reference), "historical_readback_absent_from_accepted_feed");
  expect(new Date(readback.observed_at).getTime() < new Date(current.observed_at).getTime(), "historical_readback_not_older_than_current");
}
expect(readback.code === "VIP10" && current.code === "VIP10", "current_record_cross_site_identity");
if (readback.record_reference === current.record_reference) expect(readback.status === current.status, "readback_status_mismatch");
const observed = new Date(provenance.observed_at);
const previous = new Date(current.observed_at);
expect(Number.isFinite(observed.getTime()) && observed.getTime() > previous.getTime(), "candidate_not_after_current_record");

const cents = value => Math.round(Number(value) * 100);
const subtotal = cents(provenance.subtotal);
const discount = cents(provenance.discount);
const bitcoin = cents(provenance.bitcoin);
const total = cents(provenance.total);
expect(subtotal === 5000 && discount === 500 && bitcoin === 900 && total === 3600, "amounts_mismatch");
expect(subtotal - discount - bitcoin === total, "total_does_not_preserve_separate_bitcoin_adjustment");
expect(discount / subtotal === 0.1, "discount_not_ten_percent");

console.log(JSON.stringify({
  status: "accepted_candidate",
  profile: "vip10",
  code: provenance.code,
  product: provenance.product,
  observed_toronto: provenance.observed_toronto,
  previous_record: current.record_reference,
  evidence_root: path.relative(process.cwd(), root),
  verified_files: Object.keys(provenance.sha256),
  cart_only: true,
  payment_method_changed: false,
  bitcoin_adjustment_cad: provenance.bitcoin,
  total_cad: provenance.total,
  timestamp_uncertainty_preserved: true
}, null, 2));
