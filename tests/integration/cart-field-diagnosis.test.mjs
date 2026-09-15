import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { nativeFormBodyPolicy, forbiddenValueSemantic, evaluateForbiddenOperationField } from '../../scripts/amazon-cart-native-form.mjs';
import { createCartRouting, cartResearchConfig } from '../../scripts/amazon-cart-research-policy.mjs';
import { inspectSemantic } from '../../scripts/amazon-cart-research-evidence.mjs';

const runPath = 'outputs/M5_7_CART_m5-7-b0gyvhlp4l-thirteenth.json';
const run = existsSync(runPath) ? JSON.parse(readFileSync(runPath, 'utf8')) : null;
const live = run?.actionRequests?.find(row => row.sequence === 288);
const tuple = { category: 'BUY_NOW', fieldRole: 'ACTIVATION_FLAG', origin: 'FORM_FIELD', valueSemantic: 'NONZERO', activation: 'ACTIVE' };
const candidates = ['buyNow', 'isBuyNow', 'enableBuyNow', 'buyNowEnabled', 'buyNowFlag', 'isOneClick', 'oneClick'];
const asin = 'B0GYVHLP4L';
const base = `ASIN=${asin}&quantity=1&offerListingID=OPAQUE_FIXTURE&merchantID=FIXTURE`;
const contentType = 'application/x-www-form-urlencoded';

test('M5.7M Run 13 tuple is preserved with trusted Add-to-Cart, zero dispatch and no confirmation', { skip: !run }, () => {
  assert.deepEqual(live.nativeFormDiagnostics.forbiddenFieldStates, [tuple]);
  assert.equal(live.nativeFormDiagnostics.qualified, true);
  assert.equal(run.pinnedClickTargetDiagnostics.selected.name, 'submit.add-to-cart');
  assert.equal(run.cartRequestDispatchCount, 0); assert.equal(run.cartMutationCount, 0); assert.equal(run.cartConfirmed, false);
});

for (const name of candidates) test(`M5.7M authored ${name} reproduces identical live tuple, not unique identity`, () => {
  const result = nativeFormBodyPolicy(`${base}&${name}=2`, contentType, asin, true);
  assert.deepEqual(result.forbiddenFieldStates, [{ ...tuple, activation: 'INACTIVE' }]); assert.equal(result.forbiddenOperation, false);
});

test('M5.7M NONZERO is a lexical projection without a field-specific commerce contract', () => {
  for (const authoredNumeric of ['1', '2', '99']) {
    assert.equal(forbiddenValueSemantic(authoredNumeric, true), 'NONZERO');
    assert.equal(evaluateForbiddenOperationField({ category: 'BUY_NOW', origin: 'FORM_FIELD', valueSemantic: 'NONZERO', clickedSubmitAction: 'ADD_TO_CART' }), 'INACTIVE');
  }
  // Same output for seven distinct names and multiple values: it cannot identify
  // which field/version/flag contract applies. ACTIVE is a conservative code label.
  assert.equal(Object.hasOwn(tuple, 'fieldContract'), false);
  const source = readFileSync('scripts/amazon-cart-native-form.mjs', 'utf8');
  assert.match(source, /\['EMPTY', 'FALSEY_BOOLEAN', 'ZERO', 'ADD_TO_CART_ENUM', 'NONZERO'\]\.includes\(valueSemantic\)/);
});

test('M5.7M origin is deterministically unresolved; FORM_FIELD is hardcoded, not DOM provenance', { skip: !run }, () => {
  const names = run.pinnedClickTargetDiagnostics.selected.form.fieldNames;
  assert.ok(names.includes('REDACTED_NAME'));
  for (const name of candidates) assert.equal(names.includes(name), false);
  const state = live.nativeFormDiagnostics.forbiddenFieldStates[0];
  for (const key of ['fieldName', 'nameFingerprint', 'inputType', 'hidden', 'successfulControl', 'injectedByScript']) assert.equal(Object.hasOwn(state, key), false);
  assert.match(readFileSync('scripts/amazon-cart-native-form.mjs', 'utf8'), /origin: 'FORM_FIELD', valueSemantic, activation/);
  assert.equal(candidates.includes(run.pinnedClickTargetDiagnostics.selected.name), false);
});

function fixture(extra, patch = {}, noSubmit = false) {
  const config = cartResearchConfig({ AMAZON_CART_RESEARCH_ENABLED: '1' }, ['--asin', asin, '--action', 'ADD_TO_CART', '--operation-id', 'authored-m57m-fixture', '--max-price-mxn', '2000.00', '--expected-seller', 'amazon-retail-mx', '--ack-unknown-evidence', 'YES_RESEARCH_ONLY']);
  const router = createCartRouting(config);
  router.arm({ marketplace: 'MX', asin, identityMatched: true, availability: 'AVAILABLE', purchaseMode: 'IMMEDIATE', actionVisible: true, actionType: 'ADD_TO_CART', quantity: 1, cartCount: 0, itemPresent: false }, config.operationId);
  router.beginBrowserClick();
  const req = { url: 'https://www.amazon.com.mx/cart/add-to-cart/A', method: 'POST', type: 'document', main: true, body: base + extra, contentType, nativeEvidence: { qualified: !noSubmit, trustedClick: true, trustedSubmit: !noSubmit, productBound: true }, ...patch };
  return { router, decide: () => router.decide(req) };
}

test('M5.7M Add-to-Cart does not override true, explicit enum or submitted Buy Now', () => {
  for (const extra of ['&isBuyNow=true', '&isBuyNow=buy-now', '&submit.buy-now=']) assert.equal(fixture(extra).decide().allowed, false);
  assert.equal(fixture('&isBuyNow=2').decide().allowed, true);
  assert.equal(evaluateForbiddenOperationField({ category: 'BUY_NOW', clickedSubmitAction: 'BUY_NOW' }), 'ACTIVE');
});

test('M5.7M unknown field-specific semantics stay blocked and redacted', () => {
  const extra = '&buyNowToken=SECRET_CANARY&isBuyNow=SECRET_CANARY';
  const result = fixture(extra).decide();
  assert.equal(result.allowed, false); assert.ok(result.nativeForm.forbiddenFieldStates.every(s => s.activation === 'UNKNOWN'));
  assert.doesNotMatch(JSON.stringify({ result, evidence: inspectSemantic(base + extra, contentType, asin) }), /SECRET_CANARY|buyNowToken|isBuyNow/);
  assert.equal(fixture('', { body: 'unknown=1' }).decide().allowed, false);
});

test('M5.7M other operation paths and fields retain hard denies', () => {
  for (const name of ['checkout', 'place-order', 'submit-order', 'payment', 'address', 'gift-card', 'buy-now', 'account']) {
    assert.equal(fixture('', { url: 'https://www.amazon.com.mx/' + name }).decide().allowed, false);
    assert.equal(fixture('&' + name + '=true').decide().allowed, false);
  }
});

test('M5.7M native prerequisites and one reservation remain enforced', () => {
  assert.equal(fixture('&isBuyNow=0', {}, true).decide().allowed, false);
  for (const patch of [{ main: false }, { redirect: true }, { body: base.replace('quantity=1', 'quantity=2') }, { url: 'https://unagi.amazon.com.mx/cart/add-to-cart/A' }]) assert.equal(fixture('&isBuyNow=0', patch).decide().allowed, false);
  const f = fixture('&isBuyNow=0'); assert.equal(f.decide().allowed, true); assert.equal(f.decide().allowed, false); assert.equal(f.router.counts.cartRequests, 1);
});

test('M5.7M decision/native policy remain identical; runtime/CLI baseline preserved before N diagnostics', { skip: !existsSync('outputs/M5_7L_SECURITY_REVIEW.json') || !existsSync('outputs/M5_7L_SOURCE_BASELINE.json') || !existsSync('outputs/M5_7N_SOURCE_BASELINE.json') }, () => {
  const prior = JSON.parse(readFileSync('outputs/M5_7L_SECURITY_REVIEW.json', 'utf8'));
  const hash = file => createHash('sha256').update(readFileSync(file)).digest('hex');
  for (const file of ['scripts/amazon-cart-native-form.mjs', 'scripts/amazon-cart-research-policy.mjs']) assert.equal(hash(file), prior.sourceSha256[file]);
  const baseline = JSON.parse(readFileSync('outputs/M5_7L_SOURCE_BASELINE.json', 'utf8'));
  assert.equal(hash('scripts/amazon-cart-research-evidence.mjs'), baseline['scripts/amazon-cart-research-evidence.mjs'].sha256);
  const n = JSON.parse(readFileSync('outputs/M5_7N_SOURCE_BASELINE.json', 'utf8'));
  assert.equal(n['scripts/amazon-cart-research-runtime.mjs'].sha256, baseline['scripts/amazon-cart-research-runtime.mjs'].sha256);
  assert.equal(n['scripts/amazon-cart-research.mjs'].sha256, prior.sourceSha256['scripts/amazon-cart-research.mjs']);
  assert.equal(hash('packages/adapters/src/amazon/providers/browser.ts'), 'ed228a024ba4efd810cfbbf31ac42958453b39733c2da8920d0de086546d918f');
});

test('M5.7O all fourteen original guards remain consumed; no fifteenth operation created', { skip: !existsSync('work/m5.7-operations') }, () => {
  const guards = readdirSync('work/m5.7-operations').filter(n => n.endsWith('.json')).map(n => JSON.parse(readFileSync('work/m5.7-operations/' + n, 'utf8')));
  const suffixes = ['first', 'second', 'third', 'fourth', 'fifth', 'sixth', 'seventh', 'eighth', 'ninth', 'tenth', 'eleventh', 'twelfth', 'thirteenth', 'fourteenth'];
  for (const s of suffixes) assert.equal(guards.find(g => g.operationId === 'm5-7-b0gyvhlp4l-' + s)?.status, 'CONSUMED_BEFORE_BROWSER');
  assert.equal(guards.some(g => g.operationId === 'm5-7-b0gyvhlp4l-fifteenth'), false);
});
