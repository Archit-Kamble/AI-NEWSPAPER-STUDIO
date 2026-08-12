const test = require('node:test');
const assert = require('node:assert/strict');
const { scoreStoryForFrame } = require('../src/layout/story-frame-compatibility');

function frame(overrides = {}) {
  return { block_type: 'article', story_type: 'STANDARD', width_px: 200, height_px: 200, ...overrides };
}

function story(overrides = {}) {
  return { story_type: 'STANDARD', editorial_priority: 3, ...overrides };
}

function context(...frames) {
  return { editorialFrames: frames };
}

test('a lead strongly prefers a dominant editorial frame over a tiny frame', () => {
  const dominant = frame({ width_px: 480, height_px: 320 });
  const tiny = frame({ width_px: 100, height_px: 100 });
  const candidate = story({ story_type: 'LEAD', editorial_priority: 5 });
  const large = scoreStoryForFrame(candidate, dominant, context(dominant, tiny));
  const small = scoreStoryForFrame(candidate, tiny, context(dominant, tiny));
  assert.ok(large.score >= 85);
  assert.ok(small.score + 35 < large.score);
  assert.ok(small.reasons.some((item) => item.code === 'LEAD_FRAME_TOO_WEAK'));
});

test('priority five prefers prominence while priority one does not prefer the lead frame', () => {
  const large = frame({ width_px: 400, height_px: 300 });
  const small = frame({ width_px: 120, height_px: 120 });
  const frames = context(large, small);
  assert.ok(scoreStoryForFrame(story({ editorial_priority: 5 }), large, frames).subscores.priority
    > scoreStoryForFrame(story({ editorial_priority: 5 }), small, frames).subscores.priority);
  assert.ok(scoreStoryForFrame(story({ editorial_priority: 1 }), large, frames).subscores.priority
    < scoreStoryForFrame(story({ editorial_priority: 1 }), small, frames).subscores.priority);
});

test('briefs prefer compact frames and standard stories stay flexible', () => {
  const large = frame({ width_px: 420, height_px: 300 });
  const small = frame({ width_px: 100, height_px: 110 });
  const frames = context(large, small);
  const briefLarge = scoreStoryForFrame(story({ story_type: 'BRIEF', editorial_priority: 2 }), large, frames);
  const briefSmall = scoreStoryForFrame(story({ story_type: 'BRIEF', editorial_priority: 2 }), small, frames);
  assert.ok(briefSmall.score > briefLarge.score);
  assert.ok(briefLarge.reasons.some((item) => item.code === 'BRIEF_FRAME_TOO_LARGE'));
  assert.ok(scoreStoryForFrame(story(), large, frames).score >= 65);
  assert.ok(scoreStoryForFrame(story(), small, frames).score >= 65);
});

test('photo features need an image and favor a substantial image-suitable frame', () => {
  const wide = frame({ width_px: 420, height_px: 220 });
  const narrow = frame({ width_px: 90, height_px: 300 });
  const frames = context(wide, narrow);
  const photo = story({ story_type: 'PHOTO_FEATURE', editorial_priority: 4,
    images: [{ source_width_px: 1600, source_height_px: 900 }] });
  assert.ok(scoreStoryForFrame(photo, wide, frames).score > scoreStoryForFrame(photo, narrow, frames).score);
  const noImage = scoreStoryForFrame(story({ story_type: 'PHOTO_FEATURE', editorial_priority: 4 }), wide, frames);
  assert.equal(noImage.subscores.imagery, 0);
  assert.ok(noImage.reasons.some((item) => item.code === 'PHOTO_FEATURE_NO_IMAGE'));
});

test('Smart Cards prefer structured frames and reject an advertising frame', () => {
  const card = frame({ block_type: 'feature', story_type: 'SMART_CARD', width_px: 240, height_px: 180 });
  const advert = frame({ block_type: 'advert', story_type: 'ADVERTISEMENT', width_px: 240, height_px: 180 });
  const smart = story({ story_type: 'SMART_CARD', smart_card_key: 'rashi', smart_card_data: { items: [] } });
  const suitable = scoreStoryForFrame(smart, card, context());
  const impossible = scoreStoryForFrame(smart, advert, context());
  assert.ok(suitable.score >= 85);
  assert.equal(impossible.hardReject, true);
  assert.equal(impossible.score, 0);
});

test('advertisements prefer designated frames and editorial stories are penalized there', () => {
  const advert = frame({ block_type: 'advert', story_type: 'ADVERTISEMENT', width_px: 300, height_px: 200 });
  const editorial = frame({ block_type: 'article', story_type: 'STANDARD', width_px: 300, height_px: 200 });
  const ad = story({ story_type: 'ADVERTISEMENT', editorial_priority: 1 });
  assert.ok(scoreStoryForFrame(ad, advert, context(editorial)).score > scoreStoryForFrame(ad, editorial, context(editorial)).score);
  const standardInAd = scoreStoryForFrame(story(), advert, context(editorial));
  assert.ok(standardInAd.subscores.semanticType < 50);
  assert.ok(standardInAd.reasons.some((item) => item.code === 'EDITORIAL_IN_AD_FRAME'));
});

test('advertisements and Smart Cards do not distort editorial prominence context', () => {
  const lead = frame({ width_px: 300, height_px: 250 });
  const secondary = frame({ width_px: 200, height_px: 180 });
  const advert = frame({ block_type: 'advert', story_type: 'ADVERTISEMENT', width_px: 620, height_px: 400 });
  const card = frame({ block_type: 'feature', story_type: 'SMART_CARD', width_px: 620, height_px: 400 });
  const result = scoreStoryForFrame(story({ story_type: 'LEAD', editorial_priority: 5 }), lead,
    context(lead, secondary, advert, card));
  assert.equal(result.subscores.geometry, 100);
});

test('scores are deterministic, bounded, immutable, and support all canonical/legacy types', async () => {
  const types = await import('../public/editor/layout/story-types.js');
  const inputStory = story({ story_type: 'LEAD', editorial_priority: 5 });
  const inputFrame = frame({ width_px: 300, height_px: 240 });
  const inputContext = context(inputFrame);
  const original = structuredClone({ inputStory, inputFrame, inputContext });
  assert.deepEqual(scoreStoryForFrame(inputStory, inputFrame, inputContext), scoreStoryForFrame(inputStory, inputFrame, inputContext));
  assert.deepEqual({ inputStory, inputFrame, inputContext }, original);
  for (const type of types.STORY_TYPE_KEYS) {
    const result = scoreStoryForFrame(story({ story_type: type }), inputFrame, inputContext);
    assert.ok(result.score >= 0 && result.score <= 100, type);
  }
  assert.equal(scoreStoryForFrame(story({ story_type: 'future_type' }), inputFrame, inputContext).hardReject, false);
  assert.equal(scoreStoryForFrame({}, {}, {}).score >= 0, true);
});
