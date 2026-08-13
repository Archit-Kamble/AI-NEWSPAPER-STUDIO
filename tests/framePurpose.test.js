const test = require('node:test');
const assert = require('node:assert/strict');
const { templates } = require('../src/layout/templates');
const { PURPOSE, REQUIREMENT, resolveFramePurpose } = require('../src/layout/frame-purpose');
const { buildEditionContentManifest } = require('../src/layout/edition-content-manifest');
const { eligibleEditorialFrames } = require('../src/services/editionComposition.service');

function standardPages() {
  return ['front', 'local', 'features', 'dense'].map((key, pageIndex) => ({
    id: pageIndex + 1, page_number: pageIndex + 1, template_key: key,
    sections: templates[key].sections.map((item, index) => ({
      id: `${pageIndex + 1}:${item.key}`, section_key: item.key, z_index: index,
      block_type: item.blockType, story_type: item.storyType, feature_key: item.featureKey,
      headline: '', body: '', status: 'empty', images: [],
    })),
  }));
}

test('every standard four-page frame has one explicit canonical owner', () => {
  const manifest = buildEditionContentManifest(standardPages());
  assert.equal(manifest.physicalFrameCount, 45);
  assert.deepEqual(manifest.framePurposeCounts, {
    EDITORIAL_STORY: 34, IMAGE_COMPANION: 2, STANDING_FEATURE: 4,
    ADVERT: 4, FIXED_FURNITURE: 0, UTILITY: 1, OPTIONAL_RESERVED: 0,
  });
  assert.equal(manifest.unknownPurposeCount, 0);
  assert.equal(manifest.ambiguousPurposeCount, 0);
  assert.equal(manifest.frames.every((frame) => frame.explicit), true);
});

test('editorial demand derives from ownership and includes a DATA article without consuming auxiliaries', () => {
  const pages = standardPages();
  const demand = pages.flatMap((page) => eligibleEditorialFrames(page).map((frame) => `${page.page_number}:${frame.section_key}`));
  assert.equal(demand.length, 34);
  assert.ok(demand.includes('3:feature-three'), 'DATA is an occupant recommendation, not a non-editorial purpose');
  for (const excluded of ['1:lead-pictures','1:lead-side','2:footer','3:rashi','3:panchang','3:dinvishesh','3:suvichar','1:top-advert']) assert.equal(demand.includes(excluded), false, excluded);
});

test('purpose is invariant to source IDs and DB order', () => {
  const pages = standardPages();
  const first = buildEditionContentManifest(pages).frames.map((frame) => [frame.page, frame.sectionKey, frame.purpose]);
  const shuffled = pages.map((page) => ({ ...page, sections: [...page.sections].reverse().map((section, index) => ({ ...section, id: `changed-${index}`, news_item_id: 9000 + index })) })).reverse();
  const second = buildEditionContentManifest(shuffled).frames.map((frame) => [frame.page, frame.sectionKey, frame.purpose]);
  assert.deepEqual(second, first);
});

test('changing explicit purpose changes demand with no page/key special case', () => {
  const section = { block_type: 'article', section_key: 'anything' };
  assert.equal(resolveFramePurpose(section, { framePurpose: PURPOSE.EDITORIAL_STORY, publicationRequirement: REQUIREMENT.REQUIRED_CONTENT }).purpose, PURPOSE.EDITORIAL_STORY);
  assert.equal(resolveFramePurpose(section, { framePurpose: PURPOSE.IMAGE_COMPANION, publicationRequirement: REQUIREMENT.REQUIRED_CONTENT, packageOwnerKey: 'owner' }).purpose, PURPOSE.IMAGE_COMPANION);
});

test('an orphan image companion is a blocking configuration state', () => {
  const page = { id: 1, page_number: 1, template_key: 'custom', sections: [{ id: 1, section_key: 'picture', z_index: 0, block_type: 'photo', images: [] }] };
  const manifest = buildEditionContentManifest([page]);
  assert.equal(manifest.frames[0].contentState, 'IMAGE_COMPANION_ORPHAN');
  assert.equal(manifest.publicationContentState, 'BLOCKED');
});

test('standing features, utility and adverts keep distinct content truth', () => {
  const pages = standardPages(); const byKey = new Map(pages.flatMap((page) => page.sections.map((section) => [section.section_key, section])));
  for (const key of ['rashi','panchang','dinvishesh','suvichar']) {
    const section = byKey.get(key); section.headline = key; section.body = 'मजकूर'; section.smart_card_key = key; section.smart_card_data = { items: [] }; section.status = 'ready';
  }
  const sudoku = byKey.get('footer'); sudoku.smart_card_key = 'sudoku'; sudoku.smart_card_data = { grid: Array.from({ length: 9 }, () => Array(9).fill(0)) }; sudoku.status = 'ready';
  for (const page of pages) for (const section of page.sections) if (section.block_type === 'advert') section.headline = 'जाहिरात';
  const manifest = buildEditionContentManifest(pages);
  assert.equal(manifest.frames.filter((frame) => frame.purpose === PURPOSE.STANDING_FEATURE && frame.contentState === 'FEATURE_READY').length, 4);
  assert.equal(manifest.frames.find((frame) => frame.purpose === PURPOSE.UTILITY).contentState, 'UTILITY_READY');
  assert.equal(manifest.frames.filter((frame) => frame.purpose === PURPOSE.ADVERT && frame.contentState === 'ADVERT_PRESENT').length, 4);
});
