import { classifyFieldName, forbiddenValueSemantic } from './amazon-cart-native-form.mjs';

export const candidateKeys = Object.freeze({ buynow: 'BUY_NOW', isbuynow: 'IS_BUY_NOW', enablebuynow: 'ENABLE_BUY_NOW', buynowenabled: 'BUY_NOW_ENABLED', buynowflag: 'BUY_NOW_FLAG', isoneclick: 'IS_ONE_CLICK', oneclick: 'ONE_CLICK' });
const decode = value => { for (let i = 0; i < 3; i++) value = value.replace(/(?:%[a-f0-9]{2})+/gi, part => { try { return decodeURIComponent(part); } catch { return part; } }); return value; };
export function buyNowCandidateKey(name) {
  const compact = typeof name === 'string' ? name.toLowerCase().replace(/[._-]/g, '') : '';
  return Object.hasOwn(candidateKeys, compact) ? candidateKeys[compact] : 'UNKNOWN';
}

/** Conservative approximation only; never consulted by routing. */
export function successfulControlCandidate(c) {
  if (!c.hasName || !c.belongsToQualifiedForm || c.disabled || !c.enabled) return false;
  if (['checkbox', 'radio'].includes(c.inputType) && c.checked !== true) return false;
  if (c.isSubmitControl) return c.isClickedSubmitter === true;
  if (['button', 'reset', 'file', 'image'].includes(c.inputType)) return false;
  if (c.tagName === 'SELECT') return c.selected === true;
  return ['INPUT', 'TEXTAREA'].includes(c.tagName);
}

/** Browser closure: no values, arbitrary names or live handles cross the callback. */
export function installBuyNowDomDiagnostics(node, { keys, report }) {
  const form = node.form;
  if (!form || !node.isConnected) return { complete: false, domCandidates: [] };
  const nameClass = n => n === 'submit.add-to-cart' ? 'ADD_TO_CART' : n === 'submit.buy-now' ? 'BUY_NOW' : n ? 'OTHER' : 'UNKNOWN';
  const actionLabel = n => {
    const text = (n?.getAttribute('aria-label') || n?.value || n?.textContent || '').trim();
    return /^(?:add to cart|agregar al carrito|añadir a la cesta)$/i.test(text) ? 'ADD_TO_CART' : /^(?:buy now|comprar ahora)$/i.test(text) ? 'BUY_NOW' : text ? 'OTHER' : 'UNKNOWN';
  };
  const capture = () => {
    const controls = form.elements; const rows = []; let complete = controls.length <= 2000;
    for (let i = 0; i < Math.min(controls.length, 2000); i++) {
      const c = controls[i]; const compact = c.name.toLowerCase().replace(/[._-]/g, '');
      if (!Object.hasOwn(keys, compact)) continue;
      if (rows.length >= 200) { complete = false; break; }
      const tagName = ['INPUT', 'SELECT', 'TEXTAREA', 'BUTTON'].includes(c.tagName) ? c.tagName : 'OTHER';
      const inputType = ['hidden', 'text', 'number', 'checkbox', 'radio', 'submit', 'image', 'button', 'reset', 'file', 'select-one', 'select-multiple', 'textarea'].includes(c.type) ? c.type : 'OTHER';
      const disabled = c.disabled === true || c.matches(':disabled');
      const style = getComputedStyle(c);
      rows.push({ candidateKey: keys[compact], tagName, inputType, hiddenByType: inputType === 'hidden', visible: c.getClientRects().length > 0 && style.visibility !== 'hidden' && style.display !== 'none', enabled: !disabled, disabled, checked: ['checkbox', 'radio'].includes(inputType) ? c.checked === true : null, selected: tagName === 'SELECT' ? [...c.options].some(o => o.selected && !o.disabled && !o.parentElement?.disabled) : null, isSubmitControl: ['submit', 'image'].includes(inputType), isClickedSubmitter: c === node, belongsToQualifiedForm: c.form === form && node.form === form, hasName: !!c.name });
    }
    return { complete, domCandidates: rows };
  };
  document.addEventListener('submit', event => {
    if (event.target !== form) return;
    const s = event.submitter;
    const projection = { nameClass: nameClass(s?.name), idClass: s?.id === 'add-to-cart-button' ? 'ADD_TO_CART_BUTTON' : s?.id ? 'OTHER' : 'UNKNOWN', actionLabel: actionLabel(s), trusted: event instanceof Event && event.isTrusted === true };
    void report(projection).catch(() => { });
  }, { capture: true, passive: true });
  return capture();
}

export function sanitizedSubmitter(value) {
  const action = v => ['ADD_TO_CART', 'BUY_NOW', 'OTHER'].includes(v) ? v : 'UNKNOWN';
  return { nameClass: action(value?.nameClass), idClass: ['ADD_TO_CART_BUTTON', 'OTHER'].includes(value?.idClass) ? value.idClass : 'UNKNOWN', actionLabel: action(value?.actionLabel), trusted: value?.trusted === true };
}

export function sanitizeDomCandidates(snapshot) {
  const rows = Array.isArray(snapshot?.domCandidates) ? snapshot.domCandidates.slice(0, 200) : [];
  const domCandidates = rows.filter(c => Object.values(candidateKeys).includes(c?.candidateKey)).map(c => {
    const result = { candidateKey: c.candidateKey, tagName: ['INPUT', 'BUTTON', 'TEXTAREA', 'SELECT'].includes(c.tagName) ? c.tagName : 'OTHER', inputType: ['hidden', 'text', 'number', 'checkbox', 'radio', 'submit', 'image', 'button', 'reset', 'file', 'select-one', 'select-multiple', 'textarea'].includes(c.inputType) ? c.inputType : 'OTHER', hiddenByType: c.hiddenByType === true, visible: c.visible === true, enabled: c.enabled === true, disabled: c.disabled !== false, checked: typeof c.checked === 'boolean' ? c.checked : null, selected: typeof c.selected === 'boolean' ? c.selected : null, isSubmitControl: c.isSubmitControl === true, isClickedSubmitter: c.isClickedSubmitter === true, belongsToQualifiedForm: c.belongsToQualifiedForm === true, hasName: c.hasName === true };
    return { ...result, successfulControlCandidate: successfulControlCandidate(result) };
  });
  return { complete: snapshot?.complete === true && snapshot.domCandidates.length <= 200 && rows.length === domCandidates.length, domCandidates };
}

export function correlateBuyNowFields(snapshot, body, contentType, states = []) {
  const dom = sanitizeDomCandidates(snapshot); const serialized = []; let complete = false; let stateIndex = 0;
  if (typeof body === 'string' && Buffer.byteLength(body) <= 65536 && contentType.split(';')[0].trim().toLowerCase() === 'application/x-www-form-urlencoded') {
    const fields = [...new URLSearchParams(body)]; complete = fields.length <= 200;
    if (complete) for (const [name, value] of fields) {
      const decoded = decode(name); const key = buyNowCandidateKey(decoded);
      const isForbidden = classifyFieldName(decoded).classification === 'FORBIDDEN_OPERATION_FIELD';
      const state = isForbidden ? states[stateIndex++] : null;
      if (key !== 'UNKNOWN') serialized.push({ candidateKey: key, valueSemantic: forbiddenValueSemantic(decode(value), true), activationState: ['ACTIVE', 'INACTIVE', 'UNKNOWN'].includes(state?.activation) ? state.activation : 'UNKNOWN' });
    }
  }
  const key = !complete ? 'UNKNOWN' : serialized.length > 1 ? 'MULTIPLE' : serialized[0]?.candidateKey ?? 'NONE';
  let correlation = 'UNKNOWN';
  if (complete && dom.complete) {
    const matches = dom.domCandidates.filter(c => c.candidateKey === key);
    if (serialized.length > 1 || matches.length > 1) correlation = 'MULTIPLE_AMBIGUOUS';
    else if (!serialized.length) correlation = 'NO_MATCH';
    else if (!matches.length) correlation = 'BODY_ONLY_NOT_IN_DOM';
    else { const c = matches[0]; correlation = c.isSubmitControl && !c.isClickedSubmitter ? 'NON_CLICKED_SUBMIT_CONTROL' : c.hiddenByType ? 'HIDDEN_DOM_FIELD' : c.visible && !c.isSubmitControl ? 'VISIBLE_NON_SUBMIT_FIELD' : 'EXACT_DOM_CONTROL'; }
  }
  return { domCandidateCount: dom.domCandidates.length, domCandidates: dom.domCandidates, domSnapshotComplete: dom.complete, domSnapshotPhase: 'PRE_CLICK', serializedCandidateCount: serialized.length, serializedBuyNowCandidateKey: key, serializedCandidates: serialized, serializedValueSemantic: serialized.length === 1 ? serialized[0].valueSemantic : 'UNKNOWN', currentActivationState: serialized.some(c => c.activationState === 'ACTIVE') ? 'ACTIVE' : serialized.length && serialized.every(c => c.activationState === 'INACTIVE') ? 'INACTIVE' : 'UNKNOWN', correlation, numericSemanticInterpretation: { sourceContractKnown: false, interpretation: 'UNKNOWN' } };
}
