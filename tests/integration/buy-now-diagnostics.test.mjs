import test from 'node:test';
import assert from 'node:assert/strict';
import { runInNewContext } from 'node:vm';
import { readFileSync } from 'node:fs';
import { candidateKeys, buyNowCandidateKey, successfulControlCandidate, installBuyNowDomDiagnostics, sanitizeDomCandidates, sanitizedSubmitter, correlateBuyNowFields } from '../../scripts/amazon-buy-now-diagnostics.mjs';

const control = { candidateKey: 'IS_BUY_NOW', tagName: 'INPUT', inputType: 'hidden', hiddenByType: true, visible: false, enabled: true, disabled: false, checked: null, selected: null, isSubmitControl: false, isClickedSubmitter: false, belongsToQualifiedForm: true, hasName: true };
const snapshot = (...controls) => ({ complete: true, domCandidates: controls });
const correlate = (dom, body = 'isBuyNow=2', states = [{ activation: 'ACTIVE' }]) => correlateBuyNowFields(dom, body, 'application/x-www-form-urlencoded', states);

for (const [key, value] of Object.entries(candidateKeys)) test(`M5.7N exact candidate mapping ${key}`, () => {
  assert.equal(buyNowCandidateKey(key), value); assert.equal(buyNowCandidateKey(key.toUpperCase()), value);
  assert.equal(correlate(snapshot(), `${key}=2`).serializedBuyNowCandidateKey, value);
});

test('M5.7N unknown names and raw values never enter diagnostic output', () => {
  for (const name of ['unknownSecret', 'buyNowToken', '__proto__', 'constructor', 'isBuyNow99']) assert.equal(buyNowCandidateKey(name), 'UNKNOWN');
  const r = correlate(snapshot({ ...control, candidateKey: 'SECRET_CANARY', value: 'SECRET_CANARY' }), 'unknownSecret=SECRET_CANARY&isBuyNow=SECRET_CANARY');
  assert.doesNotMatch(JSON.stringify(r), /SECRET_CANARY|unknownSecret/); assert.equal(r.serializedValueSemantic, 'UNKNOWN');
});

for (const [patch, expected] of [
  [{}, true], [{ disabled: true }, false], [{ enabled: false }, false], [{ hasName: false }, false], [{ belongsToQualifiedForm: false }, false],
  [{ inputType: 'checkbox', checked: false }, false], [{ inputType: 'radio', checked: false }, false], [{ inputType: 'checkbox', checked: true }, true],
  [{ inputType: 'submit', isSubmitControl: true }, false], [{ inputType: 'submit', isSubmitControl: true, isClickedSubmitter: true }, true],
  [{ inputType: 'button' }, false], [{ tagName: 'SELECT', inputType: 'select-one', selected: false }, false], [{ tagName: 'SELECT', inputType: 'select-one', selected: true }, true]
]) test(`M5.7N successful-control approximation ${JSON.stringify(patch)}`, () => assert.equal(successfulControlCandidate({ ...control, ...patch }), expected));

for (const [dom, body, expected] of [
  [snapshot(control), 'isBuyNow=2', 'HIDDEN_DOM_FIELD'],
  [snapshot({ ...control, inputType: 'submit', isSubmitControl: true, hiddenByType: false }), 'isBuyNow=2', 'NON_CLICKED_SUBMIT_CONTROL'],
  [snapshot({ ...control, inputType: 'number', hiddenByType: false, visible: true }), 'isBuyNow=2', 'VISIBLE_NON_SUBMIT_FIELD'],
  [snapshot({ ...control, hiddenByType: false }), 'isBuyNow=2', 'EXACT_DOM_CONTROL'],
  [snapshot(), 'isBuyNow=2', 'BODY_ONLY_NOT_IN_DOM'], [snapshot(control, control), 'isBuyNow=2', 'MULTIPLE_AMBIGUOUS'],
  [snapshot(control), 'isBuyNow=2&oneClick=1', 'MULTIPLE_AMBIGUOUS'], [snapshot(), 'unknown=1', 'NO_MATCH'],
  [{ complete: false, domCandidates: [] }, 'isBuyNow=2', 'UNKNOWN']
]) test(`M5.7N correlation ${expected}`, () => {
  const r = correlate(dom, body); assert.equal(r.correlation, expected); assert.deepEqual(r.numericSemanticInterpretation, { sourceContractKnown: false, interpretation: 'UNKNOWN' });
});

test('M5.7N duplicate serialized keys remain MULTIPLE and body bounds remain unknown', () => {
  assert.equal(correlate(snapshot(), 'isBuyNow=2&isBuyNow=2').serializedBuyNowCandidateKey, 'MULTIPLE');
  assert.equal(correlate(snapshot(), 'x'.repeat(65537)).serializedBuyNowCandidateKey, 'UNKNOWN');
  assert.equal(correlate(snapshot(), 'x=1&'.repeat(201)).correlation, 'UNKNOWN');
  assert.equal(correlateBuyNowFields(snapshot(), 'isBuyNow=2', 'application/json').correlation, 'UNKNOWN');
});

test('M5.7N body state alignment includes preceding forbidden fields and encoded names', () => {
  const r = correlate(snapshot(control), 'checkout=true&is%2542uyNow=2', [{ activation: 'ACTIVE' }, { activation: 'UNKNOWN' }]);
  assert.equal(r.serializedBuyNowCandidateKey, 'IS_BUY_NOW'); assert.equal(r.currentActivationState, 'UNKNOWN');
});

function browserFixture() {
  const listeners = {}; const seen = []; const form = { elements: [] };
  const node = { form, isConnected: true, name: 'submit.add-to-cart', id: 'add-to-cart-button', value: 'Agregar al carrito', getAttribute: () => null };
  const hidden = { form, name: 'isBuyNow', tagName: 'INPUT', type: 'hidden', disabled: false, matches: () => false, getClientRects: () => [] };
  Object.defineProperty(hidden, 'value', { get() { throw Error('Candidate raw value must not be read'); } });
  const unrelated = { name: 'session-token' }; Object.defineProperty(unrelated, 'value', { get() { throw Error('Unrelated secret read'); } });
  form.elements = [hidden, unrelated];
  class NativeEvent { }
  const context = { node, keys: candidateKeys, report: async v => seen.push(sanitizedSubmitter(v)), document: { addEventListener: (n, fn, opts) => { assert.equal(opts.passive, true); listeners[n] = fn; } }, Event: NativeEvent, getComputedStyle: () => ({ visibility: 'visible', display: 'none' }) };
  const result = runInNewContext(`(${installBuyNowDomDiagnostics.toString()})(node, {keys, report})`, context);
  return { result, form, node, listeners, seen, NativeEvent };
}

test('M5.7N browser inventory identifies hidden candidate without reading raw candidate/secret values', () => {
  const f = browserFixture(); const d = sanitizeDomCandidates(f.result); assert.equal(d.complete, true); assert.equal(d.domCandidates.length, 1);
  assert.equal(d.domCandidates[0].candidateKey, 'IS_BUY_NOW'); assert.equal(d.domCandidates[0].hiddenByType, true); assert.equal(d.domCandidates[0].successfulControlCandidate, true);
});

test('M5.7N submit diagnostics derive actual name/id/label/trust without granting authority', async () => {
  const f = browserFixture();
  await f.listeners.submit(Object.assign(new f.NativeEvent(), { target: f.form, submitter: f.node, isTrusted: true }));
  assert.deepEqual(f.seen[0], { nameClass: 'ADD_TO_CART', idClass: 'ADD_TO_CART_BUTTON', actionLabel: 'ADD_TO_CART', trusted: true });
  f.node.name = 'submit.buy-now'; f.node.id = 'buy-now-button'; f.node.value = 'Comprar ahora';
  await f.listeners.submit(Object.assign(new f.NativeEvent(), { target: f.form, submitter: f.node, isTrusted: true }));
  assert.equal(f.seen[1].nameClass, 'BUY_NOW'); assert.equal(f.seen[1].actionLabel, 'BUY_NOW');
  await f.listeners.submit({ target: f.form, submitter: f.node, isTrusted: true }); assert.equal(f.seen[2].trusted, false);
});

test('M5.7N policy and native event/activation source remain exactly unchanged', () => {
  const baseline = JSON.parse(readFileSync('outputs/M5_7N_SOURCE_BASELINE.json', 'utf8'));
  for (const file of ['scripts/amazon-cart-research-policy.mjs', 'scripts/amazon-cart-native-form.mjs']) assert.equal(readFileSync(file, 'utf8'), baseline[file].source);
  const source = readFileSync('scripts/amazon-buy-now-diagnostics.mjs', 'utf8');
  assert.doesNotMatch(source, /\bfetch\s*\(|axios|undici|request\.newContext|\.submit\s*\(|requestSubmit|dispatchEvent|\.click\s*\(/);
});
