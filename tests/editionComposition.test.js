const test = require('node:test');
const assert = require('node:assert/strict');
const { routeSourcesToEditionPages, storyPacketFromNewsItem, composePagePlan, projectComposedStoryIntoSection, buildEditionCompositionPlan, summarizeEditionComposition } = require('../src/services/editionComposition.service');
const { getTemplate } = require('../src/layout/templates');
const { normalizeNewsroomSources } = require('../src/services/newsroomSource.service');
const { sourceSnapshot, loadNewsroomSourcesForEdition } = require('../src/services/newsroomSource.service');

test('frame-independent sources route deterministically by semantic page role', () => {
  const pages = [{ page_number: 1 }, { page_number: 2 }, { page_number: 3 }, { page_number: 4 }];
  const routed = routeSourcesToEditionPages({ pages, sources: [
    { id: 'z', desired_page_role: 'LOCAL', editorial_priority: 2 },
    { id: 'a', desired_page_role: 'LOCAL', editorial_priority: 4 },
    { id: 'f', desired_page_role: 'FEATURES', editorial_priority: 3 },
  ] });
  assert.deepEqual(routed.buckets.get(2).map((source) => source.id), ['a', 'z']);
  assert.deepEqual(routed.buckets.get(3).map((source) => source.id), ['f']);
});

test('newsroom packets retain source copy and do not invent image placement', () => {
  const packet = storyPacketFromNewsItem({ id: 'source', title: 'मथळा', description: 'पुरविलेली बातमी', image_urls: ['/x.jpg'] });
  assert.equal(packet.body, 'पुरविलेली बातमी');
  assert.equal(packet.imagePlacementNeedsReview, true);
  assert.deepEqual(packet.images, []);
});

test('article copy is not fabricated as a deck and is counted only once', async () => {
  const packet = storyPacketFromNewsItem({ id: 'market', title: 'बाजार', description: 'बातमीची पूर्ण प्रत' });
  assert.equal(packet.subheading, '');
  assert.equal(packet.body, 'बातमीची पूर्ण प्रत');
});

test('four-page routing gives general and opinion sources deterministic fallback capacity', () => {
  const pages = [{ page_number: 1 }, { page_number: 2 }, { page_number: 3 }, { page_number: 4 }];
  const routed = routeSourcesToEditionPages({ pages, capacities: new Map([[1, 1], [2, 1], [3, 1], [4, 3]]), sources: [
    { id: 'opinion', desired_page_role: 'OPINION', editorial_priority: 4 },
    { id: 'general', desired_page_role: 'GENERAL', editorial_priority: 3 },
  ] });
  assert.equal(routed.buckets.get(3)[0].id, 'opinion');
  assert.equal(routed.buckets.get(4)[0].id, 'general');
});

test('routing offers every LOCAL candidate to B6 even when page 2 has fewer frames', () => {
  const pages = [{ page_number: 1 }, { page_number: 2 }, { page_number: 3 }, { page_number: 4 }];
  const sources = ['water', 'hospital', 'school', 'health', 'bus'].map((id, index) => ({ id, desired_page_role: 'LOCAL', editorial_priority: 5 - index }));
  const routed = routeSourcesToEditionPages({ pages, capacities: new Map([[2, 3]]), sources });
  assert.deepEqual(routed.buckets.get(2).map((item) => item.id), ['water', 'hospital', 'school', 'health', 'bus']);
  assert.equal(routed.unassigned.length, 0);
});

test('opinion fallback competes with direct feature candidates instead of being capacity-rejected', () => {
  const pages = [{ page_number: 1 }, { page_number: 2 }, { page_number: 3 }, { page_number: 4 }];
  const routed = routeSourcesToEditionPages({ pages, capacities: new Map([[3, 1]]), sources: [
    { id: 'feature-a', desired_page_role: 'FEATURES', editorial_priority: 4 },
    { id: 'feature-b', desired_page_role: 'FEATURES', editorial_priority: 3 },
    { id: 'opinion', desired_page_role: 'OPINION', editorial_priority: 4 },
  ] });
  assert.deepEqual(routed.buckets.get(3).map((item) => item.id), ['feature-a', 'feature-b', 'opinion']);
});

test('invalid baseline blocks before an AI call', async () => {
  let calls = 0;
  const page = { id: 'page', page_number: 2, sections: [{ id: 'frame', section_key: 'frame', width_px: 200, height_px: 100, x_px: 0, y_px: 0 }] };
  const plan = { page, frames: [{ id: 'frame', section_key: 'frame' }], assignments: [{ storyId: 'story', frameId: 'frame' }] };
  const result = await composePagePlan({ pagePlan: plan, sourcesById: new Map([['story', { id: 'story' }]]), newspaper: {}, askForJson: async () => { calls += 1; return {}; } });
  assert.equal(result.error, 'BASELINE_PREFLIGHT_INVALID');
  assert.equal(calls, 0);
});

test('composed projection mirrors persisted semantics but preserves frame geometry', () => {
  const section = { id: 7, section_key: 'f', x_px: 10, y_px: 20, width_px: 100, height_px: 80, body_font_px: 16 };
  const candidate = { source: { category: 'स्थानिक', reporterName: 'वार्ताहर' }, result: { editorial: { storyType: 'LEAD', editorialPriority: 5 } }, compiled: { headline: 'मथळा', subheading: '', body: 'प्रत', kicker: '', caption: '', presentation: { annotations: [] } } };
  const projected = projectComposedStoryIntoSection(section, candidate);
  assert.equal(projected.story_type, 'LEAD'); assert.equal(projected.editorial_priority, 5);
  assert.equal(projected.width_px, 100); assert.equal(projected.y_px, 20);
});

function syntheticPages() {
  return [1, 2, 3, 4].map((pageNumber) => {
    const templateKey = pageNumber === 1 ? 'front' : pageNumber === 2 ? 'local' : pageNumber === 3 ? 'features' : 'back';
    const template = getTemplate(templateKey);
    return { id: `page-${pageNumber}`, page_number: pageNumber, template_key: templateKey, sections: template.sections.map((item, index) => ({
      id: `${pageNumber}-${item.key}`, section_key: item.key, x_px: item.x, y_px: item.y, width_px: item.width, height_px: item.height,
      z_index: index, block_type: item.blockType || 'article', story_type: item.storyType || 'STANDARD', editorial_priority: item.editorialPriority || 3, images: [],
    })) };
  });
}
function genericSource(id, role, type = 'STANDARD', priority = 3, body = 'पुरेशी संपादकीय प्रत '.repeat(40)) {
  return { sourceId: id, headline: `${id} मथळा`, body, section: 'स्थानिक', storyType: type, editorialPriority: priority, desiredPageRole: role };
}
function planSignature(plan) { return plan.pages.map((page) => ({ page: page.page.page_number, routed: page.stories.map((story) => story.id), assignments: page.assignments.map((item) => [item.storyId, item.frameId]) })); }

test('generic newsroom contract normalizes aliases, optional fields, and stable source identity', () => {
  const normalized = normalizeNewsroomSources([{ id: 'z', title: 'Z', description: 'प्रत', story_type: 'brief', editorial_priority: 9, tags: ['एक', 'दोन'] }, { sourceId: 'a', headline: 'A', body: 'प्रत' }]);
  assert.deepEqual(normalized.map((item) => item.sourceId), ['a', 'z']);
  assert.equal(normalized[1].story_type, 'brief'); assert.equal(normalized[1].editorial_priority, 5); assert.equal(normalized[1].tags, 'एक, दोन');
});

test('database newsroom loading uses only approved edition items and journals a stable source snapshot', async () => {
  const repository = { findForComposition: async (editionId) => [{ id: 12, newspaper_id: editionId, title: 'ब', description: 'प्रत', status: 'approved', story_type: 'STANDARD' }, { id: 3, newspaper_id: editionId, title: 'अ', description: 'प्रत', status: 'approved', story_type: 'BRIEF' }] };
  const loaded = await loadNewsroomSourcesForEdition(88, { repository }); const reordered = sourceSnapshot([...loaded.sources].reverse());
  assert.deepEqual(loaded.sourceIds, ['12', '3']); assert.equal(loaded.hash, reordered.hash);
  assert.equal(loaded.sources.every((source) => !Object.hasOwn(source, 'x_px')), true);
});

test('edition planning is invariant across twenty input permutations of a generic source pool', async () => {
  const sources = [
    genericSource('inbox-a', 'FRONT', 'LEAD', 5), genericSource('inbox-b', 'FRONT', 'STANDARD', 3), genericSource('inbox-c', 'LOCAL', 'LEAD', 5),
    genericSource('inbox-d', 'LOCAL', 'ANALYSIS', 4), genericSource('inbox-e', 'LOCAL', 'BRIEF', 2), genericSource('inbox-f', 'GENERAL', 'STANDARD', 3),
    genericSource('inbox-g', 'GENERAL', 'BRIEF', 2), genericSource('inbox-h', 'OPINION', 'OPINION', 4), genericSource('inbox-i', 'BACK', 'STANDARD', 3),
  ];
  const pages = syntheticPages(); const baseline = planSignature(await buildEditionCompositionPlan({ pages, sources }));
  for (let seed = 0; seed < 20; seed += 1) {
    const shuffled = [...sources].sort((a, b) => ((a.sourceId.charCodeAt(6) * (seed + 3)) % 17) - ((b.sourceId.charCodeAt(6) * (seed + 3)) % 17));
    assert.deepEqual(planSignature(await buildEditionCompositionPlan({ pages, sources: shuffled })), baseline, `seed ${seed}`);
  }
});

test('messy source pools report coverage and never relabel a safely partial edition as full', () => {
  const plans = [{ page: { page_number: 1 }, role: 'FRONT', frames: [{ id: 'a', section_key: 'a', width_px: 100, height_px: 100 }, { id: 'b', section_key: 'b', width_px: 100, height_px: 100 }, { id: 'c', section_key: 'c', width_px: 100, height_px: 100 }], stories: [{}, {}], assignments: [{ frameId: 'a', storyId: 'one' }, { frameId: 'b', storyId: 'two' }] }, { page: { page_number: 2 }, role: 'LOCAL', frames: [{ id: 'd', section_key: 'd', width_px: 100, height_px: 100 }], stories: [], assignments: [] }];
  const partial = summarizeEditionComposition(plans, [{ state: 'PERSISTED', outcomes: [{ frame: 'a', state: 'PERSISTED' }, { frame: 'b', state: 'SOURCE_INSUFFICIENT' }], candidates: [{}] }, { state: 'UNCHANGED_NO_ASSIGNMENTS', outcomes: [], candidates: [] }]);
  assert.equal(partial.state, 'PARTIALLY_COMPOSED');
  assert.equal(partial.pages[0].editorialCoverageRatio, 0.3333);
  const unresolved = summarizeEditionComposition(plans, [{ state: 'PERSISTED', outcomes: [{ frame: 'a', state: 'PERSISTED' }], candidates: [{}] }, { state: 'UNCHANGED_NO_ASSIGNMENTS', outcomes: [], candidates: [] }]);
  assert.equal(unresolved.state, 'PARTIALLY_COMPOSED');
  assert.equal(summarizeEditionComposition(plans, [{ state: 'PAGE_BLOCKED', error: 'PREFLIGHT_BLOCKED' }]).state, 'BLOCKED');
});

test('completion ledger reports weighted coverage and requires every ordinary frame to persist', () => {
  const plans = [{ page: { page_number: 1 }, role: 'FRONT', frames: [{ id: 'large', section_key: 'large', width_px: 400, height_px: 200 }, { id: 'small', section_key: 'small', width_px: 100, height_px: 100 }], stories: [{}, {}], assignments: [{ frameId: 'large', storyId: 'a' }, { frameId: 'small', storyId: 'b' }] }];
  const complete = summarizeEditionComposition(plans, [{ state: 'PERSISTED', outcomes: [{ frame: 'large', state: 'PERSISTED' }, { frame: 'small', state: 'PERSISTED' }], candidates: [{}, {}] }]);
  assert.equal(complete.state, 'FULLY_COMPOSED'); assert.equal(complete.pages[0].weightedEditorialCoverageRatio, 1);
  const partial = summarizeEditionComposition(plans, [{ state: 'PERSISTED', outcomes: [{ frame: 'small', state: 'PERSISTED' }], candidates: [{}] }]);
  assert.equal(partial.state, 'PARTIALLY_COMPOSED'); assert.equal(partial.ledger.find((item) => item.frame === 'large').state, 'SEMANTICALLY_UNMATCHED');
  assert.equal(partial.pages[0].weightedEditorialCoverageRatio, 0.1111);
});

test('production composition modules contain no B8B fixture source IDs', () => {
  const fs = require('fs'); const path = require('path');
  const production = ['editionComposition.service.js', 'newsroomSource.service.js'].map((file) => fs.readFileSync(path.join(__dirname, '..', 'src', 'services', file), 'utf8')).join('\n');
  assert.doesNotMatch(production, /src-(?:front|local|features|back|general|opinion)-/);
});

test('production composition workflow never imports disposable fixture scripts', () => {
  const fs = require('fs'); const path = require('path');
  const workflow = fs.readFileSync(path.join(__dirname, '..', 'src', 'services', 'editionCompositionWorkflow.service.js'), 'utf8');
  assert.doesNotMatch(workflow, /scripts\/|ai-test-news|compose-ai-test-edition|build-test-edition/);
});

test('workflow fingerprints are geometry-sensitive and an active plan rejects a double submit before any work', async () => {
  const workflow = require('../src/services/editionCompositionWorkflow.service');
  const paper = { id: 78 };
  const base = [{ id: 1, template_key: 'front', sections: [{ section_key: 'lead', x_px: 10, y_px: 10, width_px: 100, height_px: 100, block_type: 'article', story_type: 'LEAD', images: [] }] }];
  const moved = [{ ...base[0], sections: [{ ...base[0].sections[0], x_px: 11 }] }];
  assert.notEqual(workflow.frameFingerprint(paper, base), workflow.frameFingerprint(paper, moved));
  const token = 'operator-workflow-active-run-test';
  workflow._plans.set(token, { editionId: 78, aiMode: 'codex-local', maxServiceCalls: 64 });
  workflow._activeRuns.set(78, { runId: 'already-running' });
  try {
    const result = await workflow.applyEditionComposition({ editionId: 78, planToken: token, aiMode: 'codex-local', maxServiceCalls: 64 });
    assert.deepEqual(result, { ok: false, code: 'RUN_ALREADY_ACTIVE', runId: 'already-running' });
  } finally {
    workflow._plans.delete(token); workflow._activeRuns.delete(78);
  }
});

test('edition atomicity uses an explicit staged page persistence seam, never per-page apply during preparation', () => {
  const fs = require('fs'); const path = require('path');
  const composition = fs.readFileSync(path.join(__dirname, '..', 'src', 'services', 'editionComposition.service.js'), 'utf8');
  const workflow = fs.readFileSync(path.join(__dirname, '..', 'src', 'services', 'editionCompositionWorkflow.service.js'), 'utf8');
  assert.match(composition, /persistPreparedPageComposition/);
  assert.match(workflow, /apply: false/);
  assert.match(workflow, /await tx\.query\('BEGIN'\)/);
  assert.match(workflow, /await tx\.query\('ROLLBACK'\)/);
  assert.match(workflow, /COMPOSITION_BASELINE_STALE/);
  assert.match(composition, /PAGE_BATCH_STAGED/);
});
