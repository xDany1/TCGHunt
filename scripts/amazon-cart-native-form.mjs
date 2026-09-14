/** Pure bounded body policy. Values never leave this function; the browser owns transport. */
export function nativeFormBodyPolicy(body, contentType, asin) {
  const result = { valid: false, forbiddenOperation: false, forbiddenOperationSources: [], sensitiveMaterialPresent: false, reason: 'UNINSPECTABLE_NATIVE_FORM' };
  if (typeof body !== 'string' || Buffer.byteLength(body) > 65536 || contentType.split(';')[0].trim().toLowerCase() !== 'application/x-www-form-urlencoded') return result;
  const decode = value => { for (let i = 0; i < 3; i++) value = value.replace(/(?:%[a-f0-9]{2})+/gi, part => { try { return decodeURIComponent(part); } catch { return part; } }); return value; };
  const forbidden = /checkout|\/buy(?:\/|$)|buy[\W_]*now|one[\W_]*click|place[\W_]*order|submit[\W_]*order|payment|purchase|gift[\W_]*card|\/orders?(?:\/|$)|signin|signout|login|logout|account|address|captcha|\/ap\//i;
  const opaqueKeys = new Set(['session-id', 'sessionid', 'session_id', 'token', 'csrftoken', 'csrf-token', 'csrf_token', 'anti-csrftoken-a2z', 'signature', 'authenticitytoken', 'authorization', 'offerlistingid', 'offeringid.1']);
  const fields = [...new URLSearchParams(body)]; if (fields.length > 200) return result;
  for (const [key, value] of fields) {
    const name = decode(key); const opaque = opaqueKeys.has(name.toLowerCase());
    result.sensitiveMaterialPresent ||= opaque;
    // Operation-bearing names always win, including e.g. checkoutToken. Only exact
    // recognized opaque fields may contain arbitrary secret bytes without scanning them.
    const operation = value => forbidden.test(value) || /^(?:order|orders|buy|placeorder|submitorder)$/i.test(value.trim());
    if (operation(name) && !result.forbiddenOperationSources.includes('FIELD_NAME')) result.forbiddenOperationSources.push('FIELD_NAME');
    if (!opaque && operation(decode(value)) && !result.forbiddenOperationSources.includes('NON_OPAQUE_VALUE')) result.forbiddenOperationSources.push('NON_OPAQUE_VALUE');
    result.forbiddenOperation = result.forbiddenOperationSources.length > 0;
  }
  if (result.forbiddenOperation) return { ...result, reason: 'FORBIDDEN_NATIVE_FORM_OPERATION' };
  const values = name => fields.filter(([key]) => key.toLowerCase() === name).map(([, value]) => value);
  const asins = values('asin'); const quantities = values('quantity'); const offers = values('offerlistingid'); const merchants = values('merchantid');
  const ambiguous = fields.some(([key]) => /^(?:asin|quantity|offerlistingid|merchantid)/i.test(key) && !/^(?:asin|quantity|offerlistingid|merchantid)$/i.test(key));
  if (ambiguous || asins.length !== 1 || asins[0] !== asin || quantities.length !== 1 || quantities[0] !== '1' || offers.length !== 1 || !offers[0].trim() || merchants.length !== 1 || !merchants[0].trim()) return { ...result, reason: 'NATIVE_FORM_CONTEXT_MISMATCH' };
  return { ...result, valid: true, reason: 'QUALIFIED_NATIVE_FORM' };
}

/** Passive listeners bound to the retained control and its original form. */
export function installPinnedCartObservers(node, { asin, report }) {
  const form = node.form; if (!form || !node.isConnected) return false;
  if (typeof report !== 'function') return false;
  const emit = event => {
    // All DOM/Event access stays in this browser listener, before navigation can
    // destroy the context. Only this closure receives the non-global callback.
    let snapshot;
    try {
      const genuine = event instanceof Event;
      const kind = event.type === 'click' ? 'CLICK' : event.type === 'submit' ? 'SUBMIT' : 'OTHER_INTERACTION';
      const exact = kind === 'CLICK' ? event.target === node || node.contains(event.target) : kind === 'SUBMIT' && event.target === form && event.submitter === node;
      const bound = node.form === form && node.isConnected && node.id === 'add-to-cart-button' && node.name === 'submit.add-to-cart' && form.method.toLowerCase() === 'post' && form.querySelectorAll('[name="ASIN"]').length === 1 && form.querySelector('[name="ASIN"]')?.value === asin && form.querySelectorAll('[name="quantity"]').length === 1 && form.querySelector('[name="quantity"]')?.value === '1';
      snapshot = { kind, browserAt: performance.timeOrigin + event.timeStamp, trusted: genuine && event.isTrusted === true, productBound: exact && bound };
      queueMicrotask(() => {
        const evidence = Object.freeze({ ...snapshot, defaultPrevented: !genuine || event.defaultPrevented !== false });
        void report(evidence).catch(() => { });
      });
    } catch { void report(Object.freeze({ kind: 'INVALID_EVENT', browserAt: 0, trusted: false, productBound: false, defaultPrevented: true })).catch(() => { }); }
  };
  for (const name of ['click', 'submit', 'keydown']) document.addEventListener(name, emit, { capture: true, passive: true });
  return form.querySelector('[name="ASIN"]')?.value === asin;
}

/** Re-project even value-serialized callbacks; never retain extra browser fields. */
export function immutableNativeEvent(value) {
  return Object.freeze({ kind: ['CLICK', 'SUBMIT', 'OTHER_INTERACTION'].includes(value?.kind) ? value.kind : 'INVALID_EVENT', browserAt: Number.isFinite(value?.browserAt) ? value.browserAt : 0, trusted: value?.trusted === true, defaultPrevented: value?.defaultPrevented !== false, productBound: value?.productBound === true });
}

/** Fixed projection only; no field values or arbitrary browser messages enter routing. */
export function nativeCartCausality() {
  let armedAt = null; const events = []; let invalid = false;
  return {
    arm(at) { if (armedAt !== null) throw new Error('NATIVE_ENVELOPE_ALREADY_ARMED'); armedAt = at; },
    observe(value) {
      if (armedAt === null || events.length >= 3) { invalid = true; return; }
      if (!['CLICK', 'SUBMIT'].includes(value?.kind) || value.trusted !== true || value.defaultPrevented !== false || value.productBound !== true || !Number.isFinite(value.browserAt) || value.browserAt < armedAt || value.kind !== (events.length ? 'SUBMIT' : 'CLICK')) { invalid = true; return; }
      events.push({ kind: value.kind, browserAt: value.browserAt });
    },
    evidence(requestAt, now) {
      const ordered = events.length === 2 && events[0].browserAt <= events[1].browserAt && events[1].browserAt <= requestAt;
      return { qualified: !invalid && armedAt !== null && ordered && requestAt - events[1].browserAt <= 2000 && now >= requestAt && now - requestAt <= 2000, trustedClick: events.length >= 1, trustedSubmit: events.length === 2, productBound: !invalid && events.length === 2, requestAt, submitAt: events[1]?.browserAt ?? null, invalidated: invalid };
    }
  };
}
