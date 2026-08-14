// The one place that turns "how many stories does this plan need to write"
// into "how many physical provider calls the operator is permitted to
// spend" - so Plan/Apply, the controller, the workspace panel, and the
// disposable CLI script never each carry their own hard-coded number.
//
// A provider call is one attempt to one provider - ai/index.js's
// consumeProviderCall(), fired once per callOnce(). One editorial write
// (exactFitWriter.service.js's composeSourceToFrame) can spend up to two
// askForJson() requests: an initial attempt and, only if the first genuinely
// needs repair, one more. Each of those askForJson() requests can itself
// spend more than one physical provider call if the primary provider
// retries (outputExhausted) or the whole thing falls to an understudy
// provider - so exactFitRequestCeiling is an editorial-request ceiling, not
// a guaranteed worst-case physical-call count. Real retries/fallbacks are
// charged out of the same physical cap regardless.

const EDITORIAL_REQUESTS_PER_ASSIGNMENT = 2; // composeSourceToFrame: initial + at most one repair

/**
 * @param {number} plannedAssignments - stories actually assigned to a frame
 *   this Plan (not the raw frame count - an unassigned frame spends nothing).
 * @param {number|null|undefined} requestedMaxProviderCalls - an explicit
 *   operator-supplied cap, or omitted/null to take the derived default.
 */
function deriveCompositionCallBudget({ plannedAssignments, requestedMaxProviderCalls } = {}) {
  const planned = Math.max(0, Math.trunc(Number(plannedAssignments) || 0));
  const minimumProviderCalls = planned;
  const exactFitRequestCeiling = planned * EDITORIAL_REQUESTS_PER_ASSIGNMENT;

  // Deliberately not `||` - an explicit 0 is a real, too-low request, not
  // "no preference". Only undefined/null means "let the policy choose".
  if (requestedMaxProviderCalls === undefined || requestedMaxProviderCalls === null) {
    return {
      ok: true,
      plannedAssignments: planned,
      minimumProviderCalls,
      exactFitRequestCeiling,
      requestedProviderCallCap: null,
      selectedProviderCallCap: exactFitRequestCeiling,
      selectionMode: 'DERIVED',
      risk: 'NORMAL',
    };
  }

  const requested = Number(requestedMaxProviderCalls);
  if (!Number.isFinite(requested) || requested < minimumProviderCalls) {
    return {
      ok: false,
      code: 'COMPOSITION_CALL_BUDGET_TOO_LOW',
      plannedAssignments: planned,
      minimumProviderCalls,
      exactFitRequestCeiling,
      requestedProviderCallCap: Number.isFinite(requested) ? requested : requestedMaxProviderCalls,
    };
  }

  return {
    ok: true,
    plannedAssignments: planned,
    minimumProviderCalls,
    exactFitRequestCeiling,
    requestedProviderCallCap: requested,
    selectedProviderCallCap: requested,
    selectionMode: 'EXPLICIT',
    risk: requested < exactFitRequestCeiling ? 'TIGHT' : 'NORMAL',
  };
}

/** Safe (no prompts, no source text, no keys) aggregate of what a callBudget actually spent. */
function summarizeProviderCallEvents(events = []) {
  const byProvider = {};
  const byReason = {};
  for (const event of events) {
    const provider = String(event?.provider || 'unknown');
    const reason = String(event?.reason || 'unknown');
    byProvider[provider] = (byProvider[provider] || 0) + 1;
    byReason[reason] = (byReason[reason] || 0) + 1;
  }
  return { byProvider, byReason };
}

module.exports = { deriveCompositionCallBudget, summarizeProviderCallEvents, EDITORIAL_REQUESTS_PER_ASSIGNMENT };
