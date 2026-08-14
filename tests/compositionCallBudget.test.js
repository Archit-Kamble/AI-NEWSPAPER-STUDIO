// Project B8B-PRODUCTION-MODEL-CLOSEOUT: the canonical demand-derived
// provider-call budget. This module is the one place "how many stories does
// this plan need to write" becomes "how many physical provider calls the
// operator may spend" - see compositionCallBudget.service.js for why the
// exact-fit ceiling is not a guaranteed physical-call worst case.

const test = require('node:test');
const assert = require('node:assert/strict');
const { deriveCompositionCallBudget, summarizeProviderCallEvents } = require('../src/services/compositionCallBudget.service');

test('34 planned assignments and no explicit cap derives the exact-fit ceiling, 68', () => {
  const budget = deriveCompositionCallBudget({ plannedAssignments: 34 });
  assert.equal(budget.ok, true);
  assert.equal(budget.minimumProviderCalls, 34);
  assert.equal(budget.exactFitRequestCeiling, 68);
  assert.equal(budget.selectedProviderCallCap, 68);
  assert.equal(budget.selectionMode, 'DERIVED');
  assert.equal(budget.risk, 'NORMAL');
});

test('34 planned assignments with an explicit cap of 32 is mathematically impossible and is rejected', () => {
  const budget = deriveCompositionCallBudget({ plannedAssignments: 34, requestedMaxProviderCalls: 32 });
  assert.equal(budget.ok, false);
  assert.equal(budget.code, 'COMPOSITION_CALL_BUDGET_TOO_LOW');
  assert.equal(budget.plannedAssignments, 34);
  assert.equal(budget.minimumProviderCalls, 34);
  assert.equal(budget.exactFitRequestCeiling, 68);
  assert.equal(budget.requestedProviderCallCap, 32);
});

test('the standard four-page 34-story edition follows the same policy as any other planned count', () => {
  assert.deepEqual(
    [3, 20, 34].map((plannedAssignments) => deriveCompositionCallBudget({ plannedAssignments })),
    [3, 20, 34].map((plannedAssignments) => ({
      ok: true, plannedAssignments, minimumProviderCalls: plannedAssignments,
      exactFitRequestCeiling: plannedAssignments * 2, requestedProviderCallCap: null,
      selectedProviderCallCap: plannedAssignments * 2, selectionMode: 'DERIVED', risk: 'NORMAL',
    })),
  );
});

test('an explicit cap between the minimum and the exact-fit ceiling is accepted but flagged TIGHT, not silently widened', () => {
  const budget = deriveCompositionCallBudget({ plannedAssignments: 34, requestedMaxProviderCalls: 50 });
  assert.equal(budget.ok, true);
  assert.equal(budget.selectedProviderCallCap, 50);
  assert.equal(budget.selectionMode, 'EXPLICIT');
  assert.equal(budget.risk, 'TIGHT');
});

test('an explicit cap at or above the exact-fit ceiling is accepted as NORMAL risk', () => {
  assert.equal(deriveCompositionCallBudget({ plannedAssignments: 34, requestedMaxProviderCalls: 68 }).risk, 'NORMAL');
  assert.equal(deriveCompositionCallBudget({ plannedAssignments: 34, requestedMaxProviderCalls: 100 }).risk, 'NORMAL');
});

// The exact bug in the previous source: `req.body?.maxServiceCalls || 32`
// turns an explicit, meaningful zero into the default. This policy must not
// repeat that mistake - an explicit 0 is a real, too-low request.
test('an explicit zero is a real request, not "no preference" - it is rejected, never silently defaulted', () => {
  const budget = deriveCompositionCallBudget({ plannedAssignments: 34, requestedMaxProviderCalls: 0 });
  assert.equal(budget.ok, false);
  assert.equal(budget.code, 'COMPOSITION_CALL_BUDGET_TOO_LOW');
  assert.equal(budget.requestedProviderCallCap, 0);
});

test('omitted (undefined/null) is the only spelling of "let the policy choose"', () => {
  assert.equal(deriveCompositionCallBudget({ plannedAssignments: 10, requestedMaxProviderCalls: undefined }).selectionMode, 'DERIVED');
  assert.equal(deriveCompositionCallBudget({ plannedAssignments: 10, requestedMaxProviderCalls: null }).selectionMode, 'DERIVED');
});

test('zero planned assignments needs zero provider calls', () => {
  const budget = deriveCompositionCallBudget({ plannedAssignments: 0 });
  assert.equal(budget.ok, true);
  assert.equal(budget.minimumProviderCalls, 0);
  assert.equal(budget.exactFitRequestCeiling, 0);
  assert.equal(budget.selectedProviderCallCap, 0);
});

test('summarizeProviderCallEvents aggregates by provider and reason without carrying any request/response content', () => {
  const events = [
    { provider: 'gemini', reason: 'initial', callNumber: 1 },
    { provider: 'gemini', reason: 'initial', callNumber: 2 },
    { provider: 'gemini', reason: 'retry', callNumber: 3 },
    { provider: 'sarvam', reason: 'initial', callNumber: 4 },
  ];
  const summary = summarizeProviderCallEvents(events);
  assert.deepEqual(summary, { byProvider: { gemini: 3, sarvam: 1 }, byReason: { initial: 3, retry: 1 } });
  assert.deepEqual(Object.keys(summary).sort(), ['byProvider', 'byReason']);
});

test('summarizeProviderCallEvents is safe on an empty or missing event list', () => {
  assert.deepEqual(summarizeProviderCallEvents([]), { byProvider: {}, byReason: {} });
  assert.deepEqual(summarizeProviderCallEvents(), { byProvider: {}, byReason: {} });
});
