// Server-facing Plan -> Review -> Apply seam. It deliberately reuses the
// existing composition engine; no route or browser client may invoke scripts.
const crypto = require('crypto');
const pages = require('../repositories/page.repository');
const newspapers = require('../repositories/newspaper.repository');
const { loadNewsroomSourcesForEdition } = require('./newsroomSource.service');
const { buildEditionCompositionPlan, composePagePlan, summarizeEditionComposition } = require('./editionComposition.service');
const { persistPreparedPageComposition } = require('./editionComposition.service');
const { createCodexLocalWriter } = require('./codexLocalWriter.service');
const { createRunJournal } = require('./compositionRunJournal.service');
const { askForJson } = require('./ai');
const pool = require('../config/db');
const runRepository = require('../repositories/editionCompositionRun.repository');

const plans = new Map(); const activeRuns = new Map();
const stable = (value) => JSON.stringify(value);
const hash = (value) => crypto.createHash('sha256').update(stable(value)).digest('hex');
const disposable = (paper) => String(paper?.publication_date || '').startsWith('2099-') && String(paper?.publication_date || '').slice(0, 10) !== '2099-05-01';
function frameFingerprint(paper, editionPages) { return hash({ edition: paper.id, pageCount: editionPages.length, pages: editionPages.map((page) => ({ id: page.id, template: page.template_key, sections: page.sections.map((s) => [s.section_key, s.x_px, s.y_px, s.width_px, s.height_px, s.block_type, s.story_type, s.feature_key, s.continued_from_section_id, (s.images || []).length]) })) }); }
const COMPOSITION_FIELDS = ['news_item_id', 'story_type', 'editorial_priority', 'kicker', 'headline', 'subheading', 'body', 'caption', 'category', 'location', 'tags', 'reporter_name', 'ai_notes', 'language', 'status', 'ai_generated', 'editorial_presentation'];
function baselineFingerprint(editionPages) { return hash(editionPages.map((page) => ({ id: page.id, sections: page.sections.map((section) => [section.section_key, ...COMPOSITION_FIELDS.map((field) => section[field] ?? null)]) }))); }
function reject(code, extra = {}) { return { ok: false, code, ...extra }; }
async function material(editionId) {
  const paper = await newspapers.findById(editionId); if (!paper) return null;
  const editionPages = await pages.findByNewspaper(editionId); const sourceSnapshot = await loadNewsroomSourcesForEdition(editionId);
  return { paper, editionPages, sourceSnapshot, fingerprint: frameFingerprint(paper, editionPages), baselineFingerprint: baselineFingerprint(editionPages) };
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
  await runRepository.recoverUnfinished(loaded.paper.id);
  if (aiMode === 'codex-local' && !disposable(loaded.paper)) return reject('CODEX_LOCAL_DISPOSABLE_ONLY');
  const compositionPlan = await buildEditionCompositionPlan({ pages: loaded.editionPages, newspaper: loaded.paper, sources: loaded.sourceSnapshot.sources });
  const data = preview(compositionPlan, loaded.sourceSnapshot, loaded.fingerprint); const token = hash({ v: 1, editionId: loaded.paper.id, snapshot: data.sourceSnapshotHash, fingerprint: data.compositionFingerprint, assignments: data.pages.map((p) => p.plannedAssignments), aiMode, maxServiceCalls });
  plans.set(token, { token, editionId: loaded.paper.id, aiMode, maxServiceCalls, sourceSnapshot: loaded.sourceSnapshot, fingerprint: loaded.fingerprint, compositionPlan, preview: data, createdAt: Date.now() });
  return { ok: true, planToken: token, editionId: loaded.paper.id, writerTransport: aiMode === 'codex-local' ? 'CODEX_LOCAL' : 'configured-provider', ...data, aiCalls: 0, writes: 0 };
}
function isHardPreparationFailure(result) { return !result || ['PAGE_BLOCKED', 'BUDGET_BLOCKED', 'PROVIDER_BLOCKED'].includes(result.state) || result.state !== 'READY_TO_PERSIST'; }
function pageResult(pagePlan, result) { return { page: pagePlan.page.page_number, state: result.state, error: result.error || null, preflight: { baseline: result.baselinePreflight?.valid ?? null, projected: result.preflight?.valid ?? null, reload: result.reloadedPreflight?.valid ?? null }, parity: !(result.drift || []).length, groundingRejected: result.outcomes?.filter((outcome) => outcome.state === 'GROUNDING_REJECTED').length || 0 }; }
async function applyEditionComposition({ editionId, planToken, aiMode = 'production', maxServiceCalls = 32, _askForJson, _beforePersist, _composePagePlan = composePagePlan, _persistPreparedPage = persistPreparedPageComposition } = {}) {
  const record = plans.get(String(planToken)); if (!record || record.editionId !== Number(editionId)) return reject('COMPOSITION_PLAN_NOT_FOUND');
  // A browser retry after a completed request must be observationally safe.  A
  // plan token names one composition run, not permission to compose it again.
  if (record.result) return { ...record.result, idempotentReplay: true };
  if (record.failed) return reject('COMPOSITION_PLAN_STALE');
  if (activeRuns.has(record.editionId)) return reject('RUN_ALREADY_ACTIVE', { runId: activeRuns.get(record.editionId).runId });
  if (record.aiMode !== aiMode || record.maxServiceCalls !== Number(maxServiceCalls)) return reject('COMPOSITION_PLAN_STALE');
  const loaded = await material(record.editionId); if (!loaded || loaded.fingerprint !== record.fingerprint || loaded.sourceSnapshot.hash !== record.sourceSnapshot.hash) return reject('COMPOSITION_PLAN_STALE');
  if (aiMode === 'codex-local' && !disposable(loaded.paper)) return reject('CODEX_LOCAL_DISPOSABLE_ONLY');
  await runRepository.recoverUnfinished(record.editionId);
  const runId = crypto.randomUUID(); activeRuns.set(record.editionId, { runId }); const started = Date.now();
  const journal = createRunJournal({ date: loaded.paper.publication_date, allPages: true, mode: aiMode }); journal.event('SOURCE_SNAPSHOT', { sourceCount: record.sourceSnapshot.sources.length, sourceIds: record.sourceSnapshot.sourceIds, sourceSnapshotHash: record.sourceSnapshot.hash });
  await runRepository.create({ runId, editionId: record.editionId, planTokenHash: hash(record.token), sourceSnapshotHash: record.sourceSnapshot.hash, baselineFingerprint: loaded.baselineFingerprint, writerTransport: aiMode === 'codex-local' ? 'CODEX_LOCAL' : 'configured-provider', state: 'PREPARING', pageCount: record.compositionPlan.pages.length });
  try {
    const budget = { max: Number(maxServiceCalls), used: 0, events: [], onConsume(event) { journal.event('PROVIDER_CALL', event); } }; const sourceById = new Map(record.sourceSnapshot.sources.map((source) => [String(source.id), source]));
    const ask = _askForJson || (aiMode === 'codex-local' ? createCodexLocalWriter() : askForJson); const prepared = [];
    journal.event('EDITION_PREPARE_STARTED');
    for (const pagePlan of record.compositionPlan.pages) { const result = await _composePagePlan({ pagePlan, sourcesById: sourceById, newspaper: loaded.paper, askForJson: ask, callBudget: budget, apply: false, journal }); prepared.push(result); journal.event('PAGE_PREPARED', { page: pagePlan.page.page_number, state: result.state }); if (isHardPreparationFailure(result)) break; }
    if (prepared.length !== record.compositionPlan.pages.length || prepared.some(isHardPreparationFailure)) {
      const completion = summarizeEditionComposition(record.compositionPlan.pages, prepared); const result = { ok: false, runId, state: 'BLOCKED', code: prepared.find(isHardPreparationFailure)?.error || 'PREPARATION_BLOCKED', nothingApplied: true, writerTransport: aiMode === 'codex-local' ? 'CODEX_LOCAL' : 'configured-provider', writerCalls: budget.used, pages: prepared.map((item, index) => pageResult(record.compositionPlan.pages[index], item)), completion, journalPath: journal.path };
      record.failed = true; await runRepository.update(runId, { state: 'BLOCKED', writerCallCount: budget.used, completionState: completion.state, failureCode: result.code, finished: true }); journal.finish('BLOCKED', { providerCalls: budget.used, completion: result.code }); return result;
    }
    await runRepository.update(runId, { state: 'PREPARED', writerCallCount: budget.used }); journal.event('EDITION_PREPARED');
    await _beforePersist?.({ loaded, prepared, record });
    const beforePersist = await material(record.editionId);
    if (!beforePersist || beforePersist.baselineFingerprint !== loaded.baselineFingerprint || beforePersist.fingerprint !== loaded.fingerprint || beforePersist.sourceSnapshot.hash !== record.sourceSnapshot.hash) {
      const result = { ok: false, runId, state: 'BLOCKED', code: 'COMPOSITION_BASELINE_STALE', nothingApplied: true, writerCalls: budget.used, pages: prepared.map((item, index) => pageResult(record.compositionPlan.pages[index], item)), journalPath: journal.path }; record.failed = true; await runRepository.update(runId, { state: 'BLOCKED', writerCallCount: budget.used, failureCode: result.code, finished: true }); journal.finish('BLOCKED', { providerCalls: budget.used, completion: result.code }); return result;
    }
    const tx = await pool.connect(); let persisted = [];
    try {
      await runRepository.update(runId, { state: 'PERSISTING', writerCallCount: budget.used }); journal.event('EDITION_PERSIST_STARTED'); await tx.query('BEGIN');
      for (let index = 0; index < prepared.length; index += 1) persisted.push(await _persistPreparedPage({ pagePlan: record.compositionPlan.pages[index], prepared: prepared[index], newspaper: loaded.paper, tx, journal }));
      if (persisted.some((item) => item.state !== 'PERSISTED')) throw Object.assign(new Error(persisted.find((item) => item.state !== 'PERSISTED')?.error || 'POST_SAVE_DRIFT'), { code: persisted.find((item) => item.state !== 'PERSISTED')?.error || 'POST_SAVE_DRIFT' });
      await runRepository.update(runId, { state: 'VERIFYING', writerCallCount: budget.used }); journal.event('EDITION_VERIFY_STARTED');
      await tx.query('COMMIT');
    } catch (error) {
      await tx.query('ROLLBACK').catch(() => {}); const code = error.code || error.message || 'PERSISTENCE_FAILED'; const result = { ok: false, runId, state: 'ROLLED_BACK', code, nothingApplied: true, writerCalls: budget.used, pages: persisted.map((item, index) => pageResult(record.compositionPlan.pages[index], item)), journalPath: journal.path }; record.failed = true; await runRepository.update(runId, { state: 'ROLLED_BACK', writerCallCount: budget.used, failureCode: code, finished: true }); journal.finish('BLOCKED', { providerCalls: budget.used, completion: code }); return result;
    } finally { tx.release(); }
    const completion = summarizeEditionComposition(record.compositionPlan.pages, persisted); const pageResults = persisted.map((item, index) => pageResult(record.compositionPlan.pages[index], item));
    journal.event('EDITION_COMMITTED'); journal.finish('COMPLETE', { providerCalls: budget.used, completion: completion.state }); await runRepository.update(runId, { state: 'COMMITTED', writerCallCount: budget.used, completionState: completion.state, committed: true, finished: true });
    const result = { ok: true, runId, state: completion.state, atomicallyApplied: true, writerTransport: aiMode === 'codex-local' ? 'CODEX_LOCAL' : 'configured-provider', writerCalls: budget.used, sourceSnapshotHash: record.sourceSnapshot.hash, durationMs: Date.now() - started, pages: pageResults, checks: { preflightClean: pageResults.every((page) => page.preflight.baseline !== false && page.preflight.projected !== false && page.preflight.reload !== false), postSaveParity: pageResults.every((page) => page.parity), groundingRejected: pageResults.reduce((sum, page) => sum + page.groundingRejected, 0) }, completion, journalPath: journal.path };
    record.result = result;
    return result;
  } finally { activeRuns.delete(record.editionId); }
}
module.exports = { planEditionComposition, applyEditionComposition, frameFingerprint, _plans: plans, _activeRuns: activeRuns };
