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

// A DESK-MADE PAGE, because a template no longer ships a standing card.
//
// The four purposes this machinery exists to keep apart are STANDING_FEATURE,
// UTILITY, IMAGE_COMPANION and ADVERT, and until the templates stopped
// reserving frames for the almanac and the Sudoku, the standard four pages
// exercised all four for free. They now exercise two, so the other two get a
// page built the way a desk builds one: Properties -> Standing feature on an
// ordinary block, which is the only path that reaches them any more.
function deskFeaturePage() {
  return {
    id: 9, page_number: 9, template_key: 'local',
    sections: [
      { id: '9:almanac', section_key: 'almanac', z_index: 0, block_type: 'feature',
        story_type: 'SMART_CARD', feature_key: 'panchang', headline: '', body: '', status: 'empty', images: [] },
      { id: '9:horoscope', section_key: 'horoscope', z_index: 1, block_type: 'feature',
        story_type: 'SMART_CARD', feature_key: 'rashi', headline: '', body: '', status: 'empty', images: [] },
      { id: '9:puzzle', section_key: 'puzzle', z_index: 2, block_type: 'feature',
        story_type: 'SMART_CARD', feature_key: 'sudoku', headline: '', body: '', status: 'empty', images: [] },
    ],
  };
}

test('every standard four-page frame has one explicit canonical owner', () => {
  const manifest = buildEditionContentManifest(standardPages());
  assert.equal(manifest.physicalFrameCount, 42);
  assert.deepEqual(manifest.framePurposeCounts, {
    EDITORIAL_STORY: 35, IMAGE_COMPANION: 3, STANDING_FEATURE: 0,
    ADVERT: 4, FIXED_FURNITURE: 0, UTILITY: 0, OPTIONAL_RESERVED: 0,
  });
  assert.equal(manifest.unknownPurposeCount, 0);
  assert.equal(manifest.ambiguousPurposeCount, 0);
  assert.equal(manifest.frames.every((frame) => frame.explicit), true);
});

test('editorial demand derives from ownership and includes a DATA article without consuming auxiliaries', () => {
  const pages = standardPages();
  const demand = pages.flatMap((page) => eligibleEditorialFrames(page).map((frame) => `${page.page_number}:${frame.section_key}`));
  assert.equal(demand.length, 35);
  assert.ok(demand.includes('3:feature-three'), 'DATA is an occupant recommendation, not a non-editorial purpose');
  // A picture companion and an advert are still not editorial demand. The
  // standing cards are simply not on these pages any more.
  for (const excluded of ['1:lead-pictures','1:lead-side','3:feature-photo','1:top-advert','1:masthead-advert']) assert.equal(demand.includes(excluded), false, excluded);
  // And a desk-made feature block is excluded on its purpose, exactly as a
  // template-declared one used to be.
  const deskDemand = eligibleEditorialFrames(deskFeaturePage()).map((frame) => frame.section_key);
  assert.deepEqual(deskDemand, [], 'a block a desk named a standing feature is not editorial demand');
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
  const pages = standardPages();
  const desk = deskFeaturePage();
  for (const key of ['almanac', 'horoscope']) {
    const section = desk.sections.find((s) => s.section_key === key);
    section.headline = key; section.body = 'मजकूर';
    section.smart_card_key = key === 'almanac' ? 'panchang' : 'rashi';
    section.smart_card_data = { items: [] }; section.status = 'ready';
  }
  const sudoku = desk.sections.find((s) => s.section_key === 'puzzle');
  sudoku.smart_card_key = 'sudoku';
  sudoku.smart_card_data = { grid: Array.from({ length: 9 }, () => Array(9).fill(0)) };
  sudoku.status = 'ready';
  for (const page of pages) for (const section of page.sections) if (section.block_type === 'advert') section.headline = 'जाहिरात';
  const manifest = buildEditionContentManifest([...pages, desk]);
  assert.equal(manifest.frames.filter((frame) => frame.purpose === PURPOSE.STANDING_FEATURE && frame.contentState === 'FEATURE_READY').length, 2);
  assert.equal(manifest.frames.find((frame) => frame.purpose === PURPOSE.UTILITY).contentState, 'UTILITY_READY');
  assert.equal(manifest.frames.filter((frame) => frame.purpose === PURPOSE.ADVERT && frame.contentState === 'ADVERT_PRESENT').length, 4);
});
