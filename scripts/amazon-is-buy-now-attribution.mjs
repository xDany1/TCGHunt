/** Offline analysis selection. A fenced mutable retry cannot replace the first run. */
export function authoritativeRun14(immutable, mutable) {
  if (immutable?.cartResearchOperationId !== 'm5-7-b0gyvhlp4l-fourteenth' || immutable.actionExecuted !== true) throw new Error('AUTHORITATIVE_RUN14_REQUIRED');
  return { snapshot: immutable, source: 'IMMUTABLE_RUN14', mutableSummaryIsFencedRetry: mutable?.reason === 'OPERATION_ALREADY_CONSUMED' && mutable?.startupStage === 'OPERATION_FENCE' };
}

/** Read-only DOM projection; never submits, changes a control, or returns raw values. */
export function inspectPassiveIsBuyNowForms(root, asin) {
  const output = []; const forms = [...root.querySelectorAll('form')];
  for (const form of forms.slice(0, 40)) {
    const controls = [...form.elements]; if (controls.length > 2000) continue;
    const named = name => controls.filter(c => c.name?.toLowerCase() === name);
    const asins = named('asin'); if (!asins.length || asins.some(c => c.value !== asin)) continue;
    const actions = [...new Set(controls.map(c => c.name === 'submit.add-to-cart' ? 'ADD_TO_CART' : c.name === 'submit.buy-now' ? 'BUY_NOW' : c.name === 'submit.preorder' ? 'PREORDER' : null).filter(Boolean))];
    const role = actions.length === 1 ? actions[0] : actions.length ? 'OTHER' : 'UNKNOWN';
    let actionPathClass = 'UNKNOWN';
    try {
      const u = new URL(form.action);
      if (u.protocol === 'https:' && u.hostname === 'www.amazon.com.mx' && !u.username && !u.password && !u.port) {
        actionPathClass = /^\/cart\/add-to-cart\/[^/]+\/?$/.test(u.pathname) ? 'CART_ADD' : /\/buy(?:\/|$)|buy-now|checkout/.test(u.pathname) ? 'BUY_OR_CHECKOUT' : 'OTHER';
      }
    } catch { /* No raw URL retained. */ }
    const fields = controls.filter(c => c.name?.toLowerCase().replace(/[._-]/g, '') === 'isbuynow').slice(0, 200).map(c => {
      const v = typeof c.value === 'string' ? c.value.trim() : null;
      const valueSemantic = v === null ? 'UNKNOWN' : v === '' ? 'EMPTY' : /^0+$/.test(v) ? 'ZERO' : /^[1-9][0-9]*$/.test(v) ? 'NONZERO' : 'NON_NUMERIC';
      const disabled = c.disabled === true || c.matches(':disabled');
      const type = ['hidden', 'text', 'number', 'checkbox', 'radio', 'submit', 'button', 'image'].includes(c.type) ? c.type : 'OTHER';
      const belongsToForm = c.form === form;
      return { fieldPresent: true, fieldNameClass: 'IS_BUY_NOW', inputType: type, hiddenByType: type === 'hidden', enabled: !disabled, disabled, belongsToForm, successfulControlCandidate: belongsToForm && !disabled && ['hidden', 'text', 'number', 'checkbox', 'radio'].includes(type) && (!['checkbox', 'radio'].includes(type) || c.checked === true), valueSemantic };
    });
    output.push({ formRole: role, actionPathClass, method: ['get', 'post'].includes(form.method?.toLowerCase()) ? form.method.toUpperCase() : 'OTHER', submitControlsPresent: actions, clickedRelevance: 'NO_ACTION_PERFORMED', asinBound: true, quantityBound: named('quantity').length === 1 && named('quantity')[0].value === '1', offerBindingPresent: named('offerlistingid').length > 0, merchantBindingPresent: named('merchantid').length > 0, fieldPresent: fields.length > 0, fields });
  }
  return { forms: output, scanCapped: forms.length > 40, comparisonOnly: true };
}

/** Caller supplies only text already obtained by normal page load; never fetches it. */
export function summarizeLoadedIsBuyNowReferences(sources) {
  const allowed = ['INLINE_SCRIPT', 'LOADED_PUBLIC_SCRIPT', 'DOM_ATTRIBUTE', 'FORM_MARKUP'];
  const findings = [];
  for (const source of sources.slice(0, 100)) {
    if (source.alreadyLoaded !== true || !allowed.includes(source.sourceClass) || typeof source.text !== 'string') continue;
    const bounded = source.text.slice(0, 250000);
    const occurrences = [...bounded.matchAll(/\bisBuyNow\b/g)].length;
    if (occurrences) findings.push({ sourceClass: source.sourceClass, identifierPresent: true, occurrences: Math.min(occurrences, 100), sourceTruncated: source.text.length > bounded.length, contractAttribution: 'REQUIRES_SEMANTIC_REVIEW' });
  }
  // An identifier reference alone cannot distinguish activation from metadata.
  return { findings, meaning: 'UNKNOWN', confidence: 'INSUFFICIENT_EVIDENCE', nonzeroMeaning: 'UNKNOWN' };
}
