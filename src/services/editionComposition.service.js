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
const roleForRung = (rung) => rung.templateKey === 'front' ? 'FRONT' : rung.templateKey === 'local' ? 'LOCAL' : rung.templateKey === 'features' ? 'FEATURES' : rung.templateKey === 'opinion' ? 'OPINION' : rung.pageNumber === rung.total ? 'BACK' : 'GENERAL';
function storyPacketFromNewsItem(item = {}) { return { id: item.id, news_item_id: item.id, story_type: item.story_type || 'STANDARD', editorial_priority: item.editorial_priority || 3, headline: item.title || '', subheading: item.subheading || '', body: item.body || item.description || '', category: item.category || '', location: item.location || '', tags: Array.isArray(item.tags) ? item.tags.join(', ') : item.tags || '', reporter_name: item.reporter_name || '', images: [], imagePlacementNeedsReview: Boolean((item.image_urls || []).length) }; }
function eligibleEditorialFrames(page) { const template = getTemplate(page.template_key); const byKey = new Map(template.sections.map((item) => [item.key, item])); return (page.sections || []).flatMap((section) => { const templateSection = byKey.get(section.section_key); const frame = frameDescriptorFromSection(section, templateSection); const type = String(frame.recommendedStoryType || '').toUpperCase(); if (section.is_custom || section.continued_from_section_id || frame.feature_key || section.smart_card_key || frame.block_type === 'advert' || SPECIAL.has(type) || (section.images || []).length) return []; return [frame]; }); }
function routeSourcesToEditionPages({ sources = [], pages = [], ladder = ladderFor(pages.length) }) {
  const pageByRole = new Map(ladder.map((rung) => [roleForRung({ ...rung, total: ladder.length }), rung.pageNumber])); const buckets = new Map(pages.map((page) => [page.page_number, []])); const unassigned = [];
  for (const source of [...sources].sort((a, b) => String(a.id).localeCompare(String(b.id)))) { const number = pageByRole.get(String(source.desired_page_role || '').toUpperCase()); if (!number) unassigned.push({ sourceId: source.id, reason: 'UNASSIGNED_SOURCE_CAPACITY' }); else buckets.get(number).push(source); }
  for (const values of buckets.values()) values.sort((a, b) => Number(b.editorial_priority) - Number(a.editorial_priority) || String(a.id).localeCompare(String(b.id)));
  return { buckets, unassigned, pageByRole };
}
async function buildEditionCompositionPlan({ pages = [], newspaper = {}, sources = [], rebalance = rebalanceFlowAwarePageAssignments }) {
  const ladder = ladderFor(pages.length); const routed = routeSourcesToEditionPages({ sources, pages, ladder }); const plans = [];
  for (const page of [...pages].sort((a, b) => a.page_number - b.page_number)) {
    const frames = eligibleEditorialFrames(page); const stories = (routed.buckets.get(page.page_number) || []).slice(0, frames.length).map(storyPacketFromNewsItem);
    const balance = stories.length && frames.length ? await rebalance(stories, frames, { page, newspaper }) : { finalPlan: { assignments: [], unassignedStories: stories.map((story) => ({ storyId: story.id })) } };
    plans.push({ page, role: roleForRung({ ...(ladder.find((rung) => rung.pageNumber === page.page_number) || {}), total: pages.length }), frames, stories, assignments: balance.finalPlan.assignments || [], balance });
  }
  const assigned = plans.flatMap((plan) => plan.assignments.map((assignment) => ({ ...assignment, pageNumber: plan.page.page_number }))); const ids = assigned.map((item) => String(item.storyId)); const frames = assigned.map((item) => `${item.pageNumber}:${item.frameId}`);
  if (new Set(ids).size !== ids.length || new Set(frames).size !== frames.length) throw new Error('Invalid edition composition plan: duplicate story or frame');
  return { pages: plans, routed: routed.unassigned, assigned };
}

async function composePagePlan({ pagePlan, sourcesById, newspaper, askForJson, maxServiceCalls = 32, callBudget = null, apply = false, compose = composeSourceToFrame }) {
  const budget = callBudget || { max: maxServiceCalls, used: 0 }; const frameById = new Map(pagePlan.frames.map((frame) => [String(frame.id), frame])); const candidates = [];
  const before = await analyzeComposedLayout(pagePlan.page, newspaper);
  const baselinePreflight = await validatePageLayout(pagePlan.page, newspaper);
  for (const assignment of pagePlan.assignments) {
    const source = sourcesById.get(String(assignment.storyId)); const frame = frameById.get(String(assignment.frameId));
    if (!source || !frame) return { state: 'PAGE_BLOCKED', error: 'INVALID_ASSIGNMENT', candidates, before };
    const budgetedAsk = async (...args) => { if (budget.used >= budget.max) return { error: 'SERVICE_CALL_BUDGET_EXHAUSTED' }; budget.used += 1; return askForJson(...args); };
    const input = await writerInputFromNewsItem(source); const result = await compose({ ...input, frame, language: 'Marathi', askForJson: budgetedAsk });
    if (result.error || !result.assessment?.accepted) return { state: 'PAGE_BLOCKED', error: result.error || 'FIT_REJECTED', candidates, before, serviceCalls: budget.used };
    const grounding = validateGeneratedGrounding(result.proposal, input.source);
    if (!grounding.valid) return { state: 'PAGE_BLOCKED', error: grounding.issues[0].code, candidates, before, serviceCalls: budget.used };
    if (result.sourceSufficiency.status === 'INSUFFICIENT_FOR_TREATMENT') continue;
    const compiled = compileEditorialPresentation(result.proposal, result.editorial.storyType, { source: input.source });
    candidates.push({ sourceId: source.id, frame, result, grounding, compiled, source: input.source });
  }
  const projected = { ...pagePlan.page, sections: pagePlan.page.sections.map((section) => { const candidate = candidates.find((item) => item.frame.section_key === section.section_key); return candidate ? { ...section, ...candidate.compiled, editorial_presentation: candidate.compiled.presentation } : section; }) };
  const preflight = await validatePageLayout(projected, newspaper); const projectedQuality = await analyzeComposedLayout(projected, newspaper);
  const keyOf = (finding) => `${finding.type || finding.check}:${finding.sectionKey}`;
  const baselineErrors = new Set([...baselinePreflight.collisions, ...baselinePreflight.overflow].filter((finding) => finding.level === 'error').map(keyOf));
  const introducedErrors = [...preflight.collisions, ...preflight.overflow].filter((finding) => finding.level === 'error' && !baselineErrors.has(keyOf(finding)));
  if (introducedErrors.length || projectedQuality.score < before.score - 5) return { state: 'PAGE_BLOCKED', error: introducedErrors.length ? 'PREFLIGHT_BLOCKED' : 'QUALITY_REGRESSION', candidates, before, baselinePreflight, projectedQuality, preflight, introducedErrors, serviceCalls: budget.used };
  if (apply && candidates.length) await pageRepository.saveComposedStoryBatch(pagePlan.page.id, candidates.map((candidate) => ({ sectionKey: candidate.frame.section_key, story: { newsItemId: null, storyType: candidate.result.editorial.storyType, editorialPriority: candidate.result.editorial.editorialPriority, ...candidate.compiled, category: candidate.source.category, location: candidate.source.location, tags: candidate.source.tags, reporterName: candidate.source.reporterName, language: 'Marathi', status: candidate.result.sourceSufficiency.status === 'THIN' ? 'needs_review' : 'needs_review', aiGenerated: true, editorialPresentation: candidate.compiled.presentation } })));
  const reloaded = apply ? await pageRepository.findById(pagePlan.page.id) : null;
  return { state: apply ? 'PERSISTED' : 'READY_TO_PERSIST', candidates, before, baselinePreflight, projectedQuality, preflight, reloaded, serviceCalls: budget.used };
}
module.exports = { storyPacketFromNewsItem, eligibleEditorialFrames, routeSourcesToEditionPages, buildEditionCompositionPlan, composePagePlan, roleForRung };
