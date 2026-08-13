const { getTemplate } = require('../layout/templates');
const { ladderFor } = require('../layout/ladder');
const { frameDescriptorFromSection } = require('../layout/composition-adapter');
const { rebalanceFlowAwarePageAssignments } = require('../layout/flow-aware-page-balancer');
const { writerInputFromNewsItem, composeSourceToFrame } = require('./exactFitWriter.service');
const { compileEditorialPresentation } = require('./editorialPackage.service');
const { validateGeneratedGrounding } = require('./generatedGrounding.service');
const { analyzeComposedLayout } = require('../layout/composed-layout-quality');
const { validatePageLayout } = require('./preflight.service');
const pageRepository = require('../repositories/page.repository');

const SPECIAL = new Set(['SMART_CARD', 'ADVERTISEMENT', 'QUOTE', 'DATA']);
const roleForRung = (rung) => rung.role || (rung.pageNumber === rung.total ? 'BACK' : 'GENERAL');
function storyPacketFromNewsItem(item = {}) { return { id: item.id, news_item_id: item.id, story_type: item.story_type || 'STANDARD', editorial_priority: item.editorial_priority || 3, headline: item.title || '', subheading: item.subheading || '', body: item.description ?? item.body ?? '', category: item.category || '', location: item.location || '', tags: Array.isArray(item.tags) ? item.tags.join(', ') : item.tags || '', reporter_name: item.reporter_name || '', images: [], imagePlacementNeedsReview: Boolean((item.image_urls || []).length) }; }
function eligibleEditorialFrames(page, continuationSourceIds = new Set()) { const template = getTemplate(page.template_key); const byKey = new Map(template.sections.map((item) => [item.key, item])); return (page.sections || []).flatMap((section) => { const templateSection = byKey.get(section.section_key); const frame = frameDescriptorFromSection(section, templateSection); const type = String(frame.recommendedStoryType || '').toUpperCase(); const id = section.id ?? section.section_id; if (section.is_custom || section.continued_from_section_id || continuationSourceIds.has(id) || frame.feature_key || section.smart_card_key || frame.block_type === 'advert' || SPECIAL.has(type) || (section.images || []).length) return []; return [frame]; }); }
function fallbackRolesForSource(source, availableRoles) {
  const desired = String(source.desired_page_role || '').toUpperCase();
  if (availableRoles.has(desired)) return [desired];
  if (desired === 'OPINION') return ['FEATURES', 'BACK'];
  if (desired === 'GENERAL') return ['BACK', 'FRONT'];
  return [];
}
function routeSourcesToEditionPages({ sources = [], pages = [], ladder = ladderFor(pages.length), capacities = new Map() }) {
  const descriptors = ladder.map((rung) => ({ pageNumber: rung.pageNumber, role: roleForRung({ ...rung, total: ladder.length }), templateKey: rung.templateKey, eligibleFrameCount: capacities.get(rung.pageNumber) ?? Infinity }));
  const pagesByRole = new Map(); for (const descriptor of descriptors) { if (!pagesByRole.has(descriptor.role)) pagesByRole.set(descriptor.role, []); pagesByRole.get(descriptor.role).push(descriptor); }
  const buckets = new Map(pages.map((page) => [page.page_number, []])); const unassigned = [];
  const order = (a, b) => Number(b.editorial_priority) - Number(a.editorial_priority) || String(a.id).localeCompare(String(b.id));
  const direct = [], fallback = [];
  for (const source of [...sources].sort(order)) {
    const roles = fallbackRolesForSource(source, new Set(pagesByRole.keys()));
    if (!roles.length) unassigned.push({ sourceId: source.id, reason: 'NO_SEMANTIC_ROUTE' });
    else (roles[0] === String(source.desired_page_role || '').toUpperCase() ? direct : fallback).push({ source, roles });
  }
  for (const item of [...direct, ...fallback]) {
    const role = item.roles.find((candidate) => (pagesByRole.get(candidate) || []).some((page) => buckets.get(page.pageNumber).length < page.eligibleFrameCount));
    const target = (pagesByRole.get(role) || []).filter((page) => buckets.get(page.pageNumber).length < page.eligibleFrameCount)
      .sort((a, b) => (b.eligibleFrameCount - buckets.get(b.pageNumber).length) - (a.eligibleFrameCount - buckets.get(a.pageNumber).length) || a.pageNumber - b.pageNumber)[0];
    if (!target) unassigned.push({ sourceId: item.source.id, reason: 'UNASSIGNED_SOURCE_CAPACITY' });
    else buckets.get(target.pageNumber).push(item.source);
  }
  return { buckets, unassigned, pagesByRole, descriptors };
}
async function buildEditionCompositionPlan({ pages = [], newspaper = {}, sources = [], rebalance = rebalanceFlowAwarePageAssignments }) {
  const ladder = ladderFor(pages.length);
  const continuationSourceIds = new Set(pages.flatMap((page) => (page.sections || []).map((section) => section.continued_from_section_id).filter(Boolean)));
  const framesByPage = new Map(pages.map((page) => [page.page_number, eligibleEditorialFrames(page, continuationSourceIds)]));
  const capacities = new Map([...framesByPage].map(([number, frames]) => [number, frames.length]));
  const routed = routeSourcesToEditionPages({ sources, pages, ladder, capacities }); const plans = [];
  for (const page of [...pages].sort((a, b) => a.page_number - b.page_number)) {
    const frames = framesByPage.get(page.page_number) || []; const stories = (routed.buckets.get(page.page_number) || []).map(storyPacketFromNewsItem);
    const balance = stories.length && frames.length ? await rebalance(stories, frames, { page, newspaper }) : { finalPlan: { assignments: [], unassignedStories: stories.map((story) => ({ storyId: story.id })) } };
    plans.push({ page, role: roleForRung({ ...(ladder.find((rung) => rung.pageNumber === page.page_number) || {}), total: pages.length }), frames, stories, assignments: balance.finalPlan.assignments || [], balance });
  }
  const assigned = plans.flatMap((plan) => plan.assignments.map((assignment) => ({ ...assignment, pageNumber: plan.page.page_number }))); const ids = assigned.map((item) => String(item.storyId)); const frames = assigned.map((item) => `${item.pageNumber}:${item.frameId}`);
  if (new Set(ids).size !== ids.length || new Set(frames).size !== frames.length) throw new Error('Invalid edition composition plan: duplicate story or frame');
  return { pages: plans, routed: routed.unassigned, assigned, sourceCount: sources.length, routedCount: [...routed.buckets.values()].reduce((sum, list) => sum + list.length, 0), continuationSourceIds };
}

function projectComposedStoryIntoSection(section, candidate) {
  const compiled = candidate.compiled;
  const source = candidate.source || {};
  return { ...section,
    news_item_id: null, story_type: candidate.result.editorial.storyType, editorial_priority: candidate.result.editorial.editorialPriority,
    kicker: compiled.kicker || null, headline: compiled.headline || null, subheading: compiled.subheading || null,
    body: compiled.body || null, caption: compiled.caption || null, category: source.category || null,
    location: source.location || null, tags: source.tags || null, reporter_name: source.reporterName || null,
    ai_notes: null, language: 'Marathi', status: 'needs_review', ai_generated: true,
    editorial_presentation: compiled.presentation,
  };
}
function persistenceStory(candidate) {
  const compiled = candidate.compiled; const source = candidate.source || {};
  return { newsItemId: null, storyType: candidate.result.editorial.storyType, editorialPriority: candidate.result.editorial.editorialPriority,
    ...compiled, category: source.category, location: source.location, tags: source.tags, reporterName: source.reporterName,
    language: 'Marathi', status: 'needs_review', aiGenerated: true, editorialPresentation: compiled.presentation };
}
function errorKeys(report) { return new Set([...(report?.collisions || []), ...(report?.overflow || [])].filter((finding) => finding.level === 'error').map((finding) => `${finding.type || finding.check}:${finding.sectionKey}`)); }

async function composePagePlan({ pagePlan, sourcesById, newspaper, askForJson, maxServiceCalls = 32, callBudget = null, apply = false, compose = composeSourceToFrame, journal = null }) {
  const budget = callBudget || { max: maxServiceCalls, used: 0 }; const frameById = new Map(pagePlan.frames.map((frame) => [String(frame.id), frame])); const candidates = [];
  const before = await analyzeComposedLayout(pagePlan.page, newspaper);
  const baselinePreflight = await validatePageLayout(pagePlan.page, newspaper);
  const outcomes = [];
  journal?.event('PAGE_STARTED', { page: pagePlan.page.page_number });
  if (!baselinePreflight.valid) { journal?.event('PREFLIGHT_FAIL', { page: pagePlan.page.page_number, stage: 'baseline' }); return { state: 'PAGE_BLOCKED', error: 'BASELINE_PREFLIGHT_INVALID', candidates, outcomes, before, baselinePreflight, serviceCalls: budget.used }; }
  for (const assignment of pagePlan.assignments) {
    const source = sourcesById.get(String(assignment.storyId)); const frame = frameById.get(String(assignment.frameId));
    const outcome = { sourceId: assignment.storyId, frame: frame?.section_key, state: 'PLANNED', editorialAttempts: 0 }; outcomes.push(outcome);
    journal?.event('STORY_STARTED', { page: pagePlan.page.page_number, sourceId: assignment.storyId, frame: frame?.section_key });
    if (!source || !frame) return { state: 'PAGE_BLOCKED', error: 'INVALID_ASSIGNMENT', candidates, outcomes, before };
    const budgetedAsk = async (prompt, schema, options = {}) => { journal?.event('AI_ATTEMPT_STARTED', { page: pagePlan.page.page_number, sourceId: source.id, frame: frame.section_key }); const result = await askForJson(prompt, schema, { ...options, callBudget: budget }); if (result.error) journal?.event('AI_FAILED', { page: pagePlan.page.page_number, sourceId: source.id, frame: frame.section_key, error: result.error }); else journal?.event('AI_RETURNED', { page: pagePlan.page.page_number, sourceId: source.id, frame: frame.section_key, provider: result.provider }); return result; };
    const input = await writerInputFromNewsItem(source); const result = await compose({ ...input, frame, language: 'Marathi', askForJson: budgetedAsk });
    outcome.editorialAttempts = result.attempts || 0;
    if (result.error) { outcome.state = result.error === 'SERVICE_CALL_BUDGET_EXHAUSTED' ? 'SERVICE_CALL_BUDGET_EXHAUSTED' : 'PROVIDER_ERROR'; return { state: result.error === 'SERVICE_CALL_BUDGET_EXHAUSTED' ? 'BUDGET_BLOCKED' : 'PROVIDER_BLOCKED', error: result.error, candidates, outcomes, before, baselinePreflight, serviceCalls: budget.used }; }
    if (!result.assessment?.accepted) { outcome.state = 'FIT_REJECTED'; return { state: 'PAGE_BLOCKED', error: 'FIT_REJECTED', candidates, outcomes, before, baselinePreflight, serviceCalls: budget.used }; }
    const grounding = validateGeneratedGrounding(result.proposal, input.source);
    if (!grounding.valid) { outcome.state = 'GROUNDING_REJECTED'; journal?.event('GROUNDING_FAIL', { page: pagePlan.page.page_number, sourceId: source.id }); return { state: 'PAGE_BLOCKED', error: grounding.issues[0].code, candidates, outcomes, before, baselinePreflight, serviceCalls: budget.used }; }
    journal?.event('GROUNDING_PASS', { page: pagePlan.page.page_number, sourceId: source.id });
    outcome.sufficiency = result.sourceSufficiency.status;
    if (result.sourceSufficiency.status === 'INSUFFICIENT_FOR_TREATMENT') { outcome.state = 'SOURCE_INSUFFICIENT'; journal?.event('SOURCE_SUFFICIENCY', { page: pagePlan.page.page_number, sourceId: source.id, status: outcome.state }); continue; }
    const compiled = compileEditorialPresentation(result.proposal, result.editorial.storyType, { source: input.source });
    candidates.push({ sourceId: source.id, frame, result, grounding, compiled, source: input.source });
    outcome.state = 'READY_TO_PERSIST'; outcome.fit = { writable: result.fit.writableBodyCharBudget, authored: result.fit.authoredBodyCharsUsed ?? result.fit.bodyCharsUsed, physical: result.fit.bodyCharBudget, total: result.fit.totalBodyCharsUsed ?? result.fit.bodyCharsUsed }; journal?.event('FIT_PASS', { page: pagePlan.page.page_number, sourceId: source.id, frame: frame.section_key });
  }
  const projected = { ...pagePlan.page, sections: pagePlan.page.sections.map((section) => { const candidate = candidates.find((item) => item.frame.section_key === section.section_key); return candidate ? projectComposedStoryIntoSection(section, candidate) : section; }) };
  const preflight = await validatePageLayout(projected, newspaper); const projectedQuality = await analyzeComposedLayout(projected, newspaper);
  const baselineErrors = errorKeys(baselinePreflight);
  const introducedErrors = [...errorKeys(preflight)].filter((key) => !baselineErrors.has(key));
  if (introducedErrors.length || projectedQuality.score < before.score - 5) return { state: 'PAGE_BLOCKED', error: introducedErrors.length ? 'PREFLIGHT_BLOCKED' : 'QUALITY_REGRESSION', candidates, outcomes, before, baselinePreflight, projectedQuality, preflight, introducedErrors, serviceCalls: budget.used };
  journal?.event('PAGE_PROJECTED', { page: pagePlan.page.page_number, candidates: candidates.length });
  if (apply && candidates.length) { journal?.event('PAGE_BATCH_STARTED', { page: pagePlan.page.page_number, candidates: candidates.length }); await pageRepository.saveComposedStoryBatch(pagePlan.page.id, candidates.map((candidate) => ({ sectionKey: candidate.frame.section_key, story: persistenceStory(candidate) }))); outcomes.filter((item) => item.state === 'READY_TO_PERSIST').forEach((item) => { item.state = 'PERSISTED'; }); journal?.event('PAGE_COMMITTED', { page: pagePlan.page.page_number }); }
  const reloaded = apply ? await pageRepository.findById(pagePlan.page.id) : null;
  const reloadedPreflight = reloaded ? await validatePageLayout(reloaded, newspaper) : null;
  const reloadedQuality = reloaded ? await analyzeComposedLayout(reloaded, newspaper) : null;
  if (reloaded && (JSON.stringify([...errorKeys(preflight)].sort()) !== JSON.stringify([...errorKeys(reloadedPreflight)].sort()))) return { state: 'PAGE_BLOCKED', error: 'POST_SAVE_DRIFT', candidates, outcomes, before, baselinePreflight, projectedQuality, preflight, reloaded, reloadedPreflight, reloadedQuality, serviceCalls: budget.used };
  if (reloaded) journal?.event('POST_SAVE_PARITY_PASS', { page: pagePlan.page.page_number });
  const state = apply ? (candidates.length ? 'PERSISTED' : 'UNCHANGED_SOURCE_INSUFFICIENT') : 'READY_TO_PERSIST';
  if (state === 'UNCHANGED_SOURCE_INSUFFICIENT') journal?.event('PAGE_UNCHANGED', { page: pagePlan.page.page_number });
  return { state, candidates, outcomes, before, baselinePreflight, projectedQuality, preflight, reloaded, reloadedPreflight, reloadedQuality, serviceCalls: budget.used };
}
module.exports = { storyPacketFromNewsItem, eligibleEditorialFrames, fallbackRolesForSource, routeSourcesToEditionPages, buildEditionCompositionPlan, projectComposedStoryIntoSection, persistenceStory, composePagePlan, roleForRung };
