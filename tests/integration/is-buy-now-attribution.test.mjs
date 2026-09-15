import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { authoritativeRun14, inspectPassiveIsBuyNowForms, summarizeLoadedIsBuyNowReferences } from '../../scripts/amazon-is-buy-now-attribution.mjs';
import { correlateBuyNowFields } from '../../scripts/amazon-buy-now-diagnostics.mjs';
import { nativeFormBodyPolicy } from '../../scripts/amazon-cart-native-form.mjs';

const asin = 'B0GYVHLP4L';
const immutable = JSON.parse(readFileSync('outputs/M5_7_CART_m5-7-b0gyvhlp4l-fourteenth.json', 'utf8'));
const mutable = JSON.parse(readFileSync('outputs/M5_7N_CART_CORRELATION_RESULT.json', 'utf8'));
test('M5.7O immutable first run supersedes the mutable fenced retry for attribution', () => {
  const result = authoritativeRun14(immutable, mutable);
  assert.equal(result.snapshot, immutable); assert.equal(result.mutableSummaryIsFencedRetry, true);
  assert.equal(result.snapshot.clickAttemptCount, 1); assert.equal(mutable.clickAttemptCount, 0);
  assert.equal(result.snapshot.cartRequestDispatchCount, 0); assert.equal(result.snapshot.cartMutationCount, 0);
  assert.throws(() => authoritativeRun14(null, mutable), /AUTHORITATIVE_RUN14_REQUIRED/);
});

test('M5.7O exact hidden IS_BUY_NOW correlation and trusted Add-to-Cart are preserved', () => {
  const c = immutable.buyNowFieldCorrelation;
  assert.equal(c.serializedBuyNowCandidateKey, 'IS_BUY_NOW'); assert.equal(c.correlation, 'HIDDEN_DOM_FIELD');
  assert.equal(c.domCandidates[0].inputType, 'hidden'); assert.equal(c.domCandidates[0].isClickedSubmitter, false);
  assert.equal(c.domCandidates[0].successfulControlCandidate, true);
  assert.equal(immutable.clickedSubmitter.trusted, true); assert.equal(immutable.clickedSubmitter.nameClass, 'ADD_TO_CART');
  const derived = correlateBuyNowFields({ complete: true, domCandidates: c.domCandidates }, 'isBuyNow=2', 'application/x-www-form-urlencoded', [{ activation: 'ACTIVE' }]);
  assert.equal(derived.correlation, c.correlation); assert.equal(derived.numericSemanticInterpretation.sourceContractKnown, false);
});

function form(role, value) {
  const f = { method: 'post', action: 'https://www.amazon.com.mx/' + (role === 'BUY_NOW' ? 'buy/checkout' : 'cart/add-to-cart/A'), elements: [] };
  const item = (name, val, type = 'hidden') => ({ name, value: val, type, form: f, disabled: false, matches: () => false });
  f.elements = [item('ASIN', asin), item('quantity', '1'), item('offerListingID', 'SECRET_CANARY'), item('merchantID', 'SECRET_CANARY'), item('isBuyNow', value), item(role === 'BUY_NOW' ? 'submit.buy-now' : 'submit.add-to-cart', '', 'submit')];
  f.submit = () => assert.fail('No submission'); f.requestSubmit = f.submit;
  return f;
}

for (const [value, semantic] of [['0', 'ZERO'], ['2', 'NONZERO'], ['', 'EMPTY'], ['SECRET_CANARY', 'NON_NUMERIC']]) test(`M5.7O passive form comparison stores only ${semantic}`, () => {
  const result = inspectPassiveIsBuyNowForms({ querySelectorAll: () => [form('ADD_TO_CART', value), form('BUY_NOW', value)] }, asin);
  assert.deepEqual(result.forms.map(f => f.formRole), ['ADD_TO_CART', 'BUY_NOW']);
  assert.deepEqual(result.forms.map(f => f.actionPathClass), ['CART_ADD', 'BUY_OR_CHECKOUT']);
  assert.ok(result.forms.every(f => f.fields[0].valueSemantic === semantic && f.clickedRelevance === 'NO_ACTION_PERFORMED'));
  assert.doesNotMatch(JSON.stringify(result), /SECRET_CANARY|offerListingID|merchantID/);
});

test('M5.7O shared controls are not attributed uniquely to either purchase action', () => {
  const f = form('ADD_TO_CART', '2'); f.elements.push({ name: 'submit.buy-now', type: 'submit', form: f });
  const result = inspectPassiveIsBuyNowForms({ querySelectorAll: () => [f] }, asin);
  assert.equal(result.forms[0].formRole, 'OTHER'); assert.equal(result.forms[0].submitControlsPresent.length, 2);
});

test('M5.7O unrelated ASIN forms are excluded and no missing form comparison is fabricated', () => {
  const f = form('ADD_TO_CART', '2'); f.elements[0].value = 'B0H78BB9TY';
  assert.deepEqual(inspectPassiveIsBuyNowForms({ querySelectorAll: () => [f] }, asin).forms, []);
});

test('M5.7O loaded-source attribution never executes snippets or retains source secrets', () => {
  const result = summarizeLoadedIsBuyNowReferences([{ sourceClass: 'INLINE_SCRIPT', alreadyLoaded: true, text: 'throw new Error("SECRET_CANARY"); if (isBuyNow) unknownHandler();' }]);
  assert.equal(result.findings[0].sourceClass, 'INLINE_SCRIPT'); assert.equal(result.findings[0].occurrences, 1);
  assert.equal(result.confidence, 'INSUFFICIENT_EVIDENCE'); assert.equal(result.meaning, 'UNKNOWN');
  assert.doesNotMatch(JSON.stringify(result), /SECRET_CANARY|unknownHandler|throw/);
  assert.deepEqual(summarizeLoadedIsBuyNowReferences([{ sourceClass: 'LOADED_PUBLIC_SCRIPT', alreadyLoaded: false, text: 'isBuyNow' }]).findings, []);
});

test('M5.7O ACTIVE and UNKNOWN remain blocked even with otherwise qualified Add-to-Cart', () => {
  const body = `ASIN=${asin}&quantity=1&offerListingID=OPAQUE&merchantID=FIXTURE`;
  for (const suffix of ['isBuyNow=2', 'isBuyNow=true', 'isBuyNow=OPAQUE', 'submit.buy-now=']) assert.equal(nativeFormBodyPolicy(body + '&' + suffix, 'application/x-www-form-urlencoded', asin, true).forbiddenOperation, true);
});

test('M5.7O routing/runtime/native source and production provider are unchanged', () => {
  const hash = p => createHash('sha256').update(readFileSync(p)).digest('hex');
  const prior = JSON.parse(readFileSync('outputs/M5_7N_SECURITY_REVIEW.json', 'utf8'));
  for (const p of ['scripts/amazon-cart-research-runtime.mjs', 'scripts/amazon-cart-research.mjs']) assert.equal(hash(p), prior.sourceSha256[p]);
  const base = JSON.parse(readFileSync('outputs/M5_7N_SOURCE_BASELINE.json', 'utf8'));
  for (const p of ['scripts/amazon-cart-native-form.mjs', 'scripts/amazon-cart-research-policy.mjs']) assert.equal(hash(p), base[p].sha256);
  assert.equal(hash('packages/adapters/src/amazon/providers/browser.ts'), 'ed228a024ba4efd810cfbbf31ac42958453b39733c2da8920d0de086546d918f');
  const source = readFileSync('scripts/amazon-is-buy-now-attribution.mjs', 'utf8');
  assert.doesNotMatch(source, /\bfetch\s*\(|axios|undici|request\.newContext|\.submit\s*\(|\.requestSubmit\s*\(|\.click\s*\(|dispatchEvent|\beval\s*\(/);
});
