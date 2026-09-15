/** Field names classify semantics, never grant authority or exempt value inspection. */
export function classifyFieldName(name) {
  const words = name.replace(/([a-z0-9])([A-Z])/g, '$1 $2').toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
  const lower = name.toLowerCase();
  if (['asin', 'quantity', 'merchantid', 'offerlistingid', 'submit.add-to-cart'].includes(lower)) return { classification: 'PUBLIC_CART_FIELD', semanticCategory: null };
  // Explicit action words, their compound spellings and conventional field affixes.
  // No arbitrary substring test: e.g. repurchaseToken is not a purchase action.
  const rules = [
    ['CHECKOUT', ['checkout']], ['ORDER', ['order', 'orders', 'placeorder', 'submitorder']],
    ['PAYMENT', ['payment', 'purchase']], ['ADDRESS', ['address']], ['GIFT_CARD', ['giftcard']],
    ['BUY_NOW', ['buy', 'buynow', 'oneclick']], ['ACCOUNT_SECURITY', ['account', 'security', 'signin', 'signout', 'login', 'logout', 'captcha', 'ap']]
  ];
  const compact = words.join('');
  for (const [category, actions] of rules) {
    for (const action of actions) {
      const field = new RegExp(`^(?:is|has|enable|enabled|disable|disabled|submit|place|set|update|add|delete|remove|select|save|complete|confirm)?${action}(?:id|token|csrf|signature|auth|enabled|disabled|required|flag|action|button|submit|completion|mutation|details|method|instrument)?$`);
      if (words.includes(action) || field.test(compact)) return { classification: 'FORBIDDEN_OPERATION_FIELD', semanticCategory: category };
    }
  }
  if (/session|cookie|authorization|authentication|authenticity|(?:^|[._-])auth(?:$|[._-])/i.test(name)) return { classification: 'SENSITIVE_SESSION_FIELD', semanticCategory: null };
  if (/token|csrf|signature/i.test(name)) return { classification: 'SENSITIVE_TOKEN_FIELD', semanticCategory: null };
  if (/private|secret|credential|password|customer|email|offeringid/i.test(name)) return { classification: 'SENSITIVE_PRIVATE_FIELD', semanticCategory: null };
  return { classification: 'UNKNOWN_FIELD', semanticCategory: null };
}

/** Public activation semantics only; arbitrary or secret-bearing fields stay opaque. */
export function forbiddenValueSemantic(value, publicActivationField = false) {
  if (!publicActivationField) return 'OPAQUE_REDACTED';
  if (value === undefined) return 'ABSENT';
  if (typeof value !== 'string') return 'UNKNOWN';
  const v = value.trim().toLowerCase();
  if (v === '') return 'EMPTY';
  if (v === 'false') return 'FALSEY_BOOLEAN';
  if (v === 'true') return 'TRUTHY_BOOLEAN';
  if (v === '0') return 'ZERO';
  if (/^[1-9][0-9]{0,8}$/.test(v)) return 'NONZERO';
  if (['add-to-cart', 'add_to_cart'].includes(v)) return 'ADD_TO_CART_ENUM';
  if (['buy-now', 'buy_now'].includes(v)) return 'BUY_NOW_ENUM';
  return 'UNKNOWN';
}

/** Never confers authority; caller must independently prove the complete native gate. */
export function evaluateForbiddenOperationField({ category, origin, valueSemantic, clickedSubmitAction, selectedSubmit = null }) {
  if (category !== 'BUY_NOW') return 'ACTIVE'; // Other operation guards are unchanged.
  if (clickedSubmitAction === 'BUY_NOW') return 'ACTIVE';
  if (clickedSubmitAction !== 'ADD_TO_CART') return 'UNKNOWN';
  // Only trusted DOM metadata can establish a non-selected sibling. A serialized
  // submit.buy-now request field is never assumed to be that sibling.
  if (origin === 'SUBMIT_CONTROL') return selectedSubmit === false ? 'INACTIVE' : selectedSubmit === true ? 'ACTIVE' : 'UNKNOWN';
  if (!['FORM_FIELD', 'HIDDEN_INPUT', 'JS_SERIALIZED_FIELD'].includes(origin)) return 'UNKNOWN';
  if (['EMPTY', 'FALSEY_BOOLEAN', 'ZERO', 'ADD_TO_CART_ENUM', 'NONZERO'].includes(valueSemantic)) return 'INACTIVE';
  if (['TRUTHY_BOOLEAN', 'BUY_NOW_ENUM'].includes(valueSemantic)) return 'ACTIVE';
  return 'UNKNOWN';
}

/** Pure bounded body policy. Values never leave this function; the browser owns transport. */
export function nativeFormBodyPolicy(body, contentType, asin, qualifiedInteraction = false) {
  const result = { valid: false, bodyContextMatched: false, forbiddenOperation: false, forbiddenOperationSources: [], sensitiveMaterialPresent: false, fieldClassifications: {}, forbiddenFieldCategories: [], legacyNameMatchClasses: [], forbiddenFieldPresent: false, forbiddenFieldActivated: false, forbiddenFieldStates: [], reason: 'UNINSPECTABLE_NATIVE_FORM' };
  if (typeof body !== 'string' || Buffer.byteLength(body) > 65536 || contentType.split(';')[0].trim().toLowerCase() !== 'application/x-www-form-urlencoded') return result;
  const decode = value => { for (let i = 0; i < 3; i++) value = value.replace(/(?:%[a-f0-9]{2})+/gi, part => { try { return decodeURIComponent(part); } catch { return part; } }); return value; };
  const forbidden = /checkout|\/buy(?:\/|$)|buy[\W_]*now|one[\W_]*click|place[\W_]*order|submit[\W_]*order|payment|purchase|gift[\W_]*card|\/orders?(?:\/|$)|signin|signout|login|logout|account|address|captcha|\/ap\//i;
  const opaqueKeys = new Set(['session-id', 'sessionid', 'session_id', 'token', 'csrftoken', 'csrf-token', 'csrf_token', 'anti-csrftoken-a2z', 'signature', 'authenticitytoken', 'authorization', 'offerlistingid', 'offeringid.1']);
  const fields = [...new URLSearchParams(body)]; if (fields.length > 200) return result;
  const values = name => fields.filter(([key]) => key.toLowerCase() === name).map(([, value]) => value);
  const asins = values('asin'); const quantities = values('quantity'); const offers = values('offerlistingid'); const merchants = values('merchantid');
  const ambiguous = fields.some(([key]) => /^(?:asin|quantity|offerlistingid|merchantid)/i.test(key) && !/^(?:asin|quantity|offerlistingid|merchantid)$/i.test(key));
  result.bodyContextMatched = !ambiguous && asins.length === 1 && asins[0] === asin && quantities.length === 1 && quantities[0] === '1' && offers.length === 1 && !!offers[0].trim() && merchants.length === 1 && !!merchants[0].trim();
  for (const [key, value] of fields) {
    const name = decode(key); const opaque = opaqueKeys.has(name.toLowerCase());
    const field = classifyFieldName(name);
    result.fieldClassifications[field.classification] = (result.fieldClassifications[field.classification] ?? 0) + 1;
    result.sensitiveMaterialPresent ||= opaque || field.classification.startsWith('SENSITIVE_');
    // Value policy is unchanged. A sensitive class alone never exempts its value.
    const operation = value => forbidden.test(value) || /^(?:order|orders|buy|placeorder|submitorder)$/i.test(value.trim());
    if (operation(name) && !result.legacyNameMatchClasses.includes(field.classification)) result.legacyNameMatchClasses.push(field.classification);
    if (field.classification === 'FORBIDDEN_OPERATION_FIELD') {
      result.forbiddenFieldPresent = true;
      const compact = name.toLowerCase().replace(/[._-]/g, '');
      const submit = compact === 'submitbuynow';
      const publicFlag = ['buynow', 'isbuynow', 'enablebuynow', 'buynowenabled', 'buynowflag', 'isoneclick', 'oneclick'].includes(compact);
      const valueSemantic = forbiddenValueSemantic(decode(value), publicFlag);
      const activation = submit ? 'ACTIVE' : evaluateForbiddenOperationField({ category: field.semanticCategory, origin: 'FORM_FIELD', valueSemantic, clickedSubmitAction: qualifiedInteraction && result.bodyContextMatched ? 'ADD_TO_CART' : 'UNKNOWN' });
      result.forbiddenFieldActivated ||= activation === 'ACTIVE';
      result.forbiddenFieldStates.push({ category: field.semanticCategory, fieldRole: submit ? 'SUBMIT_ACTION' : publicFlag ? 'ACTIVATION_FLAG' : 'OTHER_REDACTED', origin: 'FORM_FIELD', valueSemantic, activation });
      if (activation !== 'INACTIVE') {
        if (!result.forbiddenOperationSources.includes('FIELD_NAME')) result.forbiddenOperationSources.push('FIELD_NAME');
        if (!result.forbiddenFieldCategories.includes(field.semanticCategory)) result.forbiddenFieldCategories.push(field.semanticCategory);
      }
    }
    if (!opaque && operation(decode(value)) && !result.forbiddenOperationSources.includes('NON_OPAQUE_VALUE')) result.forbiddenOperationSources.push('NON_OPAQUE_VALUE');
    result.forbiddenOperation = result.forbiddenOperationSources.length > 0;
  }
  if (result.forbiddenOperation) return { ...result, reason: result.forbiddenFieldStates.some(f => f.activation === 'UNKNOWN') ? 'UNKNOWN_FORBIDDEN_FIELD_STATE' : 'FORBIDDEN_NATIVE_FORM_OPERATION' };
  if (!result.bodyContextMatched) return { ...result, reason: 'NATIVE_FORM_CONTEXT_MISMATCH' };
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
