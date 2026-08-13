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
const { normalizeNewsroomSources } = require('./newsroomSource.service');
const { buildImageIntents } = require('../layout/newsroom-image-composition');
const sectionImages = require('../repositories/sectionImage.repository');
const { PURPOSE, REQUIREMENT, resolveFramePurpose } = require('../layout/frame-purpose');

const roleForRung = (rung) => rung.role || (rung.pageNumber === rung.total ? 'BACK' : 'GENERAL');
function storyPacketFromNewsItem(item = {}) { return { id: item.id, news_item_id: item.news_item_id ?? item.newsItemId ?? null, story_type: item.story_type || 'STANDARD', editorial_priority: item.editorial_priority || 3, headline: item.title || '', subheading: item.subheading || '', body: item.description ?? item.body ?? '', category: item.category || '', location: item.location || '', tags: Array.isArray(item.tags) ? item.tags.join(', ') : item.tags || '', reporter_name: item.reporter_name || '', desired_page_role: item.desired_page_role || null, routed_role: item.routed_role || null, routing_mode: item.routing_mode || null, images: item.images || [], image_urls: item.image_urls || [], imagePlacementNeedsReview: Boolean((item.images || item.image_urls || []).length) }; }
function eligibleEditorialFrames(page, continuationSourceIds = new Set()) { const template = getTemplate(page.template_key); const byKey = new Map(template.sections.map((item) => [item.key, item])); return (page.sections || []).flatMap((section) => { const templateSection = byKey.get(section.section_key); const frame = frameDescriptorFromSection(section, templateSection); const id = section.id ?? section.section_id; const ownership = resolveFramePurpose(section, templateSection); if (section.is_custom || section.continued_from_section_id || continuationSourceIds.has(id) || ownership.purpose !== PURPOSE.EDITORIAL_STORY || ownership.publicationRequirement !== REQUIREMENT.REQUIRED_CONTENT) return []; return [{ ...frame, framePurpose: ownership.purpose, publicationRequirement: ownership.publicationRequirement }]; }); }
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
    // Routing only creates semantic candidate pools. Frame competition belongs
    // to B6; never pre-eliminate a useful source because a page is "full".
    const role = item.roles.find((candidate) => (pagesByRole.get(candidate) || []).some((page) => page.eligibleFrameCount > 0));
    const target = (pagesByRole.get(role) || []).filter((page) => page.eligibleFrameCount > 0)
      .sort((a, b) => (buckets.get(a.pageNumber).length / Math.max(1, a.eligibleFrameCount)) - (buckets.get(b.pageNumber).length / Math.max(1, b.eligibleFrameCount)) || a.pageNumber - b.pageNumber)[0];
    if (!target) unassigned.push({ sourceId: item.source.id, reason: 'NO_WRITABLE_ROLE_PAGE' });
    else buckets.get(target.pageNumber).push({ ...item.source, routing_mode: item.roles[0] === String(item.source.desired_page_role || '').toUpperCase() ? 'DIRECT' : 'FALLBACK', routed_role: role });
  }
  return { buckets, unassigned, pagesByRole, descriptors };
}
async function buildEditionCompositionPlan({ pages = [], newspaper = {}, sources = [], rebalance = rebalanceFlowAwarePageAssignments }) {
  const canonicalSources = normalizeNewsroomSources(sources);
  const ladder = ladderFor(pages.length);
  const continuationSourceIds = new Set(pages.flatMap((page) => (page.sections || []).map((section) => section.continued_from_section_id).filter(Boolean)));
  const framesByPage = new Map(pages.map((page) => [page.page_number, eligibleEditorialFrames(page, continuationSourceIds)]));
  const capacities = new Map([...framesByPage].map(([number, frames]) => [number, frames.length]));
  const routed = routeSourcesToEditionPages({ sources: canonicalSources, pages, ladder, capacities }); const plans = [];
  for (const page of [...pages].sort((a, b) => a.page_number - b.page_number)) {
    const frames = framesByPage.get(page.page_number) || []; const stories = (routed.buckets.get(page.page_number) || []).map(storyPacketFromNewsItem);
    const balance = stories.length && frames.length ? await rebalance(stories, frames, { page, newspaper, externalComposition: true }) : { finalPlan: { assignments: [], unassignedStories: stories.map((story) => ({ storyId: story.id })) } };
    plans.push({ page, role: roleForRung({ ...(ladder.find((rung) => rung.pageNumber === page.page_number) || {}), total: pages.length }), frames, stories, assignments: balance.finalPlan.assignments || [], balance });
  }
  const assigned = plans.flatMap((plan) => plan.assignments.map((assignment) => ({ ...assignment, pageNumber: plan.page.page_number }))); const ids = assigned.map((item) => String(item.storyId)); const frames = assigned.map((item) => `${item.pageNumber}:${item.frameId}`);
  if (new Set(ids).size !== ids.length || new Set(frames).size !== frames.length) throw new Error('Invalid edition composition plan: duplicate story or frame');
  const usedImages = new Set(); for (const plan of plans) plan.imageIntents = buildImageIntents(plan, usedImages);
  return { pages: plans, routed: routed.unassigned, assigned, sourceCount: canonicalSources.length, routedCount: [...routed.buckets.values()].reduce((sum, list) => sum + list.length, 0), continuationSourceIds };
}

// Truthful edition-level accounting.  A safe page batch can persist while the
// inbox simply has fewer compatible sources than writable frames; that is a
// declared shortage, not a false claim that every frame was composed.
function summarizeEditionComposition(plans = [], results = []) {
  const ledger = plans.flatMap((plan, index) => {
    const result = results[index] || {}; const outcomes = new Map((result.outcomes || []).map((item) => [item.frame, item]));
    const assignmentByFrame = new Map((plan.assignments || []).map((item) => [String(item.frameId), item]));
    return plan.frames.map((frame) => {
      const key = String(frame.section_key); const outcome = outcomes.get(key); const assignment = assignmentByFrame.get(String(frame.id));
      let state = 'SOURCE_SHORTAGE';
      if (outcome?.state === 'PERSISTED') state = 'GENERATED_PERSISTED';
      else if (outcome?.state === 'SOURCE_INSUFFICIENT' || outcome?.state === 'FIT_REJECTED') state = 'SOURCE_SHORTAGE';
      else if (outcome?.state === 'QUALITY_REJECTED') state = 'QUALITY_REJECTED';
      else if (outcome?.state === 'PREFLIGHT_REJECTED') state = 'PREFLIGHT_REJECTED';
      else if (outcome && !['PLANNED', 'READY_TO_PERSIST'].includes(outcome.state)) state = 'PROVIDER_FAILURE';
      else if (assignment) state = 'SEMANTICALLY_UNMATCHED';
      const area = Math.max(0, Number(frame.width_px) || 0) * Math.max(0, Number(frame.height_px) || 0);
      return { page: plan.page.page_number, frame: key, recommendedStoryType: frame.recommendedStoryType, semanticRole: plan.role,
        editorialPriority: frame.editorialPriority, usableArea: area, state, sourceId: assignment?.storyId || null };
    });
  });
  const pages = plans.map((plan, index) => {
    const result = results[index] || {}; const rows = ledger.filter((item) => item.page === plan.page.page_number); const outcomes = result.outcomes || [];
    const persistedCandidates = rows.filter((item) => item.state === 'GENERATED_PERSISTED').length;
    const totalArea = rows.reduce((sum, item) => sum + item.usableArea, 0); const persistedArea = rows.filter((item) => item.state === 'GENERATED_PERSISTED').reduce((sum, item) => sum + item.usableArea, 0);
    const failures = rows.filter((item) => ['PROVIDER_FAILURE', 'QUALITY_REJECTED', 'PREFLIGHT_REJECTED'].includes(item.state)).length;
    return { page: plan.page.page_number, eligibleEditorialFrames: rows.length, candidateSources: plan.stories.length, assignedSources: plan.assignments.length,
      generatedCandidates: result.generatedCandidates?.length ?? result.candidates?.length ?? 0, persistedCandidates,
      retainedOriginalFrames: rows.length - persistedCandidates, sourceInsufficient: rows.filter((item) => item.state === 'SOURCE_SHORTAGE').length,
      providerOrCandidateFailures: failures, editorialCoverageRatio: rows.length ? Number((persistedCandidates / rows.length).toFixed(4)) : 1,
      weightedEditorialCoverageRatio: totalArea ? Number((persistedArea / totalArea).toFixed(4)) : 1,
      unresolvedDemand: rows.filter((item) => item.state !== 'GENERATED_PERSISTED').length,
      blocked: ['PAGE_BLOCKED', 'BUDGET_BLOCKED', 'PROVIDER_BLOCKED'].includes(result.state) || Boolean(result.error) };
  });
  const imageLedger = plans.flatMap((plan, index) => { const result = results[index] || {}; const states = new Map((result.imageIntents || []).map((item) => [`${item.storyId}:${item.destinationSectionKey}`, item.state])); return (plan.imageIntents || []).map((intent) => ({ page: plan.page.page_number, storyId: intent.storyId, destinationSection: intent.destinationSectionKey, requirement: intent.requirement, sourceAsset: intent.image?.assetId || intent.image?.url || null, treatment: intent.placement?.treatment || null, cropMode: intent.placement?.cropMode || null, state: states.get(`${intent.storyId}:${intent.destinationSectionKey}`) || intent.state })); });
  const requiredImages = imageLedger.filter((item) => item.requirement === 'IMAGE_REQUIRED'); const resolvedImages = requiredImages.filter((item) => ['IMAGE_GENERATED_PLACEMENT', 'IMAGE_EXISTING_PRESERVED'].includes(item.state));
  const blocked = pages.some((page) => page.blocked);
  const unresolved = ledger.some((item) => item.state !== 'GENERATED_PERSISTED');
  const editorialCompositionState = blocked ? 'BLOCKED' : unresolved || resolvedImages.length !== requiredImages.length ? 'PARTIALLY_COMPOSED' : 'FULLY_COMPOSED';
  return { pages, ledger, images: imageLedger, imageCoverageRatio: requiredImages.length ? Number((resolvedImages.length / requiredImages.length).toFixed(4)) : 1, unresolvedImageDemand: requiredImages.length - resolvedImages.length,
    editorialCompositionState, state: editorialCompositionState };
}

function composedStoryFromCandidate(candidate) {
  const compiled = candidate.compiled; const source = candidate.source || {};
  return { newsItemId: source.news_item_id ?? null, storyType: candidate.result.editorial.storyType, editorialPriority: candidate.result.editorial.editorialPriority,
    kicker: compiled.kicker || null, headline: compiled.headline || null, subheading: compiled.subheading || null, body: compiled.body || null, caption: compiled.caption || null,
    category: source.category || null, location: source.location || null, tags: source.tags || null, reporterName: source.reporterName || null,
    aiNotes: null, language: 'Marathi', status: 'needs_review', aiGenerated: true, editorialPresentation: compiled.presentation || null };
}
function projectComposedStoryIntoSection(section, candidate) {
  const story = composedStoryFromCandidate(candidate);
  return { ...section,
    news_item_id: story.newsItemId, story_type: story.storyType, editorial_priority: story.editorialPriority,
    kicker: story.kicker, headline: story.headline, subheading: story.subheading, body: story.body, caption: story.caption, category: story.category,
    location: story.location, tags: story.tags, reporter_name: story.reporterName, ai_notes: story.aiNotes, language: story.language, status: story.status, ai_generated: story.aiGenerated, editorial_presentation: story.editorialPresentation,
    images: candidate.imageIntent?.placement ? [projectedImage(candidate.imageIntent)] : (section.images || []),
  };
}
const persistenceStory = composedStoryFromCandidate;
async function finalizeCandidateImage(frame, intent, compiled, source) {
  if (!intent?.placement || !intent.image) return { intent, safe: true };
  const flow = await import('../../public/editor/layout/text-flow.js');
  const section = { ...frame, width_px: frame.width_px, height_px: frame.height_px };
  const view = flow.flowViewFromSection(section, { ...compiled, location: source.location, reporterName: source.reporterName });
  const structural = flow.buildFlowMap(section, view, []);
  const padding = Number(view.marginPx) || 12;
  const protectedBottom = padding + (structural.kickerRows + structural.headlineRows + structural.subheadingRows) * structural.cellHeight;
  const safeTop = Math.ceil(protectedBottom + (Number(intent.placement.standOffPx) || 0));
  const availableWidth = Math.max(0, Number(frame.width_px) - padding * 2);
  const availableHeight = Math.max(0, Number(frame.height_px) - padding - safeTop);
  const aspect = Math.max(0.05, Number(intent.placement.width) / Math.max(1, Number(intent.placement.height)));
  let width = Math.min(Number(intent.placement.width), availableWidth);
  let height = width / aspect;
  if (height > availableHeight) { height = availableHeight; width = height * aspect; }
  const placement = { ...intent.placement, x: Math.round(padding + Math.max(0, (availableWidth - width) / 2)), y: safeTop, width: Math.round(width), height: Math.round(height) };
  const row = { ...placement, x_px: placement.x, y_px: placement.y, width_px: placement.width, height_px: placement.height, caption: placement.caption || intent.image.caption || '' };
  const caption = flow.captionBox(row);
  const inside = placement.width >= 20 && placement.height >= 20 && placement.x >= 0 && placement.y >= protectedBottom && placement.x + placement.width <= Number(frame.width_px) && (caption ? caption.y + caption.height : placement.y + placement.height) <= Number(frame.height_px);
  if (!inside) {
    if (intent.requirement === 'IMAGE_REQUIRED') return { intent: { ...intent, state: 'IMAGE_NO_SAFE_PLACEMENT', placement: null }, safe: false, required: true };
    return { intent: { ...intent, state: 'IMAGE_SKIPPED_NO_SAFE_PLACEMENT', placement: null }, safe: true, skipped: true };
  }
  const finalIntent = { ...intent, placement, state: 'IMAGE_PLANNED' };
  const measurement = flow.measureSectionFlow(section, { ...compiled, location: source.location, reporterName: source.reporterName }, [flow.flowImageFromRow(row)]);
  if (measurement.overflowing) {
    if (intent.requirement === 'IMAGE_REQUIRED') return { intent: { ...finalIntent, state: 'IMAGE_NO_SAFE_PLACEMENT', placement: null }, safe: false, required: true };
    return { intent: { ...finalIntent, state: 'IMAGE_SKIPPED_NO_SAFE_PLACEMENT', placement: null }, safe: true, skipped: true };
  }
  return { intent: finalIntent, safe: true, measurement };
}
function errorKeys(report) { return new Set([...(report?.collisions || []), ...(report?.overflow || [])].filter((finding) => finding.level === 'error').map((finding) => `${finding.type || finding.check}:${finding.sectionKey}`)); }
const parityFields = ['news_item_id', 'story_type', 'editorial_priority', 'kicker', 'headline', 'subheading', 'body', 'caption', 'category', 'location', 'tags', 'reporter_name', 'ai_notes', 'language', 'status', 'ai_generated', 'editorial_presentation'];
const same = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
function projectedImage(intent) {
  const placement = intent.placement;
  return { ...placement, url: intent.image.url,
    x_px: placement.x, y_px: placement.y, width_px: placement.width, height_px: placement.height,
    stand_off_px: placement.standOffPx, crop_mode: placement.cropMode,
    source_news_item_id: intent.sourceNewsItemId || null };
}
async function parityDifferences(projected, reloaded, active) { const { measureSectionFlow } = await import('../../public/editor/layout/text-flow.js'); const flowFields = ['bodyCharBudget', 'fixedBodyPrefixChars', 'writableBodyCharBudget', 'authoredBodyCharsUsed', 'totalBodyCharsUsed']; return active.flatMap((candidate) => { const left = projected.sections.find((section) => section.section_key === candidate.frame.section_key); const right = reloaded.sections.find((section) => section.section_key === candidate.frame.section_key); const fields = parityFields.filter((field) => !same(left?.[field], right?.[field])); const leftFlow = measureSectionFlow(left || {}), rightFlow = measureSectionFlow(right || {}); const metrics = flowFields.filter((field) => leftFlow[field] !== rightFlow[field]); return fields.length || metrics.length ? [{ sectionKey: candidate.frame.section_key, fields, metrics }] : []; }); }

async function composePagePlan({ pagePlan, sourcesById, newspaper, askForJson, maxServiceCalls = 32, callBudget = null, apply = false, compose = composeSourceToFrame, journal = null }) {
  const budget = callBudget || { max: maxServiceCalls, used: 0 }; const frameById = new Map(pagePlan.frames.map((frame) => [String(frame.id), frame])); const candidates = [];
  const before = await analyzeComposedLayout(pagePlan.page, newspaper);
  const baselinePreflight = await validatePageLayout(pagePlan.page, newspaper);
  const outcomes = [];
  journal?.event('PAGE_STARTED', { page: pagePlan.page.page_number });
  if (!baselinePreflight.valid) { journal?.event('PREFLIGHT_FAIL', { page: pagePlan.page.page_number, stage: 'baseline' }); return { state: 'PAGE_BLOCKED', error: 'BASELINE_PREFLIGHT_INVALID', candidates, outcomes, before, baselinePreflight, serviceCalls: budget.used }; }
  for (const assignment of pagePlan.assignments) {
    const source = sourcesById.get(String(assignment.storyId)); const frame = frameById.get(String(assignment.frameId));
    const outcome = { sourceId: assignment.storyId, frame: frame?.section_key, routingMode: source?.routing_mode || null, state: 'PLANNED', editorialAttempts: 0, providerCalls: 0 }; outcomes.push(outcome);
    journal?.event('STORY_STARTED', { page: pagePlan.page.page_number, sourceId: assignment.storyId, frame: frame?.section_key });
    if (!source || !frame) return { state: 'PAGE_BLOCKED', error: 'INVALID_ASSIGNMENT', candidates, outcomes, before };
    const providerCallsBefore = budget.used; const budgetedAsk = async (prompt, schema, options = {}) => { journal?.event('AI_ATTEMPT_STARTED', { page: pagePlan.page.page_number, sourceId: source.id, frame: frame.section_key }); const result = await askForJson(prompt, schema, { ...options, callBudget: budget }); if (result.error) journal?.event('AI_FAILED', { page: pagePlan.page.page_number, sourceId: source.id, frame: frame.section_key, error: result.error }); else journal?.event('AI_RETURNED', { page: pagePlan.page.page_number, sourceId: source.id, frame: frame.section_key, provider: result.provider }); return result; };
    const input = await writerInputFromNewsItem(source); const imageIntent = (pagePlan.imageIntents || []).find((item) => !item.companion && String(item.storyId) === String(assignment.storyId) && String(item.frameId) === String(assignment.frameId));
    if (imageIntent?.state === 'IMAGE_PLANNED' && imageIntent.placement) input.images = [{ ...imageIntent.placement, x_px: imageIntent.placement.x, y_px: imageIntent.placement.y, width_px: imageIntent.placement.width, height_px: imageIntent.placement.height, url: imageIntent.image.url, source_width_px: imageIntent.image.width, source_height_px: imageIntent.image.height }]; else input.images = [];
    const result = await compose({ ...input, frame, language: 'Marathi', askForJson: budgetedAsk });
    outcome.editorialAttempts = result.attempts || 0; outcome.providerCalls = budget.used - providerCallsBefore; outcome.provider = result.provider || null; outcome.fellBackTo = result.fellBackTo || null; outcome.attemptDiagnostics = result.attemptDiagnostics || [];
    if (result.error) { if (result.providerFailure?.outputExhausted && !result.providerFailure?.callBudgetExhausted) { outcome.state = 'PROVIDER_OUTPUT_EXHAUSTED'; outcome.providerFailure = result.providerFailure; journal?.event('PROVIDER_OUTPUT_EXHAUSTED', { page: pagePlan.page.page_number, sourceId: source.id, frame: frame.section_key, providerCalls: outcome.providerCalls, editorialAttempts: outcome.editorialAttempts, conditions: result.providerFailure.conditions }); continue; } outcome.state = result.error === 'SERVICE_CALL_BUDGET_EXHAUSTED' ? 'SERVICE_CALL_BUDGET_EXHAUSTED' : 'PROVIDER_ERROR'; return { state: result.error === 'SERVICE_CALL_BUDGET_EXHAUSTED' ? 'BUDGET_BLOCKED' : 'PROVIDER_BLOCKED', error: result.error, candidates, outcomes, before, baselinePreflight, serviceCalls: budget.used }; }
    if (!result.assessment?.accepted) { outcome.state = 'FIT_REJECTED'; journal?.event('FIT_REJECTED', { page: pagePlan.page.page_number, sourceId: source.id, frame: frame.section_key, selectedAttempt: result.selectedAttempt, attempts: result.attempts, diagnostics: result.attemptDiagnostics || [] }); return { state: 'PAGE_BLOCKED', error: 'FIT_REJECTED', candidates, outcomes, before, baselinePreflight, serviceCalls: budget.used }; }
    const grounding = validateGeneratedGrounding(result.proposal, input.source);
    if (!grounding.valid) { outcome.state = 'GROUNDING_REJECTED'; journal?.event('GROUNDING_FAIL', { page: pagePlan.page.page_number, sourceId: source.id }); return { state: 'PAGE_BLOCKED', error: grounding.issues[0].code, candidates, outcomes, before, baselinePreflight, serviceCalls: budget.used }; }
    journal?.event('GROUNDING_PASS', { page: pagePlan.page.page_number, sourceId: source.id });
    outcome.sufficiency = result.sourceSufficiency.status; outcome.sourceScaleStatus = assignment.fit?.sourceScaleStatus || null; outcome.rawSourceChars = assignment.fit?.rawSourceChars ?? null;
    journal?.event('SOURCE_SUFFICIENCY', { page: pagePlan.page.page_number, sourceId: source.id, status: outcome.sufficiency, authoredChars: result.fit.authoredBodyCharsUsed ?? result.fit.bodyCharsUsed, writableCapacity: result.fit.writableBodyCharBudget });
    if (result.sourceSufficiency.status === 'INSUFFICIENT_FOR_TREATMENT') { outcome.state = 'SOURCE_INSUFFICIENT'; continue; }
    const compiled = compileEditorialPresentation(result.proposal, result.editorial.storyType, { source: input.source });
    const finalizedImage = await finalizeCandidateImage(frame, imageIntent, compiled, input.source);
    if (imageIntent) Object.assign(imageIntent, finalizedImage.intent);
    if (!finalizedImage.safe) { outcome.state = 'IMAGE_NO_SAFE_PLACEMENT'; return { state: 'PAGE_BLOCKED', error: 'IMAGE_NO_SAFE_PLACEMENT', candidates, outcomes, before, baselinePreflight, serviceCalls: budget.used }; }
    candidates.push({ sourceId: source.id, frame, result, grounding, compiled, source: input.source, imageIntent: finalizedImage.intent });
    outcome.state = 'READY_TO_PERSIST'; outcome.fit = { writable: result.fit.writableBodyCharBudget, authored: result.fit.authoredBodyCharsUsed ?? result.fit.bodyCharsUsed, physical: result.fit.bodyCharBudget, total: result.fit.totalBodyCharsUsed ?? result.fit.bodyCharsUsed }; journal?.event('FIT_PASS', { page: pagePlan.page.page_number, sourceId: source.id, frame: frame.section_key, selectedAttempt: result.selectedAttempt, attempts: result.attempts, diagnostics: result.attemptDiagnostics || [] });
  }
  const projectionFor = (active) => ({ ...pagePlan.page, sections: pagePlan.page.sections.map((section) => { const candidate = active.find((item) => item.frame.section_key === section.section_key); if (candidate) return projectComposedStoryIntoSection(section, candidate); const intent = (pagePlan.imageIntents || []).find((item) => item.companion && item.destinationSectionId === section.id && item.state === 'IMAGE_PLANNED'); return intent ? { ...section, images: [projectedImage(intent)] } : section; }) });
  let active = [...candidates], projected = projectionFor(active), preflight = await validatePageLayout(projected, newspaper), projectedQuality = await analyzeComposedLayout(projected, newspaper);
  const baselineErrors = errorKeys(baselinePreflight);
  const introducedErrors = [...errorKeys(preflight)].filter((key) => !baselineErrors.has(key));
  while (active.length && (introducedErrors.length || projectedQuality.score < before.score - 5)) {
    const trials = await Promise.all(active.map(async (candidate) => { const next = active.filter((item) => item !== candidate); const page = projectionFor(next); const nextPreflight = await validatePageLayout(page, newspaper); const errors = [...errorKeys(nextPreflight)].filter((key) => !baselineErrors.has(key)); const quality = await analyzeComposedLayout(page, newspaper); return { candidate, next, page, nextPreflight, errors, quality }; }));
    trials.sort((a, b) => a.errors.length - b.errors.length || b.quality.score - a.quality.score || Number(a.candidate.result.editorial.editorialPriority) - Number(b.candidate.result.editorial.editorialPriority) || String(a.candidate.sourceId).localeCompare(String(b.candidate.sourceId)) || String(a.candidate.frame.section_key).localeCompare(String(b.candidate.frame.section_key)));
    const best = trials[0]; if (!best || (best.errors.length >= introducedErrors.length && best.quality.score <= projectedQuality.score)) break;
    const rejected = outcomes.find((item) => String(item.sourceId) === String(best.candidate.sourceId) && item.frame === best.candidate.frame.section_key); if (rejected) rejected.state = introducedErrors.length ? 'PREFLIGHT_REJECTED' : 'QUALITY_REJECTED';
    active = best.next; projected = best.page; preflight = best.nextPreflight; projectedQuality = best.quality; introducedErrors.splice(0, introducedErrors.length, ...best.errors);
  }
  if (introducedErrors.length || projectedQuality.score < before.score - 5) return { state: active.length ? 'PAGE_BLOCKED' : 'UNCHANGED_CANDIDATE_GUARD', error: introducedErrors.length ? 'PREFLIGHT_BLOCKED' : 'QUALITY_REGRESSION', candidates: active, outcomes, before, baselinePreflight, projectedQuality, preflight, introducedErrors, serviceCalls: budget.used };
  journal?.event('PAGE_PROJECTED', { page: pagePlan.page.page_number, candidates: candidates.length });
  if (apply && active.length) { journal?.event('PAGE_BATCH_STARTED', { page: pagePlan.page.page_number, candidates: active.length }); await pageRepository.saveComposedStoryBatch(pagePlan.page.id, active.map((candidate) => ({ sectionKey: candidate.frame.section_key, story: persistenceStory(candidate) }))); outcomes.filter((item) => item.state === 'READY_TO_PERSIST').forEach((item) => { item.state = 'PERSISTED'; }); journal?.event('PAGE_COMMITTED', { page: pagePlan.page.page_number }); }
  const reloaded = apply ? await pageRepository.findById(pagePlan.page.id) : null;
  const reloadedPreflight = reloaded ? await validatePageLayout(reloaded, newspaper) : null;
  const reloadedQuality = reloaded ? await analyzeComposedLayout(reloaded, newspaper) : null;
  const drift = reloaded ? await parityDifferences(projected, reloaded, active) : [];
  if (reloaded && (JSON.stringify([...errorKeys(preflight)].sort()) !== JSON.stringify([...errorKeys(reloadedPreflight)].sort()) || drift.length || Math.abs(projectedQuality.score - reloadedQuality.score) > 0.0001)) { journal?.event('POST_SAVE_DRIFT', { page: pagePlan.page.page_number, differences: drift }); return { state: 'PAGE_BLOCKED', error: 'POST_SAVE_DRIFT', candidates: active, generatedCandidates: candidates, activeCandidates: active, rejectedCandidates: candidates.filter((candidate) => !active.includes(candidate)), outcomes, before, baselinePreflight, projectedQuality, preflight, reloaded, reloadedPreflight, reloadedQuality, drift, serviceCalls: budget.used }; }
  if (reloaded) journal?.event('POST_SAVE_PARITY_PASS', { page: pagePlan.page.page_number });
  const noActiveState = outcomes.some((item) => item.state === 'PROVIDER_OUTPUT_EXHAUSTED') ? 'UNCHANGED_PROVIDER_FAILURE' : outcomes.some((item) => item.state === 'SOURCE_INSUFFICIENT') ? 'UNCHANGED_SOURCE_INSUFFICIENT' : pagePlan.assignments.length ? 'UNCHANGED_CANDIDATE_GUARD' : 'UNCHANGED_NO_ASSIGNMENTS';
  const state = apply ? (active.length ? 'PERSISTED' : noActiveState) : 'READY_TO_PERSIST';
  if (state === 'UNCHANGED_SOURCE_INSUFFICIENT') journal?.event('PAGE_UNCHANGED', { page: pagePlan.page.page_number });
  return { state, candidates: active, generatedCandidates: candidates, activeCandidates: active, rejectedCandidates: candidates.filter((candidate) => !active.includes(candidate)), outcomes, imageIntents: pagePlan.imageIntents || [], before, projected, baselinePreflight, projectedQuality, preflight, reloaded, reloadedPreflight, reloadedQuality, drift, serviceCalls: budget.used };
}

// The edition workflow calls this only after *every* page is prepared.  It is
// deliberately separate from generation: a late writer failure therefore has
// no route to a page write.  `tx` is the one edition transaction.
async function persistPreparedPageComposition({ pagePlan, prepared, newspaper, tx, journal = null }) {
  const active = prepared.activeCandidates || prepared.candidates || [];
  if (prepared.state !== 'READY_TO_PERSIST' || !active.length) return { ...prepared, state: 'PAGE_BLOCKED', error: prepared.error || 'PREPARATION_NOT_PERSISTABLE' };
  journal?.event('PAGE_BATCH_STAGED', { page: pagePlan.page.page_number, candidates: active.length });
  await pageRepository.saveComposedStoryBatch(pagePlan.page.id, active.map((candidate) => ({ sectionKey: candidate.frame.section_key, story: persistenceStory(candidate) })), { tx });
  const activeKeys = new Set(active.map((candidate) => `${candidate.sourceId}:${candidate.frame.id}`)); const activeStories = new Set(active.map((candidate) => String(candidate.sourceId)));
  const imageIntents = (prepared.imageIntents || []).filter((intent) => intent.state === 'IMAGE_PLANNED' && (intent.companion ? activeStories.has(String(intent.storyId)) : activeKeys.has(`${intent.storyId}:${intent.frameId}`)));
  for (const intent of imageIntents) await sectionImages.placePrepared(intent, { tx });
  for (const intent of imageIntents.filter((item) => item.companion && item.sourceNewsItemId)) await sectionImages.linkSectionSource(intent.destinationSectionId, intent.sourceNewsItemId, { tx });
  const reloaded = await pageRepository.findById(pagePlan.page.id, { tx });
  const reloadedPreflight = await validatePageLayout(reloaded, newspaper);
  const reloadedQuality = await analyzeComposedLayout(reloaded, newspaper);
  const drift = await parityDifferences(prepared.projected, reloaded, active);
  for (const intent of imageIntents) { const section = reloaded.sections.find((item) => item.id === intent.destinationSectionId); const image = section?.images?.find((item) => item.url === intent.image.url); const placement = intent.placement; const mismatch = !image || ['x_px','y_px','width_px','height_px'].some((field) => Number(image?.[field]) !== Number(placement[field.replace('_px','')])) || String(image?.shape) !== String(placement.shape) || Number(image?.stand_off_px) !== Number(placement.standOffPx) || String(image?.caption || '') !== String(placement.caption || '') || Number(image?.source_news_item_id || 0) !== Number(intent.sourceNewsItemId || 0) || (intent.companion && intent.sourceNewsItemId && Number(section?.news_item_id) !== Number(intent.sourceNewsItemId)); if (mismatch) drift.push({ sectionKey: intent.destinationSectionKey, fields: ['images'], metrics: [] }); }
  const preflightMatches = JSON.stringify([...errorKeys(prepared.preflight)].sort()) === JSON.stringify([...errorKeys(reloadedPreflight)].sort());
  const qualityMatches = Math.abs(prepared.projectedQuality.score - reloadedQuality.score) <= 0.0001;
  if (!preflightMatches || drift.length || !qualityMatches) return { ...prepared, state: 'PAGE_BLOCKED', error: 'POST_SAVE_DRIFT', reloaded, reloadedPreflight, reloadedQuality, drift };
  prepared.outcomes.filter((item) => item.state === 'READY_TO_PERSIST').forEach((item) => { item.state = 'PERSISTED'; });
  imageIntents.forEach((item) => { item.state = 'IMAGE_GENERATED_PLACEMENT'; });
  journal?.event('PAGE_PARITY_PASS', { page: pagePlan.page.page_number });
  return { ...prepared, state: 'PERSISTED', reloaded, reloadedPreflight, reloadedQuality, drift };
}
module.exports = { storyPacketFromNewsItem, eligibleEditorialFrames, fallbackRolesForSource, routeSourcesToEditionPages, buildEditionCompositionPlan, summarizeEditionComposition, composedStoryFromCandidate, projectComposedStoryIntoSection, persistenceStory, composePagePlan, persistPreparedPageComposition, roleForRung };
