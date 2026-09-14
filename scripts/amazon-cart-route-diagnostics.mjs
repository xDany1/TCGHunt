/** Errors are categorized in memory; raw messages/stacks/URLs never enter results. */
export function sanitizedRouteFailure(error, trace) {
  const message = typeof error?.message === 'string' ? error.message : '';
  const stage = ['REQUEST_OBJECT', 'REQUEST_METADATA', 'BODY_READ', 'HEADERS', 'URL_PARSE', 'NATIVE_EVENT_WAIT', 'ELIGIBILITY', 'EVIDENCE_PROJECTION', 'RECORD', 'CONTINUE', 'ABORT'].includes(trace.stage) ? trace.stage : 'REQUEST_OBJECT';
  const errorCategory = /execution context.*destroyed|disposed|jshandle|stale.*handle|cannot find context/i.test(message) ? 'STALE_BROWSER_HANDLE'
    : stage === 'BODY_READ' ? 'BODY_PARSE_FAILURE'
      : stage === 'ELIGIBILITY' ? 'ELIGIBILITY_STATE_ERROR'
        : stage === 'CONTINUE' || stage === 'ABORT' || /target.*closed|route.*handled/i.test(message) ? 'ROUTE_LIFECYCLE_ERROR'
          : /assert/i.test(error?.name ?? '') ? 'INTERNAL_ASSERTION' : 'UNKNOWN_INTERNAL';
  return Object.freeze({
    stage, errorCategory, requestSequence: Number.isSafeInteger(trace.requestSequence) ? trace.requestSequence : null,
    actionState: ['BASELINE', 'BASELINE_COMPLETE', 'ACTION_ARMED', 'ACTION_ACTIVE', 'POST_ACTION_CONFIRMATION', 'TERMINATED'].includes(trace.actionState) ? trace.actionState : 'UNKNOWN',
    hostClass: ['APPROVED_AMAZON_MX', 'AMAZON_MX_SUBDOMAIN_UNAPPROVED', 'AMAZON_STATIC', 'OTHER_HOST'].includes(trace.hostClass) ? trace.hostClass : 'UNKNOWN',
    method: ['GET', 'POST', 'HEAD', 'OPTIONS', 'PUT', 'PATCH', 'DELETE'].includes(trace.method) ? trace.method : 'OTHER',
    resourceType: ['document', 'xhr', 'fetch', 'script', 'stylesheet', 'image', 'font'].includes(trace.resourceType) ? trace.resourceType : 'OTHER',
    pathClass: ['STRICT_CART_ADD', 'OTHER_PATH'].includes(trace.pathClass) ? trace.pathClass : 'UNKNOWN',
    nativeCartEligibilityStage: ['NOT_APPLICABLE', 'PENDING', 'QUALIFIED', 'REJECTED'].includes(trace.nativeCartEligibilityStage) ? trace.nativeCartEligibilityStage : 'NOT_APPLICABLE'
  });
}
