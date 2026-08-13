// Disposable B7B integration driver. It is deliberately not a production API.
// Planning and every AI proposal happen in memory; only --apply writes content.
require('dotenv').config();
const pages = require('../src/repositories/page.repository');
const newspapers = require('../src/repositories/newspaper.repository');
const { getTemplate } = require('../src/layout/templates');
const { compositionInputForPage, storyPacketFromSection, frameDescriptorFromSection } = require('../src/layout/composition-adapter');
const { rebalanceFlowAwarePageAssignments } = require('../src/layout/flow-aware-page-balancer');
const { composeSourceToFrame, writerInputFromNewsItem } = require('../src/services/exactFitWriter.service');
const { analyzeComposedLayout } = require('../src/layout/composed-layout-quality');
const { validatePageLayout } = require('../src/services/preflight.service');
const { compileEditorialPresentation } = require('../src/services/editorialPackage.service');
const { validateGeneratedGrounding } = require('../src/services/generatedGrounding.service');
const fixtureSources = require('./ai-test-news-sources');

const FIXTURE_DATE = '2099-05-01';
const SPECIAL = new Set(['SMART_CARD', 'ADVERTISEMENT', 'QUOTE', 'DATA']);
const idOf = (item) => String(item?.id ?? item?.section_id ?? item?.section_key ?? '');
const text = (value) => String(value || '').trim();
const hasCopy = (section) => Boolean(text(section?.headline) || text(section?.body) || section?.news_item_id);
const hasImage = (section) => Boolean(text(section?.image_url) || section?.images?.length);
const typeOf = (section) => String(section?.story_type || section?.storyType || '').toUpperCase();
const clone = (value) => JSON.parse(JSON.stringify(value));

function sourceFor(section, sources = fixtureSources) {
  return sources[section.section_key] || {
    title: section.headline, subheading: section.subheading, description: section.body,
    category: section.category, location: section.location, reporter_name: section.reporter_name,
    tags: section.tags, story_type: section.story_type, editorial_priority: section.editorial_priority,
  };
}

function sectionResultAssignment(section, frame) {
  return { storyId: idOf(section), frameId: idOf(frame), score: null, inPlaceImagePackage: true };
}

function assertDisposableEdition(newspaper, apply) {
  if (apply && String(newspaper?.publication_date || '').slice(0, 10) === FIXTURE_DATE) {
    throw new Error(`Refusing to write the reference fixture date ${FIXTURE_DATE}; build a separate disposable edition first.`);
  }
}

function fatalResult(result) {
  return result.error || (!result.notApplicable && !result.assessment?.accepted);
}

async function composePage(page, newspaper, options = {}) {
  const {
    apply = false, askForJson, maxStories = Infinity, sources = fixtureSources,
    templateFor = getTemplate, rebalance = rebalanceFlowAwarePageAssignments,
    compose = composeSourceToFrame, saveBatch = pages.saveComposedStoryBatch, save = null,
    analyze = analyzeComposedLayout, preflight = validatePageLayout, reload = pages.findById,
    maxServiceCalls = 32,
  } = options;
  assertDisposableEdition(newspaper, apply);
  // The immutable source snapshot is never read from the persisted page again.
  const snapshot = clone(page.sections || []);
  const template = templateFor(page.template_key);
  const input = compositionInputForPage({ ...page, sections: snapshot }, template);
  const imageIds = new Set(snapshot.filter(hasImage).map(idOf));
  const lockedByAdapter = new Set(input.lockedSections.map((item) => String(item.sectionId)));
  const movableStories = input.movableStories.filter((story) => !imageIds.has(idOf(story)));
  const candidateFrames = input.candidateFrames.filter((frame) => !imageIds.has(idOf(frame)));
  const fixedSections = snapshot.filter((section) => lockedByAdapter.has(idOf(section)) || imageIds.has(idOf(section)));
  const balance = await rebalance(movableStories, candidateFrames, { page: { ...page, sections: snapshot }, newspaper, fixedSections });
  const frameById = new Map(candidateFrames.map((frame) => [idOf(frame), frame]));
  const storyById = new Map(movableStories.map((story) => [idOf(story), story]));

  // Images have no destination-placement model yet. They are eligible only in
  // their current frame, and the existing placement is passed to B7A's fit map.
  const imageAssignments = snapshot.flatMap((section) => {
    if (!imageIds.has(idOf(section)) || lockedByAdapter.has(idOf(section)) || !hasCopy(section) || SPECIAL.has(typeOf(section))) return [];
    const frame = frameDescriptorFromSection(section, (template.sections || []).find((item) => item.key === section.section_key));
    return [{ assignment: sectionResultAssignment(section, frame), story: storyPacketFromSection(section), frame }];
  });
  const planned = (balance.finalPlan.assignments || []).map((assignment) => ({ assignment, story: storyById.get(String(assignment.storyId)), frame: frameById.get(String(assignment.frameId)) }))
    .concat(imageAssignments)
    .filter((item) => item.story && item.frame && !SPECIAL.has(String(item.story.story_type || '').toUpperCase()))
    .slice(0, Math.max(0, maxStories));
  const proposals = []; let serviceCalls = 0;
  for (const item of planned) {
    const sourceItem = sourceFor(snapshot.find((section) => idOf(section) === idOf(item.story)) || {}, sources);
    const writerInput = await writerInputFromNewsItem({ ...sourceItem, story_type: item.story.story_type, editorial_priority: item.story.editorial_priority });
    if (options.planOnly) continue;
    if (serviceCalls >= maxServiceCalls) return { error: 'SERVICE_CALL_BUDGET_EXHAUSTED', balance, proposals, plannedCount: planned.length, serviceCalls };
    const result = await compose({ ...writerInput, source: { ...writerInput.source, images: item.story.images || [] }, frame: item.frame, language: 'Marathi', askForJson });
    serviceCalls += result.attempts || 0;
    if (fatalResult(result)) return { error: 'FATAL_PROPOSAL', balance, proposals, plannedCount: planned.length, lockedSections: input.lockedSections, imageLockedSectionIds: [...imageIds] };
    const grounding = validateGeneratedGrounding(result.proposal, writerInput.source);
    if (!grounding.valid) return { error: 'GROUNDING_FAILED', grounding, balance, proposals, plannedCount: planned.length };
    const compiled = compileEditorialPresentation(result.proposal, result.editorial.storyType, { source: writerInput.source });
    proposals.push({ ...item, writerInput, result, compiled, grounding });
  }
  // This loop is intentionally after ALL proposals/acceptance checks.
  const beforeQuality = analyze ? await analyze({ ...page, sections: snapshot }, newspaper) : null;
  const projected = { ...page, sections: snapshot.map((section) => {
    const item = proposals.find((proposal) => proposal.frame.section_key === section.section_key); return item ? { ...section, ...item.compiled, editorial_presentation: item.compiled.presentation } : section;
  }) };
  const projectedPreflight = proposals.length && preflight ? await preflight(projected, newspaper) : null;
  if (projectedPreflight && !projectedPreflight.valid) return { error: 'PREFLIGHT_BLOCKED', balance, proposals, plannedCount: planned.length, preflight: projectedPreflight };
  const batchItems = proposals.map((item) => {
    const proposal = item.compiled;
    return { sectionKey: item.frame.section_key, story: {
      newsItemId: item.story.news_item_id, storyType: item.result.editorial.storyType,
      editorialPriority: item.result.editorial.editorialPriority, ...proposal,
      category: item.writerInput.source.category, location: item.writerInput.source.location,
      tags: item.writerInput.source.tags, reporterName: item.writerInput.source.reporterName,
      language: 'Marathi', aiGenerated: true, status: 'needs_review', editorialPresentation: item.compiled.presentation,
    } };
  });
  if (apply && batchItems.length) {
    if (save) for (const item of batchItems) await save(page.id, item.sectionKey, item.story);
    else await saveBatch(page.id, batchItems);
  }
  const persistedPage = apply && reload ? await reload(page.id) : null;
  const afterQuality = persistedPage && analyze ? await analyze(persistedPage, newspaper) : null;
  const preflightResult = persistedPage && preflight ? await preflight(persistedPage, newspaper) : null;
  return { balance, proposals, plannedCount: planned.length, applied: apply, serviceCalls, lockedSections: input.lockedSections, imageLockedSectionIds: [...imageIds], beforeQuality, afterQuality, preflight: preflightResult };
}

function arg(name, fallback = undefined) { const index = process.argv.indexOf(name); return index >= 0 ? process.argv[index + 1] : fallback; }
async function main() {
  const edition = Number(arg('--edition')); const pageNumber = Number(arg('--page', 2));
  const apply = process.argv.includes('--apply'); const suppliedMax = Number(arg('--max-stories', process.env.SAHAS_AI_TEST_MAX_STORIES)); const maxStories = Number.isFinite(suppliedMax) ? Math.max(0, suppliedMax) : Infinity;
  const planOnly = process.argv.includes('--plan-only'); const maxServiceCalls = Math.max(0, Number(arg('--max-service-calls', 32)) || 32);
  if (!edition) throw new Error('usage: node scripts/compose-ai-test-edition.js --edition <id> [--page 2] [--plan-only|--apply] [--max-stories N]');
  const newspaper = await newspapers.findById(edition); const page = (await pages.findByNewspaper(edition)).find((item) => item.page_number === pageNumber);
  if (!newspaper || !page) throw new Error('edition or requested page was not found');
  console.log(JSON.stringify({ sourceMode: 'fixture', page: pageNumber, apply, planOnly, maxStories: Number.isFinite(maxStories) ? maxStories : 'unlimited', maximumServiceCalls: maxServiceCalls }));
  const result = await composePage(page, newspaper, { apply, planOnly, maxStories, maxServiceCalls });
  console.log(JSON.stringify({ planned: result.plannedCount, proposals: result.proposals.length, applied: result.applied || false, error: result.error || null, lockedSections: result.lockedSections, imageLockedSectionIds: result.imageLockedSectionIds, beforeQuality: result.beforeQuality?.score ?? null, afterQuality: result.afterQuality?.score ?? null, preflightValid: result.preflight?.valid ?? null }, null, 2));
}
if (require.main === module) main().catch((error) => { console.error(error.message); process.exit(1); });
module.exports = { FIXTURE_DATE, assertDisposableEdition, composePage, sourceFor };
