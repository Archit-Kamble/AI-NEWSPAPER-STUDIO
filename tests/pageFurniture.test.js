// Page furniture: the reserved corner of page one, and the foot of the page.
//
// Both were reported as visible defects - the top-left block "disappeared"
// and the newspaper's name expanded into its space, and the footer carried an
// unwanted line. Both turned out to be about ownership: who reserves a piece
// of the page, and what is entitled to be printed in it.

require('dotenv').config();
const test = require('node:test');
const assert = require('node:assert/strict');

const { geometryOf, regionsFor } = require('../src/layout/geometry');
const templates = require('../src/layout/templates');
const pageSectionService = require('../src/services/pageSection.service');

// --------------------------------------------------- the reserved corner ---

test('page one reserves its top-left corner in the region model, not in a block', () => {
  const g = geometryOf({});
  const front = regionsFor(g, 'front', 1);
  assert.ok(front.header.earWidthPx > 0, 'the front page must reserve an ear beside the nameplate');
  assert.ok(front.header.earGapPx > 0, 'and a gutter between it and the nameplate');

  const inside = regionsFor(g, 'inside', 3);
  assert.equal(inside.header.earWidthPx, 0, 'an inside page carries a folio and has no ear');
});

test('the reserved corner and the template block that fills it describe the SAME corner', () => {
  // Two files must not each have their own idea of where the corner is - that
  // is the drift that let the nameplate and the block disagree in the first
  // place.
  const front = templates.templates ? templates.templates.front : null;
  const list = (templates.templateList ? templates.templateList() : []).find((t) => t.key === 'front')
    || front;
  const block = (list?.sections || []).find((section) => section.key === 'masthead-advert');
  assert.ok(block, 'the front template must still ship the sold corner');

  const region = regionsFor(geometryOf({}), 'front', 1);
  assert.equal(block.width, region.header.earWidthPx,
    'the block that fills the corner must be exactly as wide as the corner the page reserves');
});

test('the reserved corner is published to the browser, so the nameplate can honour it', () => {
  // GET /api/geometry serves geometryOf({}), and the canvas reads
  // geometry.regions.front.header to place the nameplate. If the corner is not
  // in that payload the browser has nothing to reserve it with, and the name
  // expands into it exactly as it did before.
  const payload = geometryOf({});
  assert.ok(payload.regions.front.header.earWidthPx > 0);
  assert.equal(payload.regions.inside.header.earWidthPx, 0);
});

test('a frame the page reserves cannot be deleted', async () => {
  // The reported failure exactly: the corner block was removed, and nothing
  // stopped it. Emptying it is fine - an unsold corner prints blank - but the
  // frame itself is part of the page.
  const result = await pageSectionService.deleteSection(1, 'masthead-advert');
  assert.equal(result.error, 'STRUCTURAL_FRAME_PROTECTED');
  assert.equal(result.sectionKey, 'masthead-advert');
});

test('ordinary editorial frames are still freely deletable', async () => {
  // The protection must be narrow. A page whose blocks could not be removed
  // would be a worse tool than one whose furniture could.
  const result = await pageSectionService.deleteSection(-1, 'second-lead');
  assert.notEqual(result?.error, 'STRUCTURAL_FRAME_PROTECTED');
});
