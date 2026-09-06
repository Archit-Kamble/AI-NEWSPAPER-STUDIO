require('dotenv').config();
const test = require('node:test');
const assert = require('node:assert/strict');
const { routeSourcesToEditionPages, storyPacketFromNewsItem, composePagePlan, projectComposedStoryIntoSection, buildEditionCompositionPlan, summarizeEditionComposition } = require('../src/services/editionComposition.service');
const { getTemplate } = require('../src/layout/templates');
const { normalizeNewsroomSources } = require('../src/services/newsroomSource.service');
const { sourceSnapshot, loadNewsroomSourcesForEdition } = require('../src/services/newsroomSource.service');
const pool = require('../src/config/db');
const { createApp } = require('../server');
const { newEdition, removeEdition } = require('./helpers/desk');

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

// RUN_ALREADY_ACTIVE is checked before the reviewed-cap binding, so an
// unresolvable fake editionId is fine for that one existing test above. The
// cap-binding checks below need a REAL edition: a fake editionId also fails
// (for an unrelated reason - material() finds no such edition) at the exact
// same COMPOSITION_PLAN_STALE code, which would make a fake-ID test pass
// whether or not the binding check existed at all. A real, matching Plan is
// what actually distinguishes "rejected for a stale cap" from "rejected
// because the edition changed underneath the token".
test('the reviewed provider-call cap is bound into the Plan token; Apply cannot silently raise or lower it, but may omit it', async () => {
  const workflow = require('../src/services/editionCompositionWorkflow.service');
  const server = createApp().listen(0); const port = server.address().port; let editionId;
  try {
    const { newspaper, pages } = await newEdition(port, 'call-budget binding test', { pages: [[1, 'front']] });
    editionId = newspaper.id;
    await pool.query(
      `INSERT INTO news_items (newspaper_id,title,description,status,story_type,editorial_priority,desired_page_role)
       VALUES ($1,'बजेट बंधन चाचणी बातमी',$2,'approved','LEAD',5,'FRONT')`,
      [editionId, 'ही बातमी वास्तविक वृत्त पुरवठा साखळीतून पुरवली गेली आहे, त्यामुळे रचना खरी मागणी नोंदवते. '.repeat(4)],
    );

    const derived = await workflow.planEditionComposition({ editionId, aiMode: 'production' });
    assert.equal(derived.ok, true);
    assert.ok(derived.callBudget.plannedAssignments >= 1, 'the one approved, FRONT-routed source was actually assigned to a frame');
    assert.equal(derived.callBudget.selectedProviderCallCap, derived.callBudget.plannedAssignments * 2, 'derived default is the exact-fit ceiling');
    const boundCap = derived.callBudget.selectedProviderCallCap;
    const refuse = async () => ({ error: 'stub refuses to write', condition: 'unavailable' });

    // Mismatched-cap Apply calls reject before touching the record at all
    // (before material(), before any preparation), so the SAME token is safe
    // to reuse for both. A call that gets PAST the binding check, though,
    // marks the token failed on its own stubbed refusal - so "matched" and
    // "omitted" each need their own fresh token, or the second would see
    // record.failed from the first and (mis)report the very code being ruled
    // out here for an unrelated reason.
    const raised = await workflow.applyEditionComposition({ editionId, planToken: derived.planToken, aiMode: 'production', maxServiceCalls: boundCap + 50 });
    assert.equal(raised.ok, false);
    assert.equal(raised.code, 'COMPOSITION_PLAN_STALE');
    const lowered = await workflow.applyEditionComposition({ editionId, planToken: derived.planToken, aiMode: 'production', maxServiceCalls: 0 });
    assert.equal(lowered.ok, false);
    assert.equal(lowered.code, 'COMPOSITION_PLAN_STALE');

    const forMatch = await workflow.planEditionComposition({ editionId, aiMode: 'production' });
    const matched = await workflow.applyEditionComposition({ editionId, planToken: forMatch.planToken, aiMode: 'production', maxServiceCalls: boundCap, _askForJson: refuse });
    assert.notEqual(matched.code, 'COMPOSITION_PLAN_STALE', 'the exact bound value is not a mismatch');

    const forOmit = await workflow.planEditionComposition({ editionId, aiMode: 'production' });
    const omitted = await workflow.applyEditionComposition({ editionId, planToken: forOmit.planToken, aiMode: 'production', _askForJson: refuse });
    assert.notEqual(omitted.code, 'COMPOSITION_PLAN_STALE', 'omitting it reuses the bound value, same as supplying it exactly');

    const afterHeadlines = (await pool.query('SELECT headline FROM page_sections WHERE page_id = $1', [pages[0].id])).rows;
    assert.ok(afterHeadlines.every((row) => !row.headline), 'none of the rejected/stubbed-refusal attempts wrote anything');
  } finally {
    if (editionId) await pool.query('DELETE FROM news_items WHERE newspaper_id = $1', [editionId]);
    await removeEdition(editionId); server.close();
  }
});

test('a too-low explicit provider-call cap is rejected before Plan creates a token - zero AI calls, zero writes, nothing to Apply', async () => {
  const workflow = require('../src/services/editionCompositionWorkflow.service');
  const result = await workflow.planEditionComposition({ editionId: 999999, aiMode: 'production', maxServiceCalls: 1 });
  // EDITION_NOT_FOUND fires first for a nonexistent edition - the budget
  // check only ever runs once a real plan (with a real assignment count) has
  // been built, exactly so it reflects true demand rather than a guess.
  assert.equal(result.ok, false);
  assert.ok(['EDITION_NOT_FOUND', 'COMPOSITION_CALL_BUDGET_TOO_LOW'].includes(result.code));
});

test('on a real disposable edition, Plan derives the budget from actual assigned demand and a too-low cap writes nothing', async () => {
  const workflow = require('../src/services/editionCompositionWorkflow.service');
  const server = createApp().listen(0); const port = server.address().port; let editionId;
  try {
    const { newspaper, pages } = await newEdition(port, 'call-budget policy test', { pages: [[1, 'front']] });
    editionId = newspaper.id;
    await pool.query(
      `INSERT INTO news_items (newspaper_id,title,description,status,story_type,editorial_priority,desired_page_role)
       VALUES ($1,'बजेट चाचणी बातमी',$2,'approved','LEAD',5,'FRONT')`,
      [editionId, 'ही बातमी वास्तविक वृत्त पुरवठा साखळीतून पुरवली गेली आहे, त्यामुळे रचना खरी मागणी नोंदवते. '.repeat(4)],
    );
    const before = (await pool.query('SELECT headline FROM page_sections WHERE page_id = $1', [pages[0].id])).rows;
    assert.ok(before.every((row) => !row.headline), 'fixture starts with no headlines written');

    const derived = await workflow.planEditionComposition({ editionId, aiMode: 'production' });
    assert.equal(derived.ok, true);
    assert.ok(derived.callBudget.plannedAssignments >= 1, 'the one approved source was actually assigned to a frame');
    assert.equal(derived.callBudget.selectedProviderCallCap, derived.callBudget.plannedAssignments * 2);
    assert.equal(derived.callBudget.selectionMode, 'DERIVED');

    const tooLow = await workflow.planEditionComposition({ editionId, aiMode: 'production', maxServiceCalls: 0 });
    assert.equal(tooLow.ok, false);
    assert.equal(tooLow.code, 'COMPOSITION_CALL_BUDGET_TOO_LOW');
    assert.equal(tooLow.callBudget.requestedProviderCallCap, 0);
    assert.equal(tooLow.aiCalls, 0);
    assert.equal(tooLow.writes, 0);

    const after = (await pool.query('SELECT headline FROM page_sections WHERE page_id = $1', [pages[0].id])).rows;
    assert.ok(after.every((row) => !row.headline), 'a rejected budget must never have written anything - Plan makes zero AI calls either way');
  } finally {
    if (editionId) await pool.query('DELETE FROM news_items WHERE newspaper_id = $1', [editionId]);
    await removeEdition(editionId); server.close();
  }
});

// Found by the real B8B-PRODUCTION-MODEL-CLOSEOUT configured-provider proof:
// a hard preparation failure's desk-facing sentence (askForJson()'s error can
// legitimately run past 100 characters - "Google Gemini's quota is used up
// for now. Sarvam AI is busy. Nothing could be written just now.") was being
// written into edition_composition_runs.failure_code, a VARCHAR(100) enum
// column. Postgres rejected the UPDATE outright, turning a real, already
// budget-spent provider run into an uncaught exception instead of a graceful
// BLOCKED result - discarding real paid API work for a code-level defect
// that had nothing to do with the provider.
test('a hard preparation failure with a long desk-facing message persists cleanly - the full message survives, the DB column never overflows', async () => {
  const workflow = require('../src/services/editionCompositionWorkflow.service');
  const server = createApp().listen(0); const port = server.address().port; let editionId;
  try {
    // 'local' (unlike 'front') has no REQUIRED image-companion frames, so an
    // edition with zero approved sources still plans cleanly rather than
    // blocking earlier on IMAGE_REQUIRED_MISSING - this test is about the
    // hard-preparation-failure path specifically.
    const { newspaper } = await newEdition(port, 'long failure message test', { pages: [[2, 'local']] });
    editionId = newspaper.id;
    const plan = await workflow.planEditionComposition({ editionId, aiMode: 'production' });
    assert.equal(plan.ok, true, 'an edition with no approved sources still plans cleanly, at zero required calls');

    const longSentence = 'Google Gemini’s quota is used up for now. '.repeat(4).trim();
    assert.ok(longSentence.length > 100, 'the fixture message must actually exceed the column width to prove anything');
    const result = await workflow.applyEditionComposition({
      editionId, planToken: plan.planToken, aiMode: 'production',
      _composePagePlan: async () => ({ state: 'PROVIDER_BLOCKED', error: longSentence, candidates: [], outcomes: [] }),
    });
    assert.equal(result.ok, false);
    assert.equal(result.code, 'PROVIDER_BLOCKED', 'the top-level code is the short state, never the raw sentence');
    assert.equal(result.pages[0].error, longSentence, 'the full desk-facing sentence still reaches the caller, just not the DB enum column');

    const { rows } = await pool.query('SELECT failure_code FROM edition_composition_runs WHERE run_id = $1', [result.runId]);
    assert.equal(rows[0].failure_code, 'PROVIDER_BLOCKED');
  } finally {
    await removeEdition(editionId); server.close();
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

test('newsroom image policy is deterministic, semantic, and preserves aspect ratio', () => {
  const { sourceImages, imageRequirement, selectSourceImage, placementFor } = require('../src/layout/newsroom-image-composition');
  const source = { imageReferences: [{ url: '/uploads/square.png', width: 600, height: 600, order: 1 }, { url: '/uploads/wide.png', width: 1200, height: 600, primary: true }] };
  assert.deepEqual(sourceImages(source).map((item) => item.url), ['/uploads/wide.png', '/uploads/square.png']);
  const frame = { width_px: 400, height_px: 240, margin_px: 12, recommendedStoryType: 'PHOTO_FEATURE', block_type: 'photo' };
  assert.equal(imageRequirement(source, frame), 'IMAGE_REQUIRED');
  assert.equal(imageRequirement({}, { recommendedStoryType: 'BRIEF', block_type: 'briefs' }), 'NO_IMAGE');
  const selected = selectSourceImage(source, frame); assert.equal(selected.url, '/uploads/wide.png');
  const placed = placementFor(frame, selected, 'IMAGE_REQUIRED');
  assert.ok(Math.abs((placed.width / placed.height) - 2) < 0.03);
  assert.ok(placed.x >= 0 && placed.y >= 0 && placed.x + placed.width <= frame.width_px && placed.y + placed.height <= frame.height_px);
});

test('required portrait placement uses the available companion frame without distortion', () => {
  const { placementFor } = require('../src/layout/newsroom-image-composition');
  const frame = { width_px: 72, height_px: 248, margin_px: 12 };
  const placed = placementFor(frame, { width: 500, height: 1800 }, 'IMAGE_REQUIRED');
  assert.ok(placed.width * placed.height / ((72 - 24) * (248 - 24)) > 0.45);
  assert.ok(Math.abs((placed.width / placed.height) - (500 / 1800)) < 0.01);
  assert.ok(placed.x >= 0 && placed.y >= 0 && placed.x + placed.width <= frame.width_px && placed.y + placed.height <= frame.height_px);
});

test('newsroom source snapshot changes when its image reference changes', () => {
  const { sourceSnapshot } = require('../src/services/newsroomSource.service');
  const base = { id: 4, title: 'मथळा', description: 'प्रत', image_urls: ['/uploads/a.png'] };
  assert.notEqual(sourceSnapshot([base]).hash, sourceSnapshot([{ ...base, image_urls: ['/uploads/b.png'] }]).hash);
});

test('photo slots remain image companions instead of becoming duplicate prose frames', () => {
  const { eligibleEditorialFrames } = require('../src/services/editionComposition.service');
  const page = syntheticPages()[0];
  const photoKeys = new Set(page.sections.filter((section) => section.block_type === 'photo').map((section) => section.section_key));
  const proseKeys = new Set(eligibleEditorialFrames(page).map((frame) => frame.section_key));
  for (const key of photoKeys) assert.equal(proseKeys.has(key), false, `${key} must remain a companion`);
});

test('a story package uses photo companions once and does not duplicate the image in prose', () => {
  const { buildImageIntents } = require('../src/layout/newsroom-image-composition');
  const story = { id: 'lead', story_type: 'LEAD', editorial_priority: 5, images: [{ url: '/uploads/a.jpg', width: 500, height: 1800 }, { url: '/uploads/b.jpg', width: 500, height: 1800 }] };
  const frame = { id: 10, section_id: 10, section_key: 'lead', block_type: 'article', recommendedStoryType: 'LEAD', width_px: 300, height_px: 250 };
  const intents = buildImageIntents({ page: { page_number: 1, sections: [{ id: 20, section_key: 'left-photo', block_type: 'photo', y_px: 100, width_px: 72, height_px: 248, images: [] }] }, stories: [story], frames: [frame], assignments: [{ storyId: 'lead', frameId: 10 }] });
  assert.equal(intents.find((item) => item.companion).state, 'IMAGE_PLANNED');
  assert.equal(intents.find((item) => !item.companion).state, 'IMAGE_SATISFIED_BY_COMPANION');
  assert.equal(intents.filter((item) => item.image).length, 1);
});

test('composition baseline fingerprint includes complete image placement, not just its count', () => {
  const { baselineFingerprint } = require('../src/services/editionCompositionWorkflow.service');
  const base = [{ id: 1, sections: [{ section_key: 'lead', images: [{ media_asset_id: 7, url: '/uploads/a.jpg', x_px: 10, y_px: 20, width_px: 100, height_px: 80, shape: 'rect', caption: 'कॅप्शन' }] }] }];
  const moved = [{ ...base[0], sections: [{ ...base[0].sections[0], images: [{ ...base[0].sections[0].images[0], x_px: 11 }] }] }];
  assert.notEqual(baselineFingerprint(base), baselineFingerprint(moved));
});

// Gap 3 (image truth #9): fit_mode/flip_h/flip_v/stand_off_px/mask/source
// dimensions used to be entirely absent from imageIdentity() - a Contain ->
// Stretch change, a flip, a re-run cutout mask, or a wider source asset
// could all change what actually prints while leaving BOTH the baseline
// and the frame fingerprint unchanged, so the composition workflow never
// saw a printable image transformation as a reason to re-plan.
test('composition baseline and frame fingerprints change on fit mode, flip, mask, or source dimension changes', () => {
  const { baselineFingerprint, frameFingerprint } = require('../src/services/editionCompositionWorkflow.service');
  const image = {
    media_asset_id: 7, url: '/uploads/a.jpg', source_news_item_id: null,
    x_px: 10, y_px: 20, width_px: 100, height_px: 80,
    crop_x_px: 0, crop_y_px: 0, crop_width_px: null, crop_height_px: null,
    rotation: 0, shape: 'cutout', caption: 'कॅप्शन',
    fit_mode: 'contain', flip_h: false, flip_v: false, stand_off_px: 6,
    mask: { rows: 2, cols: 2, cells: [[1, 1], [0, 0]] },
    source_width_px: 200, source_height_px: 100,
  };
  const pageWith = (overrides) => [{
    id: 1, template_key: 'front',
    sections: [{ section_key: 'lead', x_px: 0, y_px: 0, width_px: 300, height_px: 300, block_type: 'article', story_type: null, feature_key: null, continued_from_section_id: null, images: [{ ...image, ...overrides }] }],
  }];

  const base = pageWith({});
  for (const [label, overrides] of [
    ['fit mode', { fit_mode: 'stretch' }],
    ['flip', { flip_h: true }],
    ['mask', { mask: { rows: 2, cols: 2, cells: [[1, 0], [1, 0]] } }],
    ['source dimensions', { source_width_px: 400 }],
  ]) {
    const changed = pageWith(overrides);
    assert.notEqual(baselineFingerprint(base), baselineFingerprint(changed), `${label}: baseline fingerprint must change`);
    assert.notEqual(frameFingerprint({ id: 1 }, base), frameFingerprint({ id: 1 }, changed), `${label}: frame fingerprint must change`);
  }
});

test('workflow image validation applies the press DPI floor at planned print size', async (t) => {
  const { validateImageIntents } = require('../src/services/editionCompositionWorkflow.service');
  const fs = require('node:fs/promises');
  const path = require('node:path');
  const { Jimp } = await import('jimp');
  // This used to depend on an ignored upload left in one developer's checkout.
  // Own the fixture so a fresh clone checks DPI, not a missing-file failure.
  const directory = await fs.mkdtemp(path.join(__dirname, '../public/uploads/zz-dpi-test-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  await new Jimp({ width: 64, height: 64, color: 0x808080ff }).write(path.join(directory, 'small.png'));
  const intent = { companion: true, requirement: 'IMAGE_REQUIRED', state: 'IMAGE_PLANNED', destinationSectionId: 1, image: { url: `/uploads/${path.basename(directory)}/small.png` } };
  const plan = { pages: [{ frames: [], page: { sections: [{ id: 1, width_px: 2000, height_px: 3000, margin_px: 12 }] }, imageIntents: [intent] }] };
  await validateImageIntents(plan);
  assert.equal(intent.state, 'IMAGE_INSUFFICIENT_RESOLUTION');
});
