const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { geometryOf, HEADER, FOOTER, PAGE_FURNITURE_GAP_PX, regionForPage } = require('../src/layout/geometry');
const { getTemplateForPage, comparePageGeometryToTemplate } = require('../src/layout/templates');

const css = fs.readFileSync(path.join(__dirname, '..', 'public', 'styles.css'), 'utf8');

function rule(selector) {
  const start = css.indexOf(`${selector} {`);
  assert.notEqual(start, -1, `${selector} CSS exists`);
  return css.slice(start, css.indexOf('}', start));
}

test('masthead, folio, footer, and legal imprint use bounded Devanagari-safe line boxes', () => {
  for (const selector of ['.masthead-strip', '.masthead-ear', '.folio-title', '.foot-title', '.foot-date', '.foot-page', '.masthead-owner', '.page-imprint']) {
    assert.match(rule(selector), /line-height:\s*var\(--devanagari-line\)/, `${selector} is Devanagari-safe`);
  }
  assert.match(rule('.page-masthead'), /height:\s*120px/);
  assert.match(rule('.page-masthead'), /overflow:\s*hidden/);
  assert.match(rule('.page-folio'), /height:\s*32px/);
  assert.match(rule('.page-imprint'), /overflow:\s*hidden/);
});

test('canonical furniture reserves compact header/footer space with Page-2-only legal imprint', () => {
  const g = geometryOf({});
  assert.equal(HEADER.mastheadHeightPx, 120);
  assert.equal(HEADER.mastheadClearancePx, PAGE_FURNITURE_GAP_PX);
  assert.equal(HEADER.folioHeightPx, 32);
  assert.equal(HEADER.folioContentGapPx, PAGE_FURNITURE_GAP_PX);
  assert.equal(FOOTER.footHeightPx, 28);
  assert.equal(FOOTER.contentFooterGapPx, PAGE_FURNITURE_GAP_PX);
  assert.equal(regionForPage(g, 2).footer.imprintHeightPx, 40);
  assert.equal(regionForPage(g, 1).footer.imprintHeightPx, 0);
  assert.equal(regionForPage(g, 3).footer.imprintHeightPx, 0);
});

test('permanent Marathi footer has bounded Devanagari-safe child boxes and a 4px editorial gutter', () => {
  const g = geometryOf({});
  const foot = rule('.page-foot');
  assert.match(foot, /overflow:\s*hidden/);
  assert.doesNotMatch(foot, /border-top/);
  // The foot carries the paper, the date and the page number. The Act
  // printline used to set here too; it belongs to the page-two imprint,
  // which already prints it, and on every page it read as an unwanted rule.
  assert.match(rule('.foot-title'), /font-size:\s*9px/);
  assert.match(rule('.foot-page'), /font-size:\s*9px/);
  for (const selector of ['.foot-title', '.foot-date', '.foot-page']) {
    assert.match(rule(selector), /padding:\s*2px 0/);
    assert.match(rule(selector), /box-sizing:\s*border-box/);
  }
  for (const region of [regionForPage(g, 1), regionForPage(g, 3), regionForPage(g, 4)]) {
    assert.equal(region.footer.footHeightPx, 28);
    assert.equal(region.footer.footTop - region.content.bottom, 4);
  }
});

test('one canonical furniture gap governs masthead, folio, footer, and imprint boundaries', () => {
  const g = geometryOf({});
  assert.equal(PAGE_FURNITURE_GAP_PX, 4);
  assert.equal(regionForPage(g, 1).content.top, 144);
  assert.equal(regionForPage(g, 2).content.top, 56);
  assert.equal(regionForPage(g, 3).content.top, 56);
  assert.equal(regionForPage(g, 4).content.top, 56);
  for (const pageNumber of [1, 3, 4]) {
    const region = regionForPage(g, pageNumber);
    assert.equal(region.footer.footTop - region.content.bottom, PAGE_FURNITURE_GAP_PX);
  }
  assert.equal(regionForPage(g, 2).footer.imprintTop - regionForPage(g, 2).content.bottom, PAGE_FURNITURE_GAP_PX);
});

test('footer redistribution preserves ordinary and imprint-page editorial reservation', () => {
  const g = geometryOf({});
  assert.equal(regionForPage(g, 1).content.bottom, 1008);
  assert.equal(regionForPage(g, 3).content.bottom, 1008);
  // Five lines, not four: the two declaration lines, the two English ones and
  // the standing AI disclosure (identity.js's aiDisclosure). The band grew by
  // one line and page two's editorial region gave up that line - a disclosure
  // a band with `overflow: hidden` silently swallowed would be worse than no
  // disclosure at all.
  assert.equal(regionForPage(g, 2).content.bottom, 964);
  assert.equal(regionForPage(g, 2).footer.imprintTop, 968);
  assert.equal(regionForPage(g, 2).footer.footTop, 1012);
});

test('Page 2 templates stop at its smaller imprint-aware editorial boundary without changing frame roles', () => {
  const g = geometryOf({});
  const normal = getTemplateForPage('local', 3);
  const imprint = getTemplateForPage('local', 2);
  const imprintBottom = regionForPage(g, 2).content.bottom;
  assert.deepEqual(normal.sections.map((s) => s.key), imprint.sections.map((s) => s.key));
  for (const section of imprint.sections) assert.ok(section.y + section.height <= imprintBottom, section.key);
});

test('legacy final template rows reconcile to each page’s current bottom boundary without section-key rules', () => {
  const { reconcileSectionsForPage } = require('../src/layout/templates');
  const g = geometryOf({});
  const rows = [
    { section_key: 'any-top-frame', y_px: 64, height_px: 100 },
    { section_key: 'any-final-frame', y_px: 800, height_px: 192 },
  ];
  const reconciled = reconcileSectionsForPage(rows, 3);
  assert.equal(reconciled[0].height_px, 100);
  assert.equal(reconciled[1].y_px + reconciled[1].height_px, regionForPage(g, 3).content.bottom);
});

test('Page-1 legacy editorial rows rebase together to the compact canonical masthead boundary', () => {
  const { reconcileSectionsForPage } = require('../src/layout/templates');
  const g = geometryOf({});
  const reconciled = reconcileSectionsForPage([
    { section_key: 'template-first', y_px: 168, height_px: 120 },
    { section_key: 'template-last', y_px: 880, height_px: 112 },
  ], 1);
  assert.equal(reconciled[0].y_px, regionForPage(g, 1).content.top);
  assert.equal(reconciled[1].y_px + reconciled[1].height_px, regionForPage(g, 1).content.bottom);
});

test('masthead source asset remains the same readable RGBA canvas after isolated-dot cleanup', async () => {
  const asset = path.join(__dirname, '..', 'public', 'assets', 'masthead', 'sahas-nameplate.png');
  const { Jimp } = await import('jimp'); const image = await Jimp.read(asset);
  assert.equal(image.bitmap.width, 1600); assert.equal(image.bitmap.height, 300);
  assert.equal(image.bitmap.data.length, 1600 * 300 * 4);
});

test('geometry drift reports persisted/template differences rather than pretending a template moved an existing page', () => {
  const template = { sections: [{ key: 'one', x: 20, y: 64, width: 100, height: 120 }] };
  assert.equal(comparePageGeometryToTemplate([{ section_key: 'one', x_px: 20, y_px: 80, width_px: 100, height_px: 120 }], template).status, 'MISMATCH');
  assert.equal(comparePageGeometryToTemplate([{ section_key: 'one', x_px: 20, y_px: 64, width_px: 100, height_px: 120 }], template).status, 'MATCH');
});


// ----------------------------------------- the reserved corner of page one ---
//
// The top-left block "disappeared" and the newspaper's name expanded into its
// space. The corner was reserved only in the sense that the front template
// shipped a block at those coordinates, so deleting the block did not leave an
// empty corner - it let the nameplate have it.

const { regionsFor } = require('../src/layout/geometry');
const templates = require('../src/layout/templates');

test('page one reserves its top-left corner in the region model, not in a block', () => {
  const g = geometryOf({});
  const front = regionsFor(g, 'front', 1);
  assert.ok(front.header.earWidthPx > 0, 'the front page must reserve an ear beside the nameplate');
  assert.ok(front.header.earGapPx > 0, 'and a gutter between it and the nameplate');
  assert.equal(regionsFor(g, 'inside', 3).header.earWidthPx, 0, 'an inside page carries a folio and has no ear');
});

test('the reserved corner and the template block that fills it describe the SAME corner', () => {
  // Two files must not each have their own idea of where the corner is - that
  // is the drift that let the nameplate and the block disagree to begin with.
  const front = getTemplateForPage(1, 'front') || getTemplateForPage(1);
  const block = (front?.sections || []).find((section) => section.key === 'masthead-advert');
  assert.ok(block, 'the front template must still ship the sold corner');
  assert.equal(block.width, regionsFor(geometryOf({}), 'front', 1).header.earWidthPx,
    'the block that fills the corner must be exactly as wide as the corner the page reserves');
});

test('a frame the page reserves cannot be deleted, and ordinary frames still can', () => {
  // The reported failure exactly: the corner block was removed and nothing
  // stopped it. Emptying it stays fine - an unsold corner prints blank.
  // Classification now lives in templates.js (the one catalog of section
  // keys, per its own module comment) - pageSection.service.js's deletion
  // guard and page.repository.js's structural repair both read the same
  // function, rather than each keeping a local copy of the key set.
  assert.equal(templates.isStructuralTemplateFrame('masthead-advert'), true);
  assert.equal(templates.isStructuralTemplateFrame({ key: 'masthead-advert' }), true);
  assert.equal(templates.isStructuralTemplateFrame({ section_key: 'masthead-advert' }), true);

  // The protection must stay narrow. A page whose blocks could not be removed
  // would be a worse tool than one whose furniture could.
  for (const key of ['second-lead', 'lead', 'anchor', 'top-advert', 'brief-one']) {
    assert.equal(templates.isStructuralTemplateFrame(key), false, `${key} must stay deletable`);
  }
});
