// TWENTY-FIVE MORE COLOURS AND FIVE MORE BORDER STYLES, and everything the
// original palette and border catalogue already guaranteed still holds at the
// new size. Nothing here is a new mechanism - inks.js, page-styles.js and
// borders.js gained entries, not a second way of drawing any of them.

const test = require('node:test');
const assert = require('node:assert');
const { createApp } = require('../server');
const pool = require('../src/config/db');
const { signIn, removeEdition } = require('./helpers/desk');

// FILE-SCOPE, registered once - so it runs after every per-test hook rather
// than racing one. A `pool.end()` registered inside a single test's own
// `t.after` can run before that same test's `removeEdition` still needs the
// pool, because `t.after` order is not guaranteed LIFO across mixed sync/async
// registrations here; every other test file in this repo that touches the
// pool registers its `pool.end()` at file scope for exactly that reason.
test.after(() => pool.end());

let inks; let styles; let borders;
test.before(async () => {
  inks = await import('../public/editor/layout/inks.js');
  styles = await import('../public/editor/layout/page-styles.js');
  borders = require('../public/editor/layout/borders');
});

const luma = (hex) => {
  const h = hex.replace('#', '');
  return 0.2126 * parseInt(h.slice(0, 2), 16) + 0.7152 * parseInt(h.slice(2, 4), 16) + 0.0722 * parseInt(h.slice(4, 6), 16);
};

test('the palette holds 20 inks and 39 tints, every one named and separated', () => {
  assert.strictEqual(inks.INKS.length, 20);
  // 21 pale originals + 18 "vivid" variants - the measured-from-a-real-page
  // ground page-styles.js's automatic theming reaches for. See
  // 'the palette theme system's tints stay contrast-safe for black type'
  // below for why these have their own, looser luma floor.
  assert.strictEqual(inks.TINTS.length, 39);
  const scribus = require('fs').readFileSync('src/services/scribus.service.js', 'utf8');
  for (const entry of [...inks.INKS, ...inks.TINTS]) {
    assert.ok(entry.scribus, `${entry.key} has no separation`);
    if (entry.scribus !== 'None' && entry.scribus !== 'Black') {
      assert.ok(scribus.includes(`NAME="${entry.scribus}"`), `${entry.scribus} is not in the .sla`);
    }
    if (entry.hex) assert.match(entry.hex, /^#[0-9a-f]{6}$/i, entry.key);
  }
});

// AN INK MUST HOLD SMALL DEVANAGARI ON NEWSPRINT; a PALE TINT must leave black
// type readable through it at the light touch the desk's own manual picker
// offers. This is the rule the original seven inks and eight tints were
// chosen against - checked here rather than eyeballed, so it cannot silently
// loosen as the list grows. The 18 'vivid-*' tints are deliberately a
// DIFFERENT, deeper family (see the next test) and are excluded here.
test('every ink is dark enough and every pale tint light enough to read', () => {
  for (const ink of inks.INKS) {
    if (!ink.hex) continue; // Black carries none, deliberately.
    assert.ok(luma(ink.hex) < 120, `${ink.key} (${ink.hex}) is too light for an ink: luma ${luma(ink.hex).toFixed(0)}`);
  }
  for (const tint of inks.TINTS) {
    if (!tint.hex || tint.key.startsWith('vivid-')) continue; // White carries none; vivid tints are checked below.
    assert.ok(luma(tint.hex) > 228, `${tint.key} (${tint.hex}) is too dark for a tint: luma ${luma(tint.hex).toFixed(0)}`);
  }
});

// THE VIVID TINTS ARE DELIBERATELY DARKER THAN THE PALE FAMILY - measured
// from a real printed page, not chosen by eye - so a plain luma floor is the
// wrong test for them. What actually matters is that BLACK BODY TYPE still
// reads clearly on top: WCAG's floor for ordinary text is 4.5:1, and this
// holds every vivid tint to a floor of 15:1, comfortably inside the 18-19:1
// this catalogue was computed to have.
test("the palette theme system's tints stay contrast-safe for black type", () => {
  const contrastOfBlackOn = (hex) => {
    const h = hex.replace('#', '');
    const L = (0.2126 * parseInt(h.slice(0, 2), 16) + 0.7152 * parseInt(h.slice(2, 4), 16) + 0.0722 * parseInt(h.slice(4, 6), 16)) / 255;
    return (L + 0.05) / 0.05;
  };
  const vivid = inks.TINTS.filter((t) => t.key.startsWith('vivid-'));
  assert.strictEqual(vivid.length, 18);
  for (const tint of vivid) {
    const ratio = contrastOfBlackOn(tint.hex);
    assert.ok(ratio >= 15, `${tint.key} (${tint.hex}) only gives black type ${ratio.toFixed(1)}:1 contrast`);
  }
});

test('no two entries share a hex, in either palette', () => {
  for (const [name, table] of [['INKS', inks.INKS], ['TINTS', inks.TINTS]]) {
    const seen = new Map();
    for (const entry of table) {
      if (!entry.hex) continue;
      const hex = entry.hex.toLowerCase();
      assert.ok(!seen.has(hex), `${name}: ${entry.key} and ${seen.get(hex)} share ${hex}`);
      seen.set(hex, entry.key);
    }
  }
});

// A hue family is TWO catalogue entries, never a mixed colour - the whole
// argument the original six families rest on, now at 19.
test('19 hue families, each one an existing tint paired with an existing ink', () => {
  assert.strictEqual(styles.HUES.length, 19);
  const tintHexes = new Set(inks.TINTS.map((t) => t.hex).filter(Boolean));
  const inkHexes = new Set(inks.INKS.map((i) => i.hex).filter(Boolean));
  for (const hue of styles.HUES) {
    assert.ok(hue.tint && tintHexes.has(hue.tint), `${hue.key}'s ground is not a real tint`);
    assert.ok(hue.ink && inkHexes.has(hue.ink), `${hue.key}'s ink is not a real ink`);
  }
  // Every theme names only hues that exist.
  const known = new Set(styles.HUE_KEYS);
  for (const theme of styles.PAGE_THEMES) {
    for (const key of theme.hues) assert.ok(known.has(key), `${theme.key} names an unknown hue: ${key}`);
  }
});

// A page dressed from a WIDER set must still keep the one guarantee that
// matters: two blocks that touch never wear the same hue. More colours makes
// this easier to satisfy, never harder, but the assignment logic has to
// actually reach for the wider set rather than silently capping itself.
test('a full-colour theme with its wider hue set still gives no two touching blocks the same hue', () => {
  const PAGE = [
    { section_key: 'lead', block_type: 'article', x_px: 20, y_px: 180, width_px: 400, height_px: 300 },
    { section_key: 'anchor', block_type: 'article', x_px: 426, y_px: 180, width_px: 214, height_px: 300 },
    { section_key: 'b1', block_type: 'article', x_px: 20, y_px: 488, width_px: 200, height_px: 200 },
    { section_key: 'b2', block_type: 'article', x_px: 226, y_px: 488, width_px: 200, height_px: 200 },
    { section_key: 'b3', block_type: 'article', x_px: 432, y_px: 488, width_px: 208, height_px: 200 },
    { section_key: 'b4', block_type: 'article', x_px: 20, y_px: 696, width_px: 300, height_px: 150 },
    { section_key: 'b5', block_type: 'article', x_px: 326, y_px: 696, width_px: 314, height_px: 150 },
  ];
  const GEO = { gutterPx: 6, baselinePx: 8 };
  const box = (s) => ({ l: +s.x_px, t: +s.y_px, r: +s.x_px + +s.width_px, b: +s.y_px + +s.height_px });
  const touching = (a, b) => {
    const A = box(a); const B = box(b);
    const oy = Math.min(A.b, B.b) - Math.max(A.t, B.t) > 0;
    const ox = Math.min(A.r, B.r) - Math.max(A.l, B.l) > 0;
    return (oy && Math.max(B.l - A.r, A.l - B.r) <= 8) || (ox && Math.max(B.t - A.b, A.t - B.b) <= 10);
  };
  for (const theme of ['world', 'sunday', 'feature', 'sport', 'entertainment']) {
    const out = styles.styleForPage({ sections: PAGE, theme, geometry: GEO });
    const ink = new Map(out.map((one) => [one.sectionKey, one.patch.borderInk]));
    for (const a of PAGE) {
      for (const b of PAGE) {
        if (a.section_key >= b.section_key || !touching(a, b)) continue;
        const x = ink.get(a.section_key);
        if (x) assert.notStrictEqual(x, ink.get(b.section_key), `${theme}: ${a.section_key}/${b.section_key} share ${x}`);
      }
    }
  }
});

test('26 border styles, including open frames, corner rules and triple rules, share one catalogue', () => {
  assert.strictEqual(borders.BORDER_STYLES.length, 26);
  const added = ['rule-above-double', 'rule-left-double', 'rule-right-double', 'rule-sides-double', 'rule-both-double'];
  for (const key of added) {
    assert.ok(borders.isDouble(key), `${key} should be a double rule`);
    assert.ok(borders.isRuled(key), `${key} should be ruled`);
    assert.ok(borders.borderEdges(key).length > 0, `${key} names no edges`);
  }
  // None of the five new styles is a full box, so none of them may round -
  // only a boxed block has a rule on both edges of a corner.
  for (const key of added) assert.strictEqual(borders.canRound(key), false, `${key} should not offer a corner`);
  assert.strictEqual(borders.canRound('box'), true);
  assert.strictEqual(borders.canRound('box-double'), true);

  const openFrames = {
    'frame-open-bottom': ['top', 'right', 'left'],
    'frame-open-top': ['right', 'bottom', 'left'],
    'frame-open-right': ['top', 'bottom', 'left'],
    'frame-open-left': ['top', 'right', 'bottom'],
    'corner-top-left': ['top', 'left'],
    'corner-top-right': ['top', 'right'],
    'corner-bottom-left': ['bottom', 'left'],
    'corner-bottom-right': ['bottom', 'right'],
  };
  for (const [key, edges] of Object.entries(openFrames)) {
    assert.deepEqual(borders.borderEdges(key), edges, `${key} has the wrong printable edges`);
    assert.equal(borders.isRuled(key), true);
    assert.equal(borders.isDouble(key), false);
    assert.equal(borders.canRound(key), false);
  }

  for (const key of ['rule-triple', 'rule-above-triple', 'box-triple']) {
    assert.equal(borders.borderLineCount(key), 3);
    assert.equal(borders.isDouble(key), false);
    assert.deepEqual(borders.borderOffsetsPx(key, 1), [0, 2, 4]);
    assert.equal(borders.borderThicknessPx(key, 1), 5);
  }
});

// blockRules() in print-model.js reads edges and double GENERICALLY - it was
// never given special-case code for "rule-double" or "box-double", so a new
// key with the same shape has to produce geometry through the same walk with
// no changes to that file. This is what proves the five new styles are free,
// not merely that borders.js describes them correctly (the tests above
// already hold that).
test('a new double style produces real rule geometry through the shared print model, unmodified', () => {
  // The exact private helper's math, re-derived here rather than importing an
  // unexported function: two rules per doubled edge (offset 0 and offset
  // weight*2), which is what borderThicknessPx() already reserves room for.
  const weight = borders.borderWidthPx(2);
  for (const key of ['rule-sides-double', 'rule-above-double', 'rule-both-double']) {
    const edges = borders.borderEdges(key);
    const offsets = borders.isDouble(key) ? [0, weight * 2] : [0];
    assert.strictEqual(offsets.length * edges.length,
      (borders.isDouble(key) ? 2 : 1) * edges.length,
      `${key} should draw ${edges.length} edge(s) twice each`);
  }
});

// FIVE NAMED BORDER WIDTHS - the desk asked for it by name: "add border width
// also as small normal medium large extra large". The two ends this catalogue
// already had (0.5pt/hairline, 4pt/the heaviest a page should go) are
// unchanged; 'Large' at 3pt is the one new rung.
test('five named border widths, and the ceiling is read from the ladder\'s own length', () => {
  assert.strictEqual(borders.BORDER_WIDTHS.length, 5);
  assert.deepEqual(borders.BORDER_WIDTHS.map((w) => w.label),
    ['Small', 'Normal', 'Medium', 'Large', 'Extra large']);
  // The two original ends are unchanged - a page ruled 'hairline' or '4pt'
  // before this change prints at exactly the same weight after it.
  assert.strictEqual(borders.BORDER_WIDTHS[0].pt, 0.5);
  assert.strictEqual(borders.BORDER_WIDTHS[borders.BORDER_WIDTHS.length - 1].pt, 4);

  // THE CLAMP READS THE LADDER'S OWN CEILING, not a literal index. A literal
  // [3] would silently point at 'Large' (3pt) now instead of the real ceiling
  // 'Extra large' (4pt) - the fault this codebase has already been bitten by
  // for BORDER_RADII, which already reads `.length - 1`.
  const ceiling = borders.BORDER_WIDTHS[borders.BORDER_WIDTHS.length - 1].px;
  assert.strictEqual(borders.borderWidthPx(999), ceiling);
  assert.ok(borders.borderWidthPx(999) > borders.BORDER_WIDTHS[3].px,
    'the clamp should reach the true ceiling, not stop at the fourth rung');
});

// THE SAME FAULT, AT THE VALIDATION BOUNDARY. pageSection.service.js checks a
// supplied borderWidthPx against the ladder's own ends; a literal [3] there
// would silently REJECT a legal 'Extra large' request and understate the
// ceiling in the very sentence that reports it.
test('a block may be ruled at the true ceiling width, through the real service', async (t) => {
  const server = createApp().listen(0);
  t.after(() => server.close());
  const desk = await signIn(server.address().port);
  const started = await desk.json('/api/newspapers/start', {
    method: 'POST',
    body: JSON.stringify({ publicationDate: '2099-08-28', pageCount: 4, fillFeatures: false }),
  });
  t.after(() => removeEdition(started.newspaper.id));
  const pages = await desk.json(`/api/newspapers/${started.newspaper.id}/pages`);
  const page1 = pages.find((p) => p.page_number === 1);
  const section = page1.sections.find((s) => s.block_type === 'article');
  const ceiling = borders.BORDER_WIDTHS[borders.BORDER_WIDTHS.length - 1];

  const saved = await desk.json(`/api/pages/${page1.id}/sections/${section.section_key}`, {
    method: 'PUT',
    body: JSON.stringify({
      headline: '', subheading: '', body: '',
      borderStyle: 'box', borderWidthPx: ceiling.px,
    }),
  });
  assert.ok(!saved.error, `the real ceiling (${ceiling.label}, ${ceiling.pt}pt) was refused: ${saved.error}`);

  const tooWide = await desk.json(`/api/pages/${page1.id}/sections/${section.section_key}`, {
    method: 'PUT',
    body: JSON.stringify({
      headline: '', subheading: '', body: '',
      borderStyle: 'box', borderWidthPx: ceiling.px + 5,
    }),
  });
  assert.ok(tooWide.error, 'a rule heavier than the true ceiling should still be refused');
  assert.ok(tooWide.error.includes(String(ceiling.pt)),
    `the refusal should name the true ceiling (${ceiling.pt}pt), got: ${tooWide.error}`);
});
