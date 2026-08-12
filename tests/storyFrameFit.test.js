const test = require('node:test');
const assert = require('node:assert/strict');
const { measureStoryFrameFit } = require('../src/layout/story-frame-fit');
const { analyzeComposedLayout } = require('../src/layout/composed-layout-quality');
const { geometryOf } = require('../src/layout/geometry');

const g = geometryOf({}); const left = g.marginXPx; const top = g.regions.inside.content.top;
function frame(id = 'frame', overrides = {}) { return { id, section_key: id, x_px: left, y_px: top, width_px: 360, height_px: 250, block_type: 'article', headline_font_px: 30, subheading_font_px: 16, body_font_px: 16, margin_px: 12, line_height: 1.45, column_count: 1, ...overrides }; }
function story(id = 'story', overrides = {}) { return { id, story_type: 'STANDARD', editorial_priority: 3, headline: 'मराठी बातमी: १२३ आणि English name', subheading: '', body: 'अ'.repeat(200), images: [], ...overrides }; }

test('near capacity, severe underfill, and overflow retain canonical raw evidence', async () => {
  const base = await measureStoryFrameFit(story(), frame());
  const good = await measureStoryFrameFit(story('good', { body: 'अ'.repeat(Math.floor(base.bodyCharBudget * 0.8)) }), frame());
  const light = await measureStoryFrameFit(story('light', { body: 'लहान.' }), frame());
  const overflow = await measureStoryFrameFit(story('over', { body: 'अ'.repeat(base.bodyCharBudget + 50) }), frame());
  assert.ok(['GOOD_FIT', 'TIGHT_FIT'].includes(good.fitClass));
  assert.equal(light.fitClass, 'SEVERE_UNDERFILL');
  assert.equal(overflow.fitClass, 'OVERFLOW'); assert.ok(overflow.rawBodyFillRatio > 1); assert.equal(overflow.overflowChars, 50);
});

test('destination presentation, headline and deck determine canonical capacity', async () => {
  const source = story('source', { headline_font_px: 5, body_font_px: 5, body: 'अ'.repeat(100) });
  const wide = await measureStoryFrameFit(source, frame('wide', { headline_font_px: 32, body_font_px: 16 }));
  const narrow = await measureStoryFrameFit(source, frame('narrow', { width_px: 180, headline_font_px: 32, body_font_px: 16 }));
  const longHeadline = await measureStoryFrameFit(story('long', { headline: 'अ'.repeat(150), body: source.body }), frame('wide'));
  const deck = await measureStoryFrameFit(story('deck', { subheading: 'अ'.repeat(80), body: source.body }), frame('wide'));
  assert.notEqual(wide.bodyCharBudget, narrow.bodyCharBudget);
  assert.ok(longHeadline.bodyCharBudget < wide.bodyCharBudget); assert.ok(deck.bodyCharBudget < wide.bodyCharBudget);
});

test('rich text and same-frame images use shared flow, while destination image placement stays unresolved', async () => {
  const currentFrame = frame('same'); const current = story('same', { body: '<b>चार</b> लाख हेक्टर', images: [{ x_px: 120, y_px: 90, width_px: 110, height_px: 100 }] });
  const same = await measureStoryFrameFit(current, currentFrame);
  const unresolved = await measureStoryFrameFit(current, frame('other'));
  const provided = await measureStoryFrameFit(current, frame('other'), { candidateImages: [{ x_px: 0, y_px: 0, width_px: 150, height_px: 120 }] });
  assert.equal(same.imagePlacementStatus, 'VALID_CURRENT_PLACEMENT'); assert.equal(same.bodyCharsUsed, 'चार लाख हेक्टर'.length);
  assert.equal(unresolved.imagePlacementStatus, 'UNRESOLVED_DESTINATION_PLACEMENT'); assert.ok(unresolved.bodyCharBudget > same.bodyCharBudget);
  assert.equal(provided.imagePlacementStatus, 'PROVIDED_CANDIDATE_PLACEMENT'); assert.ok(provided.bodyCharBudget < unresolved.bodyCharBudget);
});

test('structured renderers defer generic text fit and B6A current composition stays identical', async () => {
  assert.equal((await measureStoryFrameFit(story('card', { story_type: 'SMART_CARD' }), frame())).applicable, false);
  assert.equal((await measureStoryFrameFit(story('ad', { story_type: 'ADVERTISEMENT' }), frame())).applicable, false);
  const current = { ...story('same'), ...frame('same') };
  const fit = await measureStoryFrameFit(story('same'), frame('same'));
  const quality = await analyzeComposedLayout({ page_number: 2, sections: [current] });
  assert.equal(fit.bodyCharBudget, quality.sections[0].bodyCharBudget);
  assert.equal(fit.bodyCharsUsed, quality.sections[0].bodyCharsUsed);
});

test('policy-aware targets distinguish photo density from physical overflow', async () => {
  const base = await measureStoryFrameFit(story('p', { story_type: 'PHOTO_FEATURE', body: '' }), frame('photo'));
  const atTarget = await measureStoryFrameFit(story('p', { story_type: 'PHOTO_FEATURE', body: 'अ'.repeat(Math.round(base.bodyCharBudget * 0.5)) }), frame('photo'));
  const dense = await measureStoryFrameFit(story('p', { story_type: 'PHOTO_FEATURE', body: 'अ'.repeat(Math.round(base.bodyCharBudget * 0.9)) }), frame('photo'));
  assert.equal(atTarget.policyFitClass, 'GOOD_POLICY_FIT'); assert.ok(atTarget.fitScore > dense.fitScore);
  assert.equal(dense.rawBodyFillRatio < 1, true); assert.equal(dense.overflowChars, 0); assert.equal(dense.policyFitClass, 'ABOVE_POLICY_RANGE');
});
