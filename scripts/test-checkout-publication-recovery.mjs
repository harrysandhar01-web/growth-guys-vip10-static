import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { validateCheckoutPackage } from './validate-checkout-evidence.mjs';

const root = process.cwd();
const profile = 'vip10';
const archiveId = 'vip10-owner-20261126064107-45774662911';
const fixture = path.join(root, 'public/evidence/2026-11-26-' + profile + '-laptop-checkout/checkout-package.json');
const pkg = JSON.parse(fs.readFileSync(fixture, 'utf8'));
const previous = path.join(root, 'public/owner-records', pkg.previous_record_reference, 'record.json');
const accepted = path.join(root, 'public/owner-records', archiveId, 'record.json');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), profile + '-checkout-regression-'));
try {
  fs.mkdirSync(path.join(tmp, 'public/api'), {recursive:true});
  fs.cpSync(path.dirname(fixture), path.join(tmp, 'evidence'), {recursive:true});
  const copy = path.join(tmp, 'evidence/checkout-package.json');
  process.chdir(tmp);
  fs.copyFileSync(previous, 'public/api/current-record.json');
  assert.equal(validateCheckoutPackage(copy, profile).status, 'validated_checkout_candidate');
  if (profile === 'growth10') {
    const independent = structuredClone(pkg);
    independent.code_application = { ...independent.code_application, session_mode:'independent',
      clean_cart_confirmed:true, no_prior_coupon_confirmed:true,
      clean_cart_capture_timestamp_ms:independent.code_application.input_capture_timestamp_ms - 1000 };
    for (const key of ['first_code_evidence_retained','checkout_refreshed','first_coupon_absent_before_application','first_coupon_removal_settled_timestamp_ms']) delete independent.code_application[key];
    fs.writeFileSync(copy, JSON.stringify(independent));
    assert.equal(validateCheckoutPackage(copy, profile).status, 'validated_checkout_candidate');
    independent.code_application.clean_cart_confirmed = false;
    fs.writeFileSync(copy, JSON.stringify(independent));
    assert.throws(() => validateCheckoutPackage(copy, profile), /independent_clean_cart_required/);
    fs.copyFileSync(fixture, copy);
  }
  fs.copyFileSync(accepted, 'public/api/current-record.json');
  assert.equal(validateCheckoutPackage(copy, profile).status, 'validated_existing_checkout_record');
  const altered = JSON.parse(fs.readFileSync('public/api/current-record.json','utf8'));
  altered.total_cad = '0.00';
  fs.writeFileSync('public/api/current-record.json',JSON.stringify(altered));
  assert.throws(() => validateCheckoutPackage(copy, profile), /already_current_evidence_mismatch/);
  fs.copyFileSync(accepted, 'public/api/current-record.json');
  const modified = structuredClone(pkg);
  modified.original_screenshot.sha256 = '0'.repeat(64);
  fs.writeFileSync(copy,JSON.stringify(modified));
  assert.throws(() => validateCheckoutPackage(copy, profile), /hash_mismatch/);
  console.log(profile + ' original evidence, independent provenance (where applicable), idempotence and tamper rejection passed');
} finally {
  process.chdir(root);
  fs.rmSync(tmp,{recursive:true,force:true});
}
