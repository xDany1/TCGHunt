import test from 'node:test';
import assert from 'node:assert/strict';
import { runInNewContext } from 'node:vm';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { inspectCartControls, installCartEventObservers, sanitizedDomEvent, publicLocation, installInitiatorDiagnostics } from '../../scripts/amazon-cart-causality.mjs';
import { prepareViewportControl, scrollPinnedControl } from '../../scripts/amazon-cart-viewport.mjs';
import { cartResearchConfig, createCartRouting } from '../../scripts/amazon-cart-research-policy.mjs';
import { installPinnedCartObservers, immutableNativeEvent, nativeCartCausality } from '../../scripts/amazon-cart-native-form.mjs';
import { sanitizedRouteFailure } from '../../scripts/amazon-cart-route-diagnostics.mjs';
const asin = 'B0GYVHLP4L'; const url = `https://www.amazon.com.mx/dp/${asin}`; const secret = 'SECRET_CANARY';
function domFixture(patches = [{}]) {
  const nodes = patches.map((p, index) => {
    const attrs = { 'aria-label': 'Agregar al carrito', 'data-action': secret, 'data-session-secret': secret, onclick: secret, ...p.attrs };
    const fields = [{ name: 'ASIN', value: p.asin ?? asin }, { name: 'quantity', value: '1' }, { name: 'csrfToken', value: secret }, { name: secret, value: secret }];
    const form = { action: `https://www.amazon.com.mx/cart/add-to-cart/${secret}?session=${secret}`, method: 'post', target: '', enctype: 'application/x-www-form-urlencoded', querySelectorAll: () => fields };
    const region = { getAttribute: () => asin };
    const node = {
      id: p.id ?? 'add-to-cart-button', name: 'submit.add-to-cart', tagName: p.tagName ?? 'INPUT', type: 'submit', value: 'Agregar al carrito', disabled: p.disabled ?? false, isConnected: p.connected ?? true, textContent: 'Agregar al carrito', form: p.noForm ? null : form,
      getAttribute: k => attrs[k] ?? null, hasAttribute: k => k in attrs, getAttributeNames: () => Object.keys(attrs),
      getBoundingClientRect: () => ({ x: p.x ?? index * 100, y: p.y ?? 0, width: 50, height: 30 }), getClientRects: () => p.hidden ? [] : [{}],
      closest: selector => selector === 'form' ? p.noForm ? null : form : selector.includes('sims-') ? p.recommendation ? {} : null : selector.startsWith('#buybox') ? region : null,
      contains: n => n === node, style: { visibility: 'visible', display: 'block' }, patch: p
    };
    return node;
  });
  const doc = { querySelectorAll: selector => selector.startsWith('[role="dialog"]') ? [] : selector === '[id="add-to-cart-button"]' ? nodes.filter(n => n.id === 'add-to-cart-button') : nodes, elementFromPoint: (x, y) => { const node = nodes.find(n => { const r = n.getBoundingClientRect(); return x >= r.x && x < r.x + r.width && y >= r.y && y < r.y + r.height; }); return node?.patch.overlay ? node.patch.overlay === true ? {} : node.patch.overlay : node; }, body: { innerText: '' }, querySelector: () => null };
  const context = { document: doc, location: { href: url }, innerWidth: 1000, innerHeight: 800, scrollX: 0, scrollY: 0, URL, getComputedStyle: n => n.style ?? {}, config: { asin, action: 'ADD_TO_CART' }, pinned: null };
  return { nodes, context, inspect(pinned = null, finalClickQualification = true) { context.pinned = pinned; context.config.finalClickQualification = finalClickQualification; return JSON.parse(JSON.stringify(runInNewContext(`(${inspectCartControls.toString()})(${pinned ? 'pinned, config' : 'config'})`, context))); } };
}
test('M5.7E exact control/form semantics retain only safe names and projections', () => {
  const f = domFixture(); const d = f.inspect(f.nodes[0]);
  assert.equal(d.selected.tagName, 'INPUT'); assert.equal(d.selected.inputType, 'submit'); assert.equal(d.selected.id, 'add-to-cart-button'); assert.equal(d.selected.ariaLabel, 'ADD_TO_CART');
  assert.equal(d.selected.form.method, 'POST'); assert.equal(d.selected.form.action.pathPattern, '/cart/add-to-cart/:redacted');
  assert.equal(d.selected.form.expectedAsinMatched, true); assert.equal(d.selected.form.quantityMatched, true); assert.equal(d.selected.onclickPresent, true); assert.equal(d.selected.jsListenerBinding, 'UNKNOWN');
  assert.equal(d.pinnedMatchesSelection, true); assert.doesNotMatch(JSON.stringify(d), /SECRET_CANARY|session=/);
});
for (const [patch, reason] of [[{ hidden: true }, 'HIDDEN'], [{ disabled: true }, 'DISABLED'], [{ overlay: true }, 'OBSCURED_BY_UNKNOWN'], [{ recommendation: true }, 'RECOMMENDATION'], [{ connected: false }, 'DETACHED'], [{ asin: 'B0H78BB9TY' }, 'NOT_PRODUCT_BOUND'], [{ tagName: 'DIV' }, 'NOT_ACTION_CONTROL'], [{ id: 'recommendation-add-to-cart' }, 'NON_PRIMARY']]) test(`M5.7E rejects ${reason} control`, () => {
  const d = domFixture([patch]).inspect(); assert.equal(d.selectedPrimaryIndex, null); assert.ok(d.candidates[0].rejectionReasons.includes(reason));
});
test('M5.7E duplicate selection is deterministic and pins identity without fallback', () => {
  const f = domFixture([{ hidden: true }, {}]); const d = f.inspect(f.nodes[1]); assert.equal(d.candidateCount, 2); assert.equal(d.selectedPrimaryIndex, 1); assert.equal(d.pinnedMatchesSelection, true);
  assert.equal(f.inspect(f.nodes[0]).pinnedMatchesSelection, false); assert.equal(domFixture([{}, {}]).inspect().selectionReason, 'AMBIGUOUS_PRIMARY_CONTROLS');
});
test('M5.7E anchor/no-form semantics do not invent form submission or JS binding', () => {
  const d = domFixture([{ tagName: 'A', noForm: true, attrs: { href: `https://www.amazon.com.mx/cart/${secret}?token=${secret}` } }]).inspect();
  assert.equal(d.selected, null); assert.equal(d.preselected, null); assert.equal(d.candidates[0].formPresent, false); assert.equal(d.candidates[0].form, null); assert.equal(d.candidates[0].hrefHostAndPathPattern.pathPattern, '/cart/:redacted'); assert.doesNotMatch(JSON.stringify(d), /SECRET_CANARY/);
});
test('M5.7E passive event observers do not cancel or replace default behavior', async () => {
  const callbacks = {}; const events = []; const target = { closest: () => ({ id: 'add-to-cart-button' }) };
  runInNewContext(`(${installCartEventObservers.toString()})()`, { document: { addEventListener: (name, fn, options) => { assert.equal(options.capture, true); assert.equal(options.passive, true); callbacks[name] = fn; } }, Date, queueMicrotask, window: { __astraCartDiagnostic: async e => events.push(e) } });
  const event = { target, isTrusted: true, defaultPrevented: false, preventDefault: () => assert.fail('Must not cancel'), stopPropagation: () => assert.fail('Must not interfere') };
  callbacks.click(event); callbacks.submit({ ...event, submitter: { id: 'add-to-cart-button' } }); await new Promise(resolve => queueMicrotask(resolve));
  assert.deepEqual(events.map(e => e.kind), ['DOM_CLICK_EVENT_OBSERVED', 'FORM_SUBMIT_EVENT_OBSERVED']); assert.equal(event.defaultPrevented, false);
  const safe = sanitizedDomEvent({ ...events[0], body: secret, cookies: secret }); assert.doesNotMatch(JSON.stringify(safe), /SECRET_CANARY/); assert.equal(sanitizedDomEvent({ kind: secret, at: 1 }), null);
});
test('M5.7E unagi public-path vocabulary cannot expose opaque identifiers or query values', () => {
  const d = publicLocation(`https://unagi.amazon.com.mx/1/events/com.amazon.csm.csa.prod/${secret}?token=${secret}#${secret}`, url);
  assert.equal(d.normalizedHostLabel, 'unagi.amazon.com.mx'); assert.equal(d.pathPattern, '/1/events/com.amazon.csm.csa.prod/:redacted'); assert.equal(d.approvedAuthorityMatch, false); assert.doesNotMatch(JSON.stringify(d), /SECRET_CANARY/);
  assert.equal(publicLocation('https://fls-na.amazon.com.mx/1/metrics', url).approvedAuthorityMatch, false);
});
test('M5.7E CDP is passive, sanitized, uniquely matched and never claims click causality from timing alone', async () => {
  let listener; const commands = []; let detached = 0;
  const observer = await installInitiatorDiagnostics({ newCDPSession: async () => ({ on: (_event, cb) => { listener = cb; }, send: async command => commands.push(command), detach: async () => { detached++; } }) }, {}, url, { now: () => 20 });
  const rawUrl = `https://unagi.amazon.com.mx/1/events/${secret}?token=${secret}`;
  listener({ requestId: secret, request: { url: rawUrl, method: 'POST', headers: { cookie: secret }, postData: secret }, documentURL: url + `?cookie=${secret}`, type: 'XHR', wallTime: 0.02, initiator: { type: 'script', stack: { callFrames: [{ url: url + `?session=${secret}`, functionName: secret }] } } });
  const row = { sequence: 1, requestObservedAt: 20, phaseAtObservation: 'ACTION' }; observer.bind(rawUrl, 'POST', row); const records = observer.finish(10);
  assert.deepEqual(commands, ['Network.enable']); assert.equal(row.initiatorEvidence.initiatorType, 'script'); assert.equal(row.initiatorEvidence.match, 'UNIQUE_URL_METHOD'); assert.equal(row.relativeToClickMs, 10); assert.match(row.clickCausality, /NOT_PROOF/);
  assert.doesNotMatch(JSON.stringify({ row, records }), /SECRET_CANARY|functionName|requestId|postData/); await observer.close(); assert.equal(detached, 1);
});
test('M5.7E missing or ambiguous initiators remain unknown and pre-click path is not a dispatch', async () => {
  let listener; const observer = await installInitiatorDiagnostics({ newCDPSession: async () => ({ on: (_event, cb) => { listener = cb; }, send: async () => { }, detach: async () => { } }) }, {}, url, { now: () => 1 });
  const raw = url + '/opaque'; const e = { request: { url: raw, method: 'GET' }, initiator: { type: 'parser' }, type: 'XHR' }; listener(e); listener(e);
  const row = { phaseAtObservation: 'BASELINE', qualifiedCartPathMatch: true, requestObservedAt: 1 }; observer.bind(raw, 'GET', row); observer.finish(10);
  assert.equal(row.initiatorEvidence.match, 'AMBIGUOUS'); assert.equal(row.clickCausality, 'PRECLICK_CART_PATH_OBSERVATION'); assert.equal(row.relativeToClickMs, -9); await observer.close();
  const unavailable = await installInitiatorDiagnostics({}, {}, url, { now: () => 1 }); assert.equal(unavailable.status, 'UNAVAILABLE'); await unavailable.close();
});
test('M5.7E observer source introduces no HTTP, replay, interception or event cancellation', () => {
  const source = readFileSync('scripts/amazon-cart-causality.mjs', 'utf8'); assert.doesNotMatch(source, /\bfetch\s*\(|axios|undici|\.submit\s*\(|\.preventDefault\s*\(|\.stopPropagation\s*\(|Fetch\.enable|Network\.replay|setCookie|setExtraHTTPHeaders/);
  assert.deepEqual([...source.matchAll(/session\.send\('([^']+)'/g)].map(m => m[1]), ['Network.enable']);
});

function overlayFixture(modal = false, chrome = false) {
  const overlay = { tagName: chrome ? 'HEADER' : 'DIV', id: secret, classList: ['a-popover', secret], style: { position: chrome ? 'fixed' : 'absolute', zIndex: '1234' }, getAttribute: k => k === 'role' && modal ? 'dialog' : null, closest: selector => modal && selector.startsWith('[role="dialog"]') ? overlay : null, contains: () => false, getClientRects: () => [{}], getBoundingClientRect: () => ({ x: 0, y: 0, width: 1000, height: 800 }) };
  return overlay;
}
test('M5.7F offscreen and partially clipped geometry differ from genuine obstruction', () => {
  const outside = domFixture([{ y: 900 }]).inspect(); const c = outside.candidates[0];
  assert.equal(c.obstruction, 'OUTSIDE_VIEWPORT'); assert.equal(c.geometry.viewportHeight, 800); assert.equal(c.geometry.elementCenterInsideViewport, false); assert.equal(c.geometry.intersectionRatio, 0); assert.equal(outside.pinnablePrimaryIndex, 0); assert.equal(outside.selectedPrimaryIndex, null);
  const partial = domFixture([{ x: -10 }]).inspect().candidates[0]; assert.equal(partial.geometry.elementCenterInsideViewport, true); assert.equal(partial.geometry.intersectionRatio, 0.8); assert.equal(partial.obstruction, 'OUTSIDE_VIEWPORT');
  const covered = domFixture([{ overlay: true }]).inspect().candidates[0]; assert.equal(covered.geometry.intersectionRatio, 1); assert.equal(covered.obstruction, 'OBSCURED_BY_UNKNOWN');
});
test('M5.7F center and interior hit tests require the target or contained child, never its ancestor', () => {
  const f = domFixture(); const node = f.nodes[0]; const child = { tagName: 'SPAN', closest: () => null }; node.contains = n => n === node || n === child;
  f.context.document.elementFromPoint = () => child; assert.equal(f.inspect().selected.unobscured, true);
  const ancestor = { tagName: 'DIV', contains: n => n === node, closest: () => null }; f.context.document.elementFromPoint = () => ancestor;
  assert.equal(f.inspect().candidates[0].unobscured, false); assert.equal(f.inspect().candidates[0].geometry.hitTests[0].topElementContainsTarget, true);
  f.context.document.elementFromPoint = (x, y) => x === 25 && y === 15 ? node : ancestor;
  assert.equal(f.inspect().candidates[0].unobscured, false); assert.equal(f.inspect().candidates[0].geometry.hitTests.length, 5);
});
test('M5.7F structural modal/chrome diagnostics retain no overlay text or arbitrary identifiers', () => {
  const modal = domFixture([{ overlay: overlayFixture(true) }]).inspect().candidates[0]; assert.equal(modal.obstruction, 'OBSCURED_BY_MODAL_OR_PANEL'); assert.equal(modal.geometry.hitTests[0].panelCategory, 'GENERIC_DIALOG'); assert.doesNotMatch(JSON.stringify(modal), /SECRET_CANARY/);
  const chrome = domFixture([{ overlay: overlayFixture(false, true) }]).inspect().candidates[0]; assert.equal(chrome.obstruction, 'OBSCURED_BY_PAGE_CHROME'); assert.equal(chrome.geometry.hitTests[0].fixedOrSticky, true); assert.equal(chrome.geometry.hitTests[0].zIndexCategory, 'POSITIVE');
});
test('M5.7F a hidden dialog explains presence without proving a visible blocker', () => {
  const f = domFixture(); const hidden = overlayFixture(true); hidden.style.display = 'none'; const query = f.context.document.querySelectorAll;
  f.context.document.querySelectorAll = selector => selector.startsWith('[role="dialog"]') ? [hidden] : query(selector);
  const d = f.inspect(); assert.equal(d.panelDetectedInDom, true); assert.equal(d.modalOrPanelPresent, false); assert.equal(d.activeBlockingPanelPresent, false); assert.equal(d.visiblePanelCount, 0); assert.equal(d.selected.unobscured, true);
});
function viewportHarness(patch = { y: 900 }, afterScroll = () => { }) {
  const f = domFixture([patch]); let scrolls = 0; let reads = 0;
  f.nodes[0].scrollIntoView = opts => { assert.deepEqual(opts, { block: 'center', inline: 'nearest', behavior: 'instant' }); scrolls++; patch.y = 200; patch.x = 0; afterScroll(f); };
  const handle = { evaluate: async (fn, args) => { if (fn === scrollPinnedControl) return scrollPinnedControl(f.nodes[0]); reads++; return f.inspect(f.nodes[0], args?.finalClickQualification === true); } };
  const page = { locator: selector => { assert.equal(selector, '#add-to-cart-button'); return { nth: index => { assert.equal(index, 0); return { elementHandle: async () => handle }; } }; }, evaluate: async () => f.inspect() };
  return { f, page, handle, scrolls: () => scrolls, reads: () => reads, clock: { wait: async ms => assert.equal(ms, 100) } };
}
test('M5.7F pinned offscreen control becomes eligible only after scroll and stable revalidation', async () => {
  const h = viewportHarness(); const record = {}; const handle = await prepareViewportControl(h.page, { asin, action: 'ADD_TO_CART' }, h.clock, h.f.inspect(), record);
  assert.equal(handle, h.handle); assert.equal(h.scrolls(), 1); assert.ok(h.reads() >= 3); assert.equal(record.status, 'QUALIFIED_AFTER_VIEWPORT_NORMALIZATION'); assert.equal(record.before.candidates[0].obstruction, 'OUTSIDE_VIEWPORT'); assert.equal(record.after.selected.unobscured, true); assert.equal(record.layoutSamples.length, 2);
});
test('M5.7F harmless chrome can resolve by scrolling alone', async () => {
  const patch = { overlay: overlayFixture(false, true) }; const h = viewportHarness(patch, () => { patch.overlay = false; }); const record = {};
  await prepareViewportControl(h.page, { asin, action: 'ADD_TO_CART' }, h.clock, h.f.inspect(), record); assert.equal(h.scrolls(), 1); assert.equal(record.after.selected.unobscured, true);
});
for (const change of ['asin', 'quantity', 'method', 'action', 'name', 'disabled']) test(`M5.7F ${change} binding change after scroll prevents clicking`, async () => {
  const h = viewportHarness({ y: 900 }, f => { const node = f.nodes[0]; if (change === 'asin') node.form.querySelectorAll()[0].value = 'B0H78BB9TY'; if (change === 'quantity') node.form.querySelectorAll()[1].value = '2'; if (change === 'method') node.form.method = 'get'; if (change === 'action') node.form.action = 'https://www.amazon.com.mx/checkout'; if (change === 'name') node.name = 'other'; if (change === 'disabled') node.disabled = true; });
  await assert.rejects(prepareViewportControl(h.page, { asin, action: 'ADD_TO_CART' }, h.clock, h.f.inspect(), {}), /CLICK_TARGET_BINDING_CHANGED/); assert.equal(h.scrolls(), 1);
});
test('M5.7F real modal blocker stops without dismissal, scroll or alternate control', async () => {
  const h = viewportHarness({ overlay: overlayFixture(true) }); const record = {};
  await assert.rejects(prepareViewportControl(h.page, { asin, action: 'ADD_TO_CART' }, h.clock, h.f.inspect(), record), /BLOCKED_BY_MODAL/); assert.equal(h.scrolls(), 0); assert.equal(record.rescanCount, 0);
});
test('M5.7F one detached rescan may replace matching semantics but never loops', async () => {
  for (const failReplacement of [false, true]) {
    const initial = domFixture([{ y: 900 }]); const replacement = domFixture(); let pins = 0; let scans = 0;
    const page = { locator: () => ({ nth: () => ({ elementHandle: async () => { pins++; return { evaluate: async () => failReplacement || pins === 1 ? { pinnedConnected: false } : replacement.inspect(replacement.nodes[0]) }; } }) }), evaluate: async () => { scans++; return replacement.inspect(); } };
    const record = {}; const work = prepareViewportControl(page, { asin, action: 'ADD_TO_CART' }, { wait: async () => { } }, initial.inspect(), record);
    if (failReplacement) await assert.rejects(work, /CLICK_TARGET_DETACHED/); else await work;
    assert.equal(pins, 2); assert.equal(scans, 1); assert.equal(record.rescanCount, 1);
  }
});
test('M5.7F unstable layout stops after bounded samples', async () => {
  const patch = { y: 200 }; const h = viewportHarness(patch); h.handle.evaluate = async () => { patch.x = (patch.x ?? 0) + 2; return h.f.inspect(h.f.nodes[0]); };
  const record = {}; await assert.rejects(prepareViewportControl(h.page, { asin, action: 'ADD_TO_CART' }, h.clock, h.f.inspect(), record), /CONTROL_LAYOUT_NOT_STABLE/); assert.equal(record.layoutSamples.length, 4);
});
test('M5.7F viewport code only scrolls; no forced/synthetic clicks or obstruction bypass', () => {
  const source = readFileSync('scripts/amazon-cart-viewport.mjs', 'utf8'); assert.doesNotMatch(source, /force\s*:\s*true|\.click\s*\(|dispatchEvent|\.submit\s*\(|\.remove\s*\(|\.style\s*[.=]|setAttribute|\bfetch\s*\(|\.request\./);
  assert.match(source, /scrollIntoView\(\{ block: 'center', inline: 'nearest', behavior: 'instant' \}\)/);
});

test('M5.7G semantic preselection is independent of final viewport selection', async () => {
  const h = viewportHarness(); const initial = h.f.inspect(null, false); const record = {};
  assert.equal(initial.preselectedPrimaryIndex, 0); assert.equal(initial.preselectionReason, 'UNIQUE_PRODUCT_BOUND_VIEWPORT_CANDIDATE');
  assert.equal(initial.preselected.qualificationStage, 'VIEWPORT_NORMALIZATION_CANDIDATE'); assert.equal(initial.preselected.semanticQualified, true);
  assert.equal(initial.selected, null); assert.deepEqual(initial.preselected.rejectionReasons, ['OUTSIDE_VIEWPORT']);
  const evaluate = h.handle.evaluate;
  h.handle.evaluate = async (fn, args) => {
    if (fn === scrollPinnedControl) { assert.equal(record.selected, null); assert.equal(record.selectedPrimaryIndex, null); }
    const snapshot = await evaluate(fn, args);
    if (fn === inspectCartControls && !args?.finalClickQualification) assert.equal(snapshot.selected, null);
    if (args?.finalClickQualification) { assert.equal(h.scrolls(), 1); assert.ok(record.layoutSamples.length >= 2); }
    return snapshot;
  };
  await prepareViewportControl(h.page, { asin, action: 'ADD_TO_CART' }, h.clock, initial, record);
  assert.equal(record.selected.qualificationStage, 'CLICK_QUALIFIED'); assert.equal(record.qualificationStage, 'CLICK_QUALIFIED');
  assert.equal(record.scrollCount, 1); assert.ok(record.before); assert.ok(record.after);
});

test('M5.7G clipped control preselects and an in-view control still awaits final qualification', () => {
  for (const patch of [{ x: -10 }, {}]) { const d = domFixture([patch]).inspect(null, false); assert.equal(d.preselectedPrimaryIndex, 0); assert.equal(d.selected, null); }
});

for (const [change, reason] of [['asin', 'FORM_ASIN'], ['quantity', 'FORM_QUANTITY'], ['method', 'FORM_METHOD'], ['action', 'FORM_PATH_UNQUALIFIED'], ['name', 'CONTROL_SEMANTICS'], ['hidden', 'HIDDEN'], ['disabled', 'DISABLED'], ['empty', 'EMPTY_GEOMETRY']]) test(`M5.7G ${change} semantic failure stops before pin/scroll and is explicit`, async () => {
  const f = domFixture([{ y: 900 }]); const node = f.nodes[0];
  if (change === 'asin') node.form.querySelectorAll()[0].value = 'B0H78BB9TY';
  if (change === 'quantity') node.form.querySelectorAll()[1].value = '2';
  if (change === 'method') node.form.method = 'get';
  if (change === 'action') node.form.action = 'https://www.amazon.com.mx/checkout';
  if (change === 'name') node.name = 'other';
  if (change === 'hidden') node.style.display = 'none';
  if (change === 'disabled') node.disabled = true;
  if (change === 'empty') node.getBoundingClientRect = () => ({ x: 0, y: 900, width: 0, height: 0 });
  const d = f.inspect(null, false); assert.equal(d.preselected, null); assert.ok(d.candidates[0].semanticRejectionReasons.includes(reason)); assert.ok(d.candidates[0].rejectionReasons.includes(reason));
  const record = {}; await assert.rejects(prepareViewportControl({ locator: () => assert.fail('No pin permitted') }, { asin, action: 'ADD_TO_CART' }, {}, d, record), /CLICK_TARGET_NOT_QUALIFIED/);
  assert.equal(record.scrollCount, 0); assert.equal(record.selected, null); assert.ok(record.semanticRejections[0].reasons.includes(reason));
});

test('M5.7G saved Run 7 was pre-pinnable but failed its separately hidden form predicate', async () => {
  const run = JSON.parse(readFileSync('outputs/M5_7_CART_m5-7-b0gyvhlp4l-seventh.json', 'utf8'));
  const before = run.viewportQualification.before;
  assert.equal(before.pinnablePrimaryIndex, 0); assert.equal(before.pinnableCandidate.formActionQualified, false);
  assert.deepEqual(before.pinnableCandidate.rejectionReasons, ['OUTSIDE_VIEWPORT']); assert.equal(run.viewportQualification.after, null); assert.equal(run.viewportQualification.scrollCount, 0);
  // The redacted path is not sufficient to waive a failed raw form-action check.
  const f = domFixture([{ y: 749 }]); f.nodes[0].form.action = 'https://www.amazon.com.mx/cart/add-to-cart/' + 'x'.repeat(201);
  const d = f.inspect(null, false); assert.equal(d.preselected, null); assert.equal(d.candidates[0].formActionQualificationReason, 'FORM_PATH_UNQUALIFIED');
});

test('M5.7G form path uses existing bounded decoding and never qualifies invalid authority/path', () => {
  const f = domFixture([{ y: 900 }]); const node = f.nodes[0];
  node.form.action = 'https://www.amazon.com.mx/cart/add-to-cart/%2541';
  assert.equal(f.inspect(null, false).preselected.formActionQualified, true);
  for (const action of ['https://unagi.amazon.com.mx/cart/add-to-cart/A', 'https://www.amazon.com.mx/cart/add-to-cart/A%2FB', 'https://www.amazon.com.mx/cart/add-to-cart/%ZZ', 'https://www.amazon.com.mx/checkout/A']) {
    node.form.action = action; const d = f.inspect(null, false); assert.equal(d.preselected, null); assert.equal(d.candidates[0].formActionQualified, false);
  }
  node.form.action = { toString: () => 'SHADOWED_FORM_PROPERTY' }; node.form.getAttribute = key => key === 'action' ? '/cart/add-to-cart/A' : null;
  assert.equal(f.inspect(null, false).preselected.formActionQualified, true);
});

test('M5.7G same-target structural panel is never a blocking overlay', () => {
  const f = domFixture(); const node = f.nodes[0]; const query = f.context.document.querySelectorAll;
  f.context.document.querySelectorAll = s => s.startsWith('[role="dialog"]') ? [node] : query(s);
  const d = f.inspect(null, false); assert.equal(d.panelDetectedInDom, true); assert.equal(d.panels[0].sameAsTarget, true); assert.equal(d.modalOrPanelPresent, false); assert.equal(d.activeBlockingPanelPresent, false);
});

test('M5.7G visible hit-tested modal is active and stops with no selected click target', async () => {
  const overlay = overlayFixture(true); const h = viewportHarness({ overlay }); const query = h.f.context.document.querySelectorAll;
  h.f.context.document.querySelectorAll = s => s.startsWith('[role="dialog"]') ? [overlay] : query(s);
  const d = h.f.inspect(null, false); assert.equal(d.modalOrPanelPresent, true); assert.equal(d.activeBlockingPanelPresent, true); assert.equal(d.panels[0].sameAsTarget, false); assert.equal(d.panels[0].coversTarget, true);
  const record = {}; await assert.rejects(prepareViewportControl(h.page, { asin, action: 'ADD_TO_CART' }, h.clock, d, record), /BLOCKED_BY_MODAL/);
  assert.equal(record.selected, null); assert.equal(h.scrolls(), 0); assert.equal(record.rescanCount, 0);
});

test('M5.7G offscreen, zero-area and unrelated non-overlay panels are not active', () => {
  for (const patch of ['offscreen', 'zero', 'nonoverlay']) {
    const f = domFixture(); const panel = overlayFixture(true); const query = f.context.document.querySelectorAll;
    if (patch === 'offscreen') panel.getBoundingClientRect = () => ({ x: 0, y: 1000, width: 100, height: 100 });
    if (patch === 'zero') panel.getBoundingClientRect = () => ({ x: 0, y: 0, width: 0, height: 0 });
    f.context.document.querySelectorAll = s => s.startsWith('[role="dialog"]') ? [panel] : query(s);
    const d = f.inspect(null, false); assert.equal(d.panelDetectedInDom, true); assert.equal(d.activeBlockingPanelPresent, false); assert.equal(d.modalOrPanelPresent, false);
  }
});

test('M5.7G final revalidation detects changes after layout stabilized', async () => {
  const h = viewportHarness(); const evaluate = h.handle.evaluate;
  h.handle.evaluate = (fn, args) => { if (args?.finalClickQualification) h.f.nodes[0].form.querySelectorAll()[1].value = '2'; return evaluate(fn, args); };
  const record = {}; await assert.rejects(prepareViewportControl(h.page, { asin, action: 'ADD_TO_CART' }, h.clock, h.f.inspect(null, false), record), /CLICK_TARGET_FINAL_REVALIDATION_FAILED/);
  assert.equal(record.selected, null); assert.equal(record.scrollCount, 1);
});

test('M5.7G confirmation and production BrowserProvider hashes remain unchanged after authorized M5.7I router correction', () => {
  const expected = {
    'scripts/amazon-cart-research-evidence.mjs': 'c25168c2b38e9779baaa989cdaf4298e41d492610829023399af97ba455b90dc',
    'packages/adapters/src/amazon/providers/browser.ts': 'ed228a024ba4efd810cfbbf31ac42958453b39733c2da8920d0de086546d918f'
  };
  for (const [path, hash] of Object.entries(expected)) assert.equal(createHash('sha256').update(readFileSync(path)).digest('hex'), hash);
});

function pathRouting(actionUrl) {
  const config = cartResearchConfig({ AMAZON_CART_RESEARCH_ENABLED: '1' }, ['--asin', asin, '--action', 'ADD_TO_CART', '--operation-id', 'authored-path-consistency', '--max-price-mxn', '2000.00', '--expected-seller', 'amazon-retail-mx', '--ack-unknown-evidence', 'YES_RESEARCH_ONLY']);
  const router = createCartRouting(config);
  router.arm({ marketplace: 'MX', asin, identityMatched: true, availability: 'AVAILABLE', purchaseMode: 'IMMEDIATE', actionVisible: true, actionType: 'ADD_TO_CART', quantity: 1, cartCount: 0, itemPresent: false }, config.operationId);
  router.beginBrowserClick();
  return router.decide({ url: actionUrl, method: 'POST', type: 'xhr', main: true, body: `ASIN=${asin}&quantity=1` });
}

for (const [path, accepted] of [
  ['/cart/add-to-cart/A', true], ['/cart/add-to-cart/A/', true], ['/cart/add-to-cart/A?token=SECRET_CANARY', true],
  ['/cart/add-to-cart/%2541', true], ['/cart/add-to-cart/ref=dp_start', true], ['/cart/add-to-cart/ref=dp_start/', true], ['/cart/add-to-cart/ref%3Ddp_start', true],
  ['/cart/add-to-cart/a/b', false], ['/cart/other/a', false], ['/checkout/a', false], ['/orders/a', false], ['/payment/a', false],
  ['/cart/add-to-cart/A%2FB', false], ['/cart/add-to-cart/%ZZ', false], ['/cart/add-to-cart/ref=', false], ['/cart/add-to-cart/ref=x/y', false], ['/cart/add-to-cart/checkout', false], ['/cart/add-to-cart/ref=payment', false]
]) test(`M5.7H form/network parity for ${path}`, () => {
  const f = domFixture([{ y: 900 }]); const actionUrl = `https://www.amazon.com.mx${path}`; f.nodes[0].form.action = actionUrl;
  const d = f.inspect(null, false); const candidate = d.candidates[0];
  assert.equal(candidate.formActionQualified, accepted); assert.equal(pathRouting(actionUrl).allowed, accepted);
  assert.equal(candidate.formActionAuthorityQualified, true); assert.equal(candidate.formActionRegistrableDomain, 'amazon.com.mx');
  assert.equal(d.selected, null); assert.equal(d.preselectedPrimaryIndex, accepted ? 0 : null);
  assert.doesNotMatch(JSON.stringify(d), /SECRET_CANARY|token=/);
});

test('M5.7H empty and neighboring legacy families never qualify as a single-segment form', () => {
  for (const path of ['/cart/add-to-cart', '/cart/add-to-cart/', '/gp/cart/view.html', '/gp/add-to-cart/html', '/cart/add-to-cart//']) {
    const f = domFixture(); f.nodes[0].form.action = `https://www.amazon.com.mx${path}`;
    const d = f.inspect(null, false); assert.equal(d.preselected, null); assert.equal(d.candidates[0].formActionPathQualified, false);
  }
});

test('M5.7H strict form authority is independent of the path and marketplace suffix', () => {
  for (const authority of ['https://unagi.amazon.com.mx', 'https://fls-na.amazon.com.mx', 'https://amazon.com.mx', 'https://www.amazon.com.mx.evil.test', 'http://www.amazon.com.mx', 'https://user:SECRET_CANARY@www.amazon.com.mx', 'https://www.amazon.com.mx:444']) {
    const f = domFixture(); f.nodes[0].form.action = `${authority}/cart/add-to-cart/A`;
    const d = f.inspect(null, false); assert.equal(d.candidates[0].formActionPathQualified, true); assert.equal(d.candidates[0].formActionAuthorityQualified, false); assert.equal(d.preselected, null); assert.doesNotMatch(JSON.stringify(d), /SECRET_CANARY/);
  }
});

test('M5.7H ref suffix discrepancy is reproducible without claiming Run 8 exposed its raw suffix', async () => {
  const run = JSON.parse(readFileSync('outputs/M5_7_CART_m5-7-b0gyvhlp4l-eighth.json', 'utf8'));
  const saved = run.clickTargetDiagnostics.candidates[0]; assert.equal(saved.formActionQualificationReason, 'FORM_PATH_UNQUALIFIED'); assert.equal(saved.form.action.pathPattern, '/cart/add-to-cart/:redacted');
  assert.equal(Object.hasOwn(saved, 'formActionCanonicalPathPattern'), false);
  const h = viewportHarness(); h.f.nodes[0].form.action = '/cart/add-to-cart/ref=AUTHORED';
  const initial = h.f.inspect(null, false); const candidate = initial.preselected;
  assert.equal(candidate.formActionMatcher, 'cartAction_REF_SINGLE_SEGMENT_SUBSET'); assert.equal(candidate.formActionOpaquePathMatch, false); assert.equal(candidate.formActionLegacyRefPathMatch, true);
  assert.equal(candidate.formActionPathPattern, '/cart/add-to-cart/ref=:redacted'); assert.equal(candidate.formActionMatcherVersion, 'MX_CART_PATH_V1');
  const record = {}; await prepareViewportControl(h.page, { asin, action: 'ADD_TO_CART' }, h.clock, initial, record);
  assert.equal(record.scrollCount, 1); assert.ok(record.after); assert.ok(record.layoutSamples.length >= 2); assert.equal(record.qualificationStage, 'CLICK_QUALIFIED');
});

test('M5.7H canonical predicate matches the immutable network regexes over suffix/case/encoding boundaries', () => {
  const source = readFileSync('scripts/amazon-cart-research-policy.mjs', 'utf8');
  const legacyText = /const cartAction = (\/.*\/i);/.exec(source)[1];
  const opaqueText = /const qualifiedCartAction = (\/.*\/);/.exec(source)[1];
  const legacy = runInNewContext(legacyText); const opaque = runInNewContext(opaqueText);
  for (const suffix of ['A', 'a._~-', 'A'.repeat(200), 'A'.repeat(201), 'a;b', 'ref=x', 'REF=x', 'ref=', 'ref=x;y', 'ref=x=y', 'ref=x/y', '%41', '%2541', '%252541', '%25252541']) {
    for (const prefix of ['/cart/add-to-cart/', '/Cart/Add-To-Cart/']) {
      const raw = prefix + suffix; let canonical = raw;
      for (let i = 0; i < 3; i++) { const next = decodeURIComponent(canonical); if (next === canonical) break; canonical = next; }
      const singleSegment = /^\/cart\/add-to-cart\/[^/]+\/?$/i.test(canonical);
      const expected = singleSegment && (opaque.test(canonical) || legacy.test(canonical));
      const f = domFixture(); f.nodes[0].form.action = `https://www.amazon.com.mx${raw}`;
      assert.equal(f.inspect(null, false).candidates[0].formActionPathQualified, expected, raw);
    }
  }
});

test('M5.7H query stripping only qualifies path; forbidden query still denied by unchanged router', () => {
  const f = domFixture(); const actionUrl = 'https://www.amazon.com.mx/cart/add-to-cart/A?next=checkout'; f.nodes[0].form.action = actionUrl;
  assert.equal(f.inspect(null, false).candidates[0].formActionPathQualified, true);
  assert.equal(pathRouting(actionUrl).allowed, false); assert.equal(pathRouting(actionUrl).reason, 'FORBIDDEN_PATH');
});

function pinnedEventFixture() {
  const form = { method: 'post', querySelectorAll: () => [{}], querySelector: selector => ({ value: selector.includes('ASIN') ? asin : '1' }) };
  const control = { form, isConnected: true, id: 'add-to-cart-button', name: 'submit.add-to-cart', contains: () => false };
  class BrowserEventFixture { } const listeners = {}; const seen = [];
  const context = { node: control, asin, report: async value => seen.push(immutableNativeEvent(JSON.parse(JSON.stringify(value)))), Event: BrowserEventFixture, performance: { timeOrigin: 1000 }, queueMicrotask, document: { addEventListener: (name, callback, options) => { assert.equal(options.passive, true); assert.equal(options.capture, true); listeners[name] = callback; } } };
  assert.equal(runInNewContext(`(${installPinnedCartObservers.toString()})(node, {asin, report})`, context), true);
  return { form, control, listeners, seen, BrowserEventFixture, emit: async event => { listeners[event.type](event); await new Promise(resolve => queueMicrotask(resolve)); return seen.at(-1); } };
}

test('M5.7I trust/form checks survive M5.7J event-time snapshot correction', async () => {
  const f = pinnedEventFixture(); const { form, control, BrowserEventFixture } = f; const project = f.emit;
  const fields = { type: 'submit', isTrusted: true, defaultPrevented: false, timeStamp: 100, target: form, submitter: control };
  assert.equal((await project(fields)).trusted, false);
  const genuineFixture = Object.assign(new BrowserEventFixture(), fields); const valid = await project(genuineFixture); assert.equal(valid.trusted, true); assert.equal(valid.productBound, true); assert.equal(valid.browserAt, 1100);
  assert.equal((await project(Object.assign(new BrowserEventFixture(), fields, { submitter: {} }))).productBound, false);
  assert.equal((await project(Object.assign(new BrowserEventFixture(), fields, { target: {} }))).productBound, false);
  assert.equal((await project(Object.assign(new BrowserEventFixture(), fields, { isTrusted: false }))).trusted, false);
  assert.equal((await project(Object.assign(new BrowserEventFixture(), fields, { defaultPrevented: true }))).defaultPrevented, true);
  control.form = { ...form }; assert.equal((await project(genuineFixture)).productBound, false);
});

test('M5.7I pinned observers forward actual events passively without synthetic interaction', async () => {
  const f = pinnedEventFixture(); const event = { type: 'submit', marker: secret };
  const value = await f.emit(event); assert.notEqual(value, event); assert.doesNotMatch(JSON.stringify(value), /SECRET_CANARY/);
  assert.deepEqual(Object.keys(f.listeners), ['click', 'submit', 'keydown']);
});

test('M5.7I native transport has no HTTP, copied request overrides, manual submit or forced event', () => {
  const source = readFileSync('scripts/amazon-cart-native-form.mjs', 'utf8') + readFileSync('scripts/amazon-cart-research-runtime.mjs', 'utf8');
  assert.doesNotMatch(source, /\bfetch\s*\(|axios|undici|request\.newContext|\.requestSubmit\s*\(|\.submit\s*\(|dispatchEvent|force\s*:\s*true|setExtraHTTPHeaders|setCookie|route\.continue\(\s*\{/);
  assert.equal([...source.matchAll(/selectedControl\.click\(/g)].length, 1);
  assert.doesNotMatch(source, /handle: true|eventHandle\.evaluate|eventHandle\.dispose/); assert.match(source, /exposeFunctions: true/); assert.match(source, /event instanceof Event/);
});

test('M5.7J frozen legacy callback reproduces exact dispose TypeError and rejected queue', async () => {
  // M5.7I callback shape, preserved only as a regression; not used by the harness.
  const eventHandle = {}; let invalidated = false;
  const legacyQueue = Promise.resolve().then(async () => {
    try { await eventHandle.evaluate(() => ({})); } catch { invalidated = true; }
    finally { await eventHandle.dispose().catch(() => { }); }
  });
  await assert.rejects(legacyQueue, error => error instanceof TypeError && /eventHandle.dispose is not a function/.test(error.message)); assert.equal(invalidated, true);
  const source = readFileSync('node_modules/playwright-core/lib/coreBundle.js', 'utf8');
  assert.match(source, /async exposeBinding\(name, callback\)/); assert.match(source, /this\._initializer\.args\.map\(parseResult\)/);
  assert.match(source, /_exposeCallbackBinding[\s\S]{0,300}noGlobal: true/);
});

test('M5.7J event-time evidence survives destroyed DOM and contains no Event/handle references', async () => {
  const f = pinnedEventFixture(); const event = Object.assign(new f.BrowserEventFixture(), { type: 'submit', isTrusted: true, defaultPrevented: false, timeStamp: 120, target: f.form, submitter: f.control, secret });
  f.listeners.submit(event);
  Object.defineProperty(f.control, 'form', { get: () => { throw new Error('Execution context was destroyed SECRET_CANARY'); } });
  await new Promise(resolve => queueMicrotask(resolve)); const value = f.seen[0];
  assert.equal(value.trusted, true); assert.equal(value.productBound, true); assert.equal(Object.isFrozen(value), true); assert.doesNotMatch(JSON.stringify(value), /SECRET_CANARY|target|submitter/);
  const gate = nativeCartCausality(); gate.arm(1000); gate.observe({ ...value, kind: 'CLICK', browserAt: 1100 }); gate.observe(value);
  assert.equal(gate.evidence(1150, 1200).qualified, true);
});

for (const [stage, error, expected] of [
  ['CONTINUE', new Error('Route already handled SECRET_CANARY'), 'ROUTE_LIFECYCLE_ERROR'],
  ['BODY_READ', new Error('SECRET_CANARY raw body'), 'BODY_PARSE_FAILURE'],
  ['ELIGIBILITY', new TypeError('SECRET_CANARY'), 'ELIGIBILITY_STATE_ERROR'],
  ['HEADERS', new Error('Execution context was destroyed https://secret.test/?token=SECRET_CANARY'), 'STALE_BROWSER_HANDLE'],
  ['RECORD', new Error('SECRET_CANARY'), 'UNKNOWN_INTERNAL']
]) test(`M5.7J ${stage} failure diagnostics redact error/stack/extra fields`, () => {
  const failure = sanitizedRouteFailure(error, { stage, requestSequence: 289, actionState: 'POST_ACTION_CONFIRMATION', hostClass: 'APPROVED_AMAZON_MX', method: 'POST', resourceType: 'document', pathClass: 'STRICT_CART_ADD', nativeCartEligibilityStage: 'QUALIFIED', raw: secret });
  assert.equal(failure.errorCategory, expected); assert.equal(failure.requestSequence, 289); assert.doesNotMatch(JSON.stringify(failure), /SECRET_CANARY|https:|stack|raw/);
});
