const test = require('node:test');
const assert = require('node:assert/strict');
const { composePage, assertDisposableEdition, FIXTURE_DATE } = require('../scripts/compose-ai-test-edition');
const { COMPOSED_STORY_COLUMNS } = require('../src/repositories/page.repository');

function section(id, key, extra = {}) {
  return { id, section_key: key, x_px: id * 10, y_px: 100, width_px: 180, height_px: 180, block_type: 'article', headline: `मथळा ${key}`, body: 'पुरविलेली बातमी सामग्री.', story_type: 'STANDARD', editorial_priority: 3, images: [], ...extra };
}
function page() {
  return { id: 22, template_key: 'test', page_number: 2, sections: [
    section(1, 'ordinary'),
    section(2, 'with-image', { images: [{ id: 91, url: '/photo.jpg', x_px: 1, y_px: 2, width_px: 50, height_px: 60 }] }),
    section(3, 'card', { feature_key: 'rashi', story_type: 'SMART_CARD' }),
  ] };
}
const template = () => ({ sections: [
  { key: 'ordinary', storyType: 'STANDARD' }, { key: 'with-image', storyType: 'STANDARD' }, { key: 'card', featureKey: 'rashi', storyType: 'SMART_CARD' },
] });
async function fakeCompose(input) {
  return { proposal: { headline: input.source.title, subheading: '', body: 'अ'.repeat(80) }, editorial: { storyType: input.storyType, editorialPriority: input.editorialPriority }, assessment: { accepted: true, issues: [] }, attempts: 1 };
}

test('B7B refuses to apply to the untouched reference fixture', () => {
  assert.throws(() => assertDisposableEdition({ publication_date: FIXTURE_DATE }, true), /Refusing/);
  assert.doesNotThrow(() => assertDisposableEdition({ publication_date: '2099-05-02' }, true));
});

test('B7B plans from a snapshot, excludes locked/image packages from cross-frame movement, and does not write without --apply', async () => {
  const calls = { rebalancedStories: null, rebalancedFrames: null, compose: [], saves: [] };
  const result = await composePage(page(), { publication_date: '2099-05-02' }, {
    templateFor: template,
    rebalance: async (stories, frames) => { calls.rebalancedStories = stories.map((item) => item.id); calls.rebalancedFrames = frames.map((item) => item.id); return { finalPlan: { assignments: [{ storyId: 1, frameId: 1 }] } }; },
    compose: async (input) => { calls.compose.push(input); return fakeCompose(input); }, save: async (...args) => calls.saves.push(args), analyze: false, preflight: false,
  });
  assert.deepEqual(calls.rebalancedStories, [1]);
  assert.deepEqual(calls.rebalancedFrames, [1]);
  assert.equal(calls.compose.length, 2, 'one selected ordinary story plus the image story in its own frame');
  assert.equal(calls.compose.find((item) => item.frame.section_key === 'with-image').frame.section_key, 'with-image');
  assert.equal(calls.saves.length, 0);
  assert.equal(result.applied, false);
  assert.deepEqual(result.imageLockedSectionIds, ['2']);
});

test('B7B generates every selected proposal before the first narrow persistence call and writes to the destination section key', async () => {
  const order = [];
  await composePage(page(), { publication_date: '2099-05-02' }, {
    apply: true, templateFor: template,
    rebalance: async () => ({ finalPlan: { assignments: [{ storyId: 1, frameId: 1 }] } }),
    compose: async (input) => { order.push(`compose:${input.frame.section_key}`); return fakeCompose(input); }, analyze: false, preflight: false, reload: false,
    save: async (_pageId, key, story) => { order.push(`save:${key}`); assert.ok(['ordinary', 'with-image'].includes(key)); assert.equal(story.storyType, 'STANDARD'); },
  });
  assert.deepEqual(order, ['compose:ordinary', 'compose:with-image', 'save:ordinary', 'save:with-image']);
});

test('a fatal generated proposal prevents every persistence call for its page', async () => {
  let saves = 0;
  const result = await composePage(page(), { publication_date: '2099-05-02' }, {
    apply: true, templateFor: template,
    rebalance: async () => ({ finalPlan: { assignments: [{ storyId: 1, frameId: 1 }] } }),
    compose: async () => ({ error: 'provider unavailable' }), save: async () => { saves += 1; }, analyze: false, preflight: false,
  });
  assert.equal(result.error, 'FATAL_PROPOSAL'); assert.equal(saves, 0);
});

test('the B7B persistence allowlist cannot overwrite frame geometry, presentation, feature state, or image placements', () => {
  const forbidden = ['x_px', 'y_px', 'width_px', 'height_px', 'block_type', 'feature_key', 'headline_font_px', 'body_font_px', 'column_count', 'section_images', 'images'];
  for (const field of forbidden) assert.ok(!COMPOSED_STORY_COLUMNS.includes(field), `${field} must remain frame-owned`);
  assert.ok(COMPOSED_STORY_COLUMNS.includes('headline'));
  assert.ok(COMPOSED_STORY_COLUMNS.includes('story_type'));
});
