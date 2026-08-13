// Server-facing Plan -> Review -> Apply seam. It deliberately reuses the
// existing composition engine; no route or browser client may invoke scripts.
const crypto = require('crypto');
const pages = require('../repositories/page.repository');
const newspapers = require('../repositories/newspaper.repository');
const { loadNewsroomSourcesForEdition } = require('./newsroomSource.service');
const { buildEditionCompositionPlan, composePagePlan, summarizeEditionComposition } = require('./editionComposition.service');
const { createCodexLocalWriter } = require('./codexLocalWriter.service');
const { createRunJournal } = require('./compositionRunJournal.service');
const { askForJson } = require('./ai');

const plans = new Map(); const activeRuns = new Map();
const stable = (value) => JSON.stringify(value);
const hash = (value) => crypto.createHash('sha256').update(stable(value)).digest('hex');
const disposable = (paper) => String(paper?.publication_date || '').startsWith('2099-') && String(paper?.publication_date || '').slice(0, 10) !== '2099-05-01';
function frameFingerprint(paper, editionPages) { return hash({ edition: paper.id, pageCount: editionPages.length, pages: editionPages.map((page) => ({ id: page.id, template: page.template_key, sections: page.sections.map((s) => [s.section_key, s.x_px, s.y_px, s.width_px, s.height_px, s.block_type, s.story_type, s.feature_key, s.continued_from_section_id, (s.images || []).length]) })) }); }
function reject(code, extra = {}) { return { ok: false, code, ...extra }; }
async function material(editionId) {
  const paper = await newspapers.findById(editionId); if (!paper) return null;
  const editionPages = await pages.findByNewspaper(editionId); const sourceSnapshot = await loadNewsroomSourcesForEdition(editionId);
  return { paper, editionPages, sourceSnapshot, fingerprint: frameFingerprint(paper, editionPages) };
}
function preview(plan, sourceSnapshot, fingerprint) {
  const ledger = plan.pages.flatMap((page) => page.frames.map((frame) => ({ page: page.page.page_number, frame: frame.section_key, recommendedStoryType: frame.recommendedStoryType, semanticRole: page.role, usableArea: Number(frame.width_px) * Number(frame.height_px), sourceId: page.assignments.find((item) => String(item.frameId) === String(frame.id))?.storyId || null })));
  const assigned = ledger.filter((item) => item.sourceId); const area = ledger.reduce((sum, item) => sum + item.usableArea, 0); const assignedArea = assigned.reduce((sum, item) => sum + item.usableArea, 0);
  return { sourceCount: sourceSnapshot.sources.length, sourceSnapshotHash: sourceSnapshot.hash, compositionFingerprint: fingerprint,
    pages: plan.pages.map((page) => ({ page: page.page.page_number, requiredFrames: page.frames.length, candidateSources: page.stories.length, plannedAssignments: page.assignments.map((item) => ({ sourceId: item.storyId, frameId: item.frameId, score: item.score })), unresolvedDemand: page.frames.length - page.assignments.length, directRouting: page.stories.filter((item) => item.routing_mode === 'DIRECT').length, fallbackRouting: page.stories.filter((item) => item.routing_mode === 'FALLBACK').length })),
    expected: { requiredFrames: ledger.length, plannedFrames: assigned.length, unresolvedDemand: ledger.length - assigned.length, editorialCoverageRatio: ledger.length ? Number((assigned.length / ledger.length).toFixed(4)) : 1, weightedEditorialCoverageRatio: area ? Number((assignedArea / area).toFixed(4)) : 1, state: assigned.length === ledger.length ? 'FULLY_COMPOSED' : 'PARTIALLY_COMPOSED' }, ledger };
}
async function planEditionComposition({ editionId, aiMode = 'production', maxServiceCalls = 32 } = {}) {
  const loaded = await material(Number(editionId)); if (!loaded) return reject('EDITION_NOT_FOUND');
  if (aiMode === 'codex-local' && !disposable(loaded.paper)) return reject('CODEX_LOCAL_DISPOSABLE_ONLY');
  const compositionPlan = await buildEditionCompositionPlan({ pages: loaded.editionPages, newspaper: loaded.paper, sources: loaded.sourceSnapshot.sources });
  const data = preview(compositionPlan, loaded.sourceSnapshot, loaded.fingerprint); const token = hash({ v: 1, editionId: loaded.paper.id, snapshot: data.sourceSnapshotHash, fingerprint: data.compositionFingerprint, assignments: data.pages.map((p) => p.plannedAssignments), aiMode, maxServiceCalls });
  plans.set(token, { token, editionId: loaded.paper.id, aiMode, maxServiceCalls, sourceSnapshot: loaded.sourceSnapshot, fingerprint: loaded.fingerprint, compositionPlan, preview: data, createdAt: Date.now() });
  return { ok: true, planToken: token, editionId: loaded.paper.id, writerTransport: aiMode === 'codex-local' ? 'CODEX_LOCAL' : 'configured-provider', ...data, aiCalls: 0, writes: 0 };
}
async function applyEditionComposition({ editionId, planToken, aiMode = 'production', maxServiceCalls = 32 } = {}) {
  const record = plans.get(String(planToken)); if (!record || record.editionId !== Number(editionId)) return reject('COMPOSITION_PLAN_NOT_FOUND');
  // A browser retry after a completed request must be observationally safe.  A
  // plan token names one composition run, not permission to compose it again.
  if (record.result) return { ...record.result, idempotentReplay: true };
  if (activeRuns.has(record.editionId)) return reject('RUN_ALREADY_ACTIVE', { runId: activeRuns.get(record.editionId).runId });
  if (record.aiMode !== aiMode || record.maxServiceCalls !== Number(maxServiceCalls)) return reject('COMPOSITION_PLAN_STALE');
  const loaded = await material(record.editionId); if (!loaded || loaded.fingerprint !== record.fingerprint || loaded.sourceSnapshot.hash !== record.sourceSnapshot.hash) return reject('COMPOSITION_PLAN_STALE');
  if (aiMode === 'codex-local' && !disposable(loaded.paper)) return reject('CODEX_LOCAL_DISPOSABLE_ONLY');
  const runId = crypto.randomUUID(); activeRuns.set(record.editionId, { runId }); const started = Date.now();
  const journal = createRunJournal({ date: loaded.paper.publication_date, allPages: true, mode: aiMode }); journal.event('SOURCE_SNAPSHOT', { sourceCount: record.sourceSnapshot.sources.length, sourceIds: record.sourceSnapshot.sourceIds, sourceSnapshotHash: record.sourceSnapshot.hash });
  try {
    const budget = { max: Number(maxServiceCalls), used: 0, events: [], onConsume(event) { journal.event('PROVIDER_CALL', event); } }; const sourceById = new Map(record.sourceSnapshot.sources.map((source) => [String(source.id), source]));
    const ask = aiMode === 'codex-local' ? createCodexLocalWriter() : askForJson; const results = [];
    for (const pagePlan of record.compositionPlan.pages) results.push(await composePagePlan({ pagePlan, sourcesById: sourceById, newspaper: loaded.paper, askForJson: ask, callBudget: budget, apply: true, journal }));
    const completion = summarizeEditionComposition(record.compositionPlan.pages, results); const blocked = results.some((result) => ['PAGE_BLOCKED', 'BUDGET_BLOCKED', 'PROVIDER_BLOCKED'].includes(result.state)); const state = blocked ? 'BLOCKED' : completion.state;
    journal.finish(state === 'BLOCKED' ? 'BLOCKED' : 'COMPLETE', { providerCalls: budget.used, completion: state });
    const pageResults = results.map((result, index) => ({ page: record.compositionPlan.pages[index].page.page_number, state: result.state, error: result.error || null, preflight: { baseline: result.baselinePreflight?.valid ?? null, projected: result.preflight?.valid ?? null, reload: result.reloadedPreflight?.valid ?? null }, parity: !(result.drift || []).length, groundingRejected: result.outcomes?.filter((outcome) => outcome.state === 'GROUNDING_REJECTED').length || 0 }));
    const result = { ok: true, runId, state, writerTransport: aiMode === 'codex-local' ? 'CODEX_LOCAL' : 'configured-provider', writerCalls: budget.used, sourceSnapshotHash: record.sourceSnapshot.hash, durationMs: Date.now() - started, pages: pageResults, checks: { preflightClean: pageResults.every((page) => page.preflight.baseline !== false && page.preflight.projected !== false && page.preflight.reload !== false), postSaveParity: pageResults.every((page) => page.parity), groundingRejected: pageResults.reduce((sum, page) => sum + page.groundingRejected, 0) }, completion, journalPath: journal.path };
    record.result = result;
    return result;
  } finally { activeRuns.delete(record.editionId); }
}
module.exports = { planEditionComposition, applyEditionComposition, frameFingerprint, _plans: plans, _activeRuns: activeRuns };
