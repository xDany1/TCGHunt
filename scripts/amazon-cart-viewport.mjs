import { inspectCartControls } from './amazon-cart-causality.mjs';
import { boundedBrowserStep } from './amazon-browser-runtime.mjs';

/** The only page-changing action here is ordinary scrolling of the retained node. */
export function scrollPinnedControl(node) {
  if (!node.isConnected) return false;
  node.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'instant' });
  return true;
}
export function validPinnedSemantics(candidate) {
  return !!candidate && candidate.semanticQualified === true && candidate.boundingBoxPresent === true && candidate.id === 'add-to-cart-button' && candidate.name === 'submit.add-to-cart' && candidate.tagName === 'INPUT' && candidate.inputType === 'submit' && candidate.actionLabel === 'ADD_TO_CART' && candidate.visible && candidate.enabled && candidate.connected && candidate.productBound && !candidate.recommendation && candidate.formActionQualified === true && candidate.form?.method === 'POST' && candidate.form.expectedAsinMatched === true && candidate.form.quantityMatched === true && candidate.form.enctype === 'application/x-www-form-urlencoded';
}
function stableGeometry(a, b) {
  return !!a && !!b && ['x', 'y', 'width', 'height'].every(k => Number.isFinite(a[k]) && Number.isFinite(b[k]) && Math.abs(a[k] - b[k]) <= 0.5);
}
/** Pin first; at most one detached-node rescan. No alternate control is attempted for an obstruction. */
export async function prepareViewportControl(page, config, clock, initial, record) {
  const args = { asin: config.asin, action: config.action }; let controls = initial; let rescans = 0;
  Object.assign(record, { before: initial, after: null, scrollCount: 0, rescanCount: 0, layoutSamples: [], status: 'PENDING', preselected: initial.preselected ?? null, selected: null, selectedPrimaryIndex: null });
  try {
    for (; ;) {
      const index = controls.preselectedPrimaryIndex;
      if (index === null || index === undefined || controls.candidateScanCapped || !validPinnedSemantics(controls.preselected)) { record.semanticRejections = controls.candidates?.map(c => ({ primaryIndex: c.primaryIndex, reasons: c.semanticRejectionReasons ?? [] })) ?? []; throw new Error('CLICK_TARGET_NOT_QUALIFIED'); }
      const handle = await boundedBrowserStep(page.locator('#add-to-cart-button').nth(index).elementHandle(), 5000, 'CONTROL_HANDLE_TIMEOUT');
      let detached = !handle;
      let pinned;
      if (handle) {
        pinned = await boundedBrowserStep(handle.evaluate(inspectCartControls, args), 5000, 'CONTROL_REVALIDATION_TIMEOUT');
        record.after = pinned; detached = pinned.pinnedConnected === false;
      }
      if (!detached) {
        if (!pinned.pinnedMatchesCandidate || !validPinnedSemantics(pinned.preselected)) throw new Error('CLICK_TARGET_CHANGED');
        if (pinned.preselected.geometry?.intersectionRatio < 0.999 || pinned.preselected.obstruction === 'OBSCURED_BY_PAGE_CHROME') {
          record.scrollCount++;
          detached = !await boundedBrowserStep(handle.evaluate(scrollPinnedControl), 5000, 'CONTROL_SCROLL_TIMEOUT');
        }
        let previousBox = null; let stable = false;
        for (let sample = 0; sample < 4 && !detached; sample++) {
          await clock.wait(100);
          pinned = await boundedBrowserStep(handle.evaluate(inspectCartControls, args), 3000, 'CONTROL_LAYOUT_TIMEOUT');
          record.after = pinned; detached = pinned.pinnedConnected === false; if (detached) break;
          if (pinned.candidateScanCapped || !pinned.pinnedMatchesCandidate || !validPinnedSemantics(pinned.preselected)) throw new Error('CLICK_TARGET_BINDING_CHANGED');
          const candidate = pinned.preselected;
          record.layoutSamples.push({ box: candidate.geometry?.elementBoundingBox ?? null, obstruction: candidate.obstruction });
          stable = stableGeometry(previousBox, candidate.geometry?.elementBoundingBox); previousBox = candidate.geometry?.elementBoundingBox;
          if (stable) break;
        }
        if (!detached) {
          if (!stable) throw new Error('CONTROL_LAYOUT_NOT_STABLE');
          const candidate = pinned.preselected;
          if (candidate.obstruction === 'OBSCURED_BY_MODAL_OR_PANEL' || pinned.activeBlockingPanelPresent) throw new Error('BLOCKED_BY_MODAL');
          if (candidate.obstruction === 'OUTSIDE_VIEWPORT') throw new Error('CLICK_TARGET_OUTSIDE_VIEWPORT');
          if (!candidate.unobscured) throw new Error('CLICK_TARGET_OBSCURED');
          const final = await boundedBrowserStep(handle.evaluate(inspectCartControls, { ...args, finalClickQualification: true }), 3000, 'CONTROL_FINAL_TIMEOUT');
          record.after = final;
          if (final.activeBlockingPanelPresent) throw new Error('BLOCKED_BY_MODAL');
          if (!validPinnedSemantics(final.selected) || !final.pinnedMatchesSelection || final.selectedPrimaryIndex !== index || !stableGeometry(candidate.geometry?.elementBoundingBox, final.selected.geometry?.elementBoundingBox)) throw new Error('CLICK_TARGET_FINAL_REVALIDATION_FAILED');
          record.selected = final.selected; record.preselected = final.preselected; record.qualificationStage = 'CLICK_QUALIFIED';
          record.status = 'QUALIFIED_AFTER_VIEWPORT_NORMALIZATION'; record.selectedPrimaryIndex = index; record.selectionReason = record.status;
          return handle;
        }
      }
      if (rescans >= 1) throw new Error('CLICK_TARGET_DETACHED');
      rescans++; record.rescanCount = rescans;
      controls = await boundedBrowserStep(page.evaluate(inspectCartControls, args), 5000, 'CONTROL_RESCAN_TIMEOUT');
    }
  } catch (error) { record.status = 'BLOCKED'; record.reason = /^[A-Z_]+$/.test(error?.message ?? '') ? error.message : 'VIEWPORT_QUALIFICATION_FAILED'; throw error; }
}
