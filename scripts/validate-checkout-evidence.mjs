import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const configs = { vip10: { code: 'VIP10', domain: 'growthguysvip10.ca' }, growth10: { code: 'GROWTH10', domain: 'growthguysgrowth10.ca' } };
const fail = message => { throw new Error('checkout_evidence_invalid:' + message); };
const expect = (ok, message) => { if (!ok) fail(message); };
const digest = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const text = html => html.replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
const cents = (value, label) => {
  expect(typeof value === 'string' && /^\d+\.\d{2}$/.test(value), label + '_CAD_format');
  const result = Math.round(Number(value) * 100);
  expect(Number.isSafeInteger(result) && result >= 0, label + '_invalid');
  return result;
};
const dateInToronto = value => {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Toronto', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date(value)).map(x => [x.type, x.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
};
export function validateCheckoutPackage(packagePath, profile) {
  const cfg = configs[profile]; expect(cfg, 'unknown_site_profile');
  const absolute = path.resolve(packagePath), dir = path.dirname(absolute);
  const p = JSON.parse(fs.readFileSync(absolute, 'utf8'));
  expect(p.schemaVersion === 1 && p.profile === profile && p.site === cfg.code && p.code === cfg.code, 'site_or_code_identity');
  expect(p.run_type === 'automated' && p.browser_route === 'Harry’s connected laptop / My Browser', 'automated_laptop_provenance_required');
  expect(p.status === 'successful_merchant_observation', 'successful_merchant_observation_required');
  expect(p.merchant_url === 'https://growthguys.com/checkout/', 'merchant_checkout_identity');
  expect(p.currency === 'CAD' && p.quantity === 1, 'currency_or_quantity');
  expect(typeof p.product === 'string' && p.product.length > 0 && p.product.length <= 250, 'product_required');
  expect(/^https:\/\/growthguys\.com\/shop\/[a-z0-9-]+\/$/.test(p.product_url), 'merchant_product_URL');
  const observed = new Date(p.observed_at);
  expect(Number.isFinite(observed.getTime()) && observed.toISOString() === p.observed_at && observed <= new Date(), 'exact_observation_timestamp');
  expect(dateInToronto(p.observed_at) === p.evidence_date, 'Toronto_evidence_date');
  expect(p.event_key === `${profile}-${p.evidence_date}-laptop-${observed.getTime()}`, 'event_identity');
  const scope = p.scope;
  expect(scope && scope.reached_checkout_payment_screen === true, 'checkout_boundary_required');
  for (const key of ['personal_details_entered', 'contact_details_entered', 'identity_entered', 'address_entered', 'payment_details_entered', 'order_submitted', 'payment_submitted']) expect(scope[key] === false, 'prohibited_action:' + key);
  expect(p.payment_method_selected === true && p.payment_method === 'Credit or Visa Debit' && p.gateway === 'gg_nmi', 'observed_payment_selection');
  expect(typeof p.payment_method_changed === 'boolean', 'payment_change_provenance');
  const apply = p.code_application;
  expect(apply && apply.code_entered === cfg.code && apply.final_visible_code === cfg.code.toLowerCase(), 'exact_applied_code');
  expect(Number.isSafeInteger(apply.input_capture_timestamp_ms) && Number.isSafeInteger(apply.apply_capture_timestamp_ms), 'application_timestamps');
  expect(apply.input_capture_timestamp_ms < apply.apply_capture_timestamp_ms && apply.apply_capture_timestamp_ms <= observed.getTime(), 'application_precedes_final_evidence');
  if (p.payment_method_changed) expect(apply.reapplied_after_payment_change === true, 'coupon_reapplication_after_payment_change');
  // One genuine site-specific checkout observation suffices. A second run or a
  // separate first-code capture is optional corroboration, never a prerequisite.
  const subtotal = cents(p.subtotal, 'subtotal'), discount = cents(p.discount, 'discount'), shipping = cents(p.shipping, 'shipping'), fee = cents(p.currency_fee_discount, 'currency_fee_discount'), total = cents(p.total, 'total');
  expect(subtotal > 0 && discount === Math.round(subtotal * 0.1), 'ten_percent_code_discount');
  expect(subtotal - discount + shipping - fee === total, 'checkout_total_components_do_not_reconcile');
  expect(p.bitcoin_adjustment === '0.00' && p.tax === null && p.tax_scope === 'no separate tax line displayed; no address entered', 'no_invented_bitcoin_or_tax');
  cents(p.charge_usd, 'displayed_USD_charge');
  expect(p.original_screenshot && p.source_excerpt, 'source_files_required');
  for (const source of [p.original_screenshot, p.source_excerpt]) {
    expect(typeof source.path === 'string' && /^[a-zA-Z0-9_.-]+$/.test(source.path), 'safe_local_evidence_path');
    const bytes = fs.readFileSync(path.join(dir, source.path));
    expect(bytes.length > 0 && bytes.length < 8 * 1024 * 1024 && digest(bytes) === source.sha256, 'original_or_excerpt_hash_mismatch');
  }
  const shot = fs.readFileSync(path.join(dir, p.original_screenshot.path));
  expect(shot.toString('ascii', 0, 4) === 'RIFF' && shot.toString('ascii', 8, 12) === 'WEBP', 'original_WebP_required');
  expect(p.original_screenshot.capture_timestamp_ms === observed.getTime() && p.original_screenshot.transformed === false, 'original_screenshot_exact_capture');
  expect(p.source_excerpt.derivative === true && p.source_excerpt.original_html_retained_privately === true, 'excerpt_derivative_label_required');
  expect(/^[a-f0-9]{64}$/.test(p.source_excerpt.original_html_sha256), 'original_HTML_digest_required');
  expect(p.source_excerpt.original_html_capture_timestamp_ms >= observed.getTime() && p.source_excerpt.original_html_capture_timestamp_ms - observed.getTime() < 15000, 'HTML_capture_continuity');
  const html = fs.readFileSync(path.join(dir, p.source_excerpt.path), 'utf8');
  expect(!/<script|<input|<form|<iframe|nonce|remove_item=|data-cart_item_key/i.test(html), 'public_excerpt_must_not_expose_checkout_tokens_or_fields');
  expect(html.includes(p.product) && html.includes('quantity: 1') && html.includes(p.product_url), 'product_evidence_match');
  const rows = [...html.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)].map(m => m[0]);
  const rowValue = (selector, label) => {
    const matches = rows.filter(selector); expect(matches.length === 1, 'unique_' + label + '_row');
    const td = matches[0].match(/<td\b[^>]*>([\s\S]*?)<\/td>/i)?.[1];
    const amount = text(td || '').match(/\$\s*(-?\d+\.\d{2})/);
    expect(amount, 'source_' + label + '_amount_missing');
    return Math.abs(Math.round(Number(amount[1]) * 100));
  };
  const coupons = rows.filter(x => /class="[^"]*cart-discount/.test(x));
  expect(coupons.length === 1 && coupons[0].includes('coupon-' + cfg.code.toLowerCase()) && text(coupons[0]).includes('Coupon: ' + cfg.code.toLowerCase()), 'single_matching_visible_coupon');
  expect(rowValue(x => /class="[^"]*cart-subtotal/.test(x), 'subtotal') === subtotal, 'source_subtotal_mismatch');
  expect(rowValue(x => /class="[^"]*cart-discount/.test(x), 'discount') === discount, 'source_discount_mismatch');
  expect(rowValue(x => /woocommerce-shipping-totals/.test(x), 'shipping') === shipping, 'source_shipping_mismatch');
  expect(rowValue(x => /Currency fee discount/.test(x), 'currency_fee') === fee, 'source_currency_fee_mismatch');
  expect(rowValue(x => /class="[^"]*order-total/.test(x), 'total') === total, 'source_total_mismatch');
  expect(text(html).includes('$' + p.charge_usd) && text(html).includes('USD'), 'source_displayed_USD_charge');
  expect(p.form_value_audit && Object.values(p.form_value_audit).every(value => value === ''), 'blank_personal_and_payment_fields_required');
  const previous = JSON.parse(fs.readFileSync('public/api/current-record.json', 'utf8'));
  expect(previous.code === cfg.code, 'previous_authoritative_site_record_mismatch');
  const alreadyCurrent = previous.evidence_event_key === p.event_key;
  if (alreadyCurrent) {
    expect(previous.source_record_reference === p.previous_record_reference && previous.observed_at === p.observed_at &&
      previous.evidence_sha256 === p.original_screenshot.sha256 && previous.product_name === p.product &&
      previous.product_url === p.product_url && previous.subtotal_cad === p.subtotal && previous.discount_cad === p.discount &&
      previous.shipping_cad === p.shipping && previous.currency_fee_discount_cad === p.currency_fee_discount &&
      previous.total_cad === p.total && previous.charge_usd === p.charge_usd && previous.publication_phase === 'owner_accepted', 'already_current_evidence_mismatch');
  } else {
    expect(previous.record_reference === p.previous_record_reference, 'previous_authoritative_site_record_mismatch');
    expect(observed > new Date(previous.observed_at), 'new_observation_must_follow_current_record');
  }
  return { status: alreadyCurrent ? 'validated_existing_checkout_record' : 'validated_checkout_candidate', profile, code: cfg.code, event_key: p.event_key, observed_at: p.observed_at, package_sha256: digest(fs.readFileSync(absolute)), screenshot_sha256: p.original_screenshot.sha256, subtotal: p.subtotal, discount: p.discount, shipping: p.shipping, currency_fee_discount: p.currency_fee_discount, total: p.total, validated_at: new Date().toISOString() };
}
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname)) {
  const receipt = validateCheckoutPackage(process.argv[2], process.env.SITE_PROFILE);
  if (process.argv[3]) fs.writeFileSync(process.argv[3], JSON.stringify(receipt, null, 2) + '\n');
  console.log(JSON.stringify(receipt));
}
