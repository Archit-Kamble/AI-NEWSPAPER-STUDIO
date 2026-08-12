const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { geometryOf, HEADER, FOOTER, regionForPage } = require('../src/layout/geometry');
const { getTemplateForPage } = require('../src/layout/templates');

const css = fs.readFileSync(path.join(__dirname, '..', 'public', 'styles.css'), 'utf8');

function rule(selector) {
  const start = css.indexOf(`${selector} {`);
  assert.notEqual(start, -1, `${selector} CSS exists`);
  return css.slice(start, css.indexOf('}', start));
}

test('masthead, folio, footer, and legal imprint use bounded Devanagari-safe line boxes', () => {
  for (const selector of ['.masthead-strip', '.masthead-ear', '.folio-title', '.foot-printline', '.foot-page', '.masthead-owner', '.page-imprint']) {
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
  assert.equal(HEADER.mastheadClearancePx, 8);
  assert.equal(HEADER.folioHeightPx, 32);
  assert.equal(HEADER.folioContentGapPx, 8);
  assert.equal(FOOTER.footHeightPx, 20);
  assert.equal(FOOTER.contentFooterGapPx, 8);
  assert.equal(regionForPage(g, 2).footer.imprintHeightPx, 32);
  assert.equal(regionForPage(g, 1).footer.imprintHeightPx, 0);
  assert.equal(regionForPage(g, 3).footer.imprintHeightPx, 0);
});

test('Page 2 templates stop at its smaller imprint-aware editorial boundary without changing frame roles', () => {
  const g = geometryOf({});
  const normal = getTemplateForPage('local', 3);
  const imprint = getTemplateForPage('local', 2);
  const imprintBottom = regionForPage(g, 2).content.bottom;
  assert.deepEqual(normal.sections.map((s) => s.key), imprint.sections.map((s) => s.key));
  for (const section of imprint.sections) assert.ok(section.y + section.height <= imprintBottom, section.key);
});

test('masthead source asset remains the same readable RGBA canvas after isolated-dot cleanup', async () => {
  const asset = path.join(__dirname, '..', 'public', 'assets', 'masthead', 'sahas-nameplate.png');
  const { Jimp } = await import('jimp'); const image = await Jimp.read(asset);
  assert.equal(image.bitmap.width, 1600); assert.equal(image.bitmap.height, 300);
  assert.equal(image.bitmap.data.length, 1600 * 300 * 4);
});
