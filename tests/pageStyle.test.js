// HOW A PAGE IS DRESSED, and the four things that must stay true about it.
//
// The desk's report was that this software fills a page but does not STYLE
// one. Nearly every device was already here; nothing chose them. These hold
// the choosing.

const test = require('node:test');
const assert = require('node:assert');

let styles;
test.before(async () => {
  styles = await import('../public/editor/layout/page-styles.js');
});

/** A page shape with real 6px grid gutters, as geometry.js sets them. */
const PAGE = [
  { section_key: 'lead', block_type: 'article', x_px: 20, y_px: 180, width_px: 400, height_px: 300 },
  { section_key: 'anchor', block_type: 'article', x_px: 426, y_px: 180, width_px: 214, height_px: 300 },
  { section_key: 'b1', block_type: 'article', x_px: 20, y_px: 488, width_px: 200, height_px: 200 },
  { section_key: 'b2', block_type: 'article', x_px: 226, y_px: 488, width_px: 200, height_px: 200 },
  { section_key: 'b3', block_type: 'article', x_px: 432, y_px: 488, width_px: 208, height_px: 200 },
  { section_key: 'ad', block_type: 'advert', x_px: 20, y_px: 696, width_px: 300, height_px: 150 },
  { section_key: 'card', block_type: 'feature', feature_key: 'panchang', smart_card_key: 'panchang', smart_card_data: { a: 1 }, x_px: 326, y_px: 696, width_px: 300, height_px: 150 },
];
const GEO = { gutterPx: 6, baselinePx: 8 };

// A rectangle pair that a reader's eye crosses without passing another story.
function touching(a, b) {
  const box = (s) => ({
    l: +s.x_px, t: +s.y_px, r: +s.x_px + +s.width_px, b: +s.y_px + +s.height_px,
  });
  const A = box(a); const B = box(b);
  const overlapsY = Math.min(A.b, B.b) - Math.max(A.t, B.t) > 0;
  const overlapsX = Math.min(A.r, B.r) - Math.max(A.l, B.l) > 0;
  return (overlapsY && Math.max(B.l - A.r, A.l - B.r) <= 8)
    || (overlapsX && Math.max(B.t - A.b, A.t - B.b) <= 10);
}

// THE WHOLE REASON THE ASSIGNMENT IS NOT PER BLOCK.
//
// Two touching stories on the same ground read as one story. A per-block
// choice cannot avoid it, because no block's call can see its neighbours -
// which is the argument for the page being dressed as a page.
test('no two blocks that touch wear the same hue', () => {
  for (const theme of ['world', 'sunday', 'feature', 'sport']) {
    const out = styles.styleForPage({ sections: PAGE, theme, geometry: GEO });
    const ink = new Map(out.map((one) => [one.sectionKey, one.patch.borderInk]));
    let pairs = 0;
    for (const a of PAGE) {
      for (const b of PAGE) {
        if (a.section_key >= b.section_key || !touching(a, b)) continue;
        pairs += 1;
        const x = ink.get(a.section_key);
        if (!x) continue;
        assert.notStrictEqual(x, ink.get(b.section_key),
          `${theme}: ${a.section_key} and ${b.section_key} touch and share ${x}`);
      }
    }
    assert.ok(pairs > 0, 'the fixture has touching pairs to test');
  }
});

// An advert is the advertiser's own design and a Smart Card draws its own
// nameplate and rule. Dressing either is this software painting over work that
// is already finished.
test('an advert and a Smart Card are never dressed', () => {
  for (const theme of styles.THEME_KEYS) {
    const out = styles.styleForPage({ sections: PAGE, theme, geometry: GEO });
    const keys = out.map((one) => one.sectionKey);
    assert.ok(!keys.includes('ad'), `${theme} dressed an advert`);
    assert.ok(!keys.includes('card'), `${theme} dressed a Smart Card`);
  }
});

// A front page is white with a tinted block or two; a feature page has a
// ground behind every story. A front page dressed like a feature page does not
// read as a front page - and its LEAD is never tinted, because it already
// shouts by size.
test('how much a page wears follows its theme, and a sober page spares the lead', () => {
  const dressed = (theme) => styles.styleForPage({ sections: PAGE, theme, geometry: GEO })
    .filter((one) => one.patch.backgroundColor);

  assert.strictEqual(dressed('plain').length, 0, 'plain dresses nothing');
  const front = dressed('front');
  const full = dressed('world');
  assert.ok(front.length >= 1 && front.length < full.length, 'a front page is more restrained than a feature page');
  // NOT every block, deliberately. Measured off the reference paper: even its
  // most decorated page is about half white (45-50% tinted area, its
  // photographs excluded). A page where everything carries a ground has no
  // plain copy left for the dressed blocks to stand against - which is what
  // the desk reported as "looking very saturated".
  assert.ok(full.length >= 2 && full.length < 5,
    `a feature page dresses some but not all of its stories, got ${full.length} of 5`);
  assert.ok(!front.some((one) => one.sectionKey === 'lead'),
    'the lead is not tinted on a sober page — it already shouts by size');
  assert.ok(full.some((one) => one.sectionKey === 'lead'),
    'but it is on a feature page — the reference leads its Sports page on a ground');
});

// Restyling a feature page as a front page has to take grounds OFF as well as
// put them on, or the page keeps yesterday's colours under today's theme. That
// is also what makes the button safe to press twice.
test('it covers every dressable block, so a restyle undresses as well as dresses', () => {
  const out = styles.styleForPage({ sections: PAGE, theme: 'plain', geometry: GEO });
  assert.strictEqual(out.length, 5, 'every story block is answered for, dressed or not');
  for (const one of out) {
    assert.strictEqual(one.patch.backgroundColor, null);
    assert.strictEqual(one.patch.borderInk, null);
    assert.strictEqual(one.patch.headlineInk, null);
    assert.strictEqual(one.patch.borderStyle, 'none');
    assert.strictEqual(one.patch.borderRadiusPx, 0);
  }
  // Idempotent: the same page and theme twice gives the same answer.
  const a = JSON.stringify(styles.styleForPage({ sections: PAGE, theme: 'world', geometry: GEO }));
  const b = JSON.stringify(styles.styleForPage({ sections: PAGE, theme: 'world', geometry: GEO }));
  assert.strictEqual(a, b);
});

// EVERY COLOUR A THEME CAN REACH IS ALREADY IN THE PALETTE.
//
// A hue family invents nothing: the ground is one of TINTS and the rule and
// the heading are ONE entry of INKS, so inkSeparation() can name every one of
// them in a .sla. A mixed shade would fall through to Black and the plate
// would print a black rule under a green heading.
test('a hue family is two catalogue entries, never a mixed colour', async () => {
  const inks = await import('../public/editor/layout/inks.js');
  for (const hue of styles.HUES) {
    assert.ok(hue.tint, `${hue.key} has no ground`);
    assert.ok(hue.ink, `${hue.key} has no ink`);
    assert.strictEqual(inks.sanitiseTint(hue.tint), hue.tint, `${hue.key}'s ground is not a palette tint`);
    assert.strictEqual(inks.sanitiseInk(hue.ink), hue.ink, `${hue.key}'s ink is not a palette ink`);
    assert.notStrictEqual(inks.tintSeparation(hue.tint), 'None', `${hue.key}'s ground has no separation`);
  }
  // And every theme only names hues that exist.
  const known = new Set(styles.HUE_KEYS);
  for (const theme of styles.PAGE_THEMES) {
    for (const key of theme.hues) {
      assert.ok(known.has(key), `theme ${theme.key} names a hue that does not exist: ${key}`);
    }
    assert.ok(styles.DECORATION[theme.decoration], `theme ${theme.key} has no decoration level`);
  }
});

// A theme decides a ground and a rule ink, both of which are interpolated into
// a style attribute. A name that has not been through this may never reach a
// renderer - the argument the tint palette already rests on.
test('a theme name is a closed set', () => {
  assert.strictEqual(styles.sanitiseTheme('world'), 'world');
  assert.strictEqual(styles.sanitiseTheme('../../etc/passwd'), null);
  assert.strictEqual(styles.sanitiseTheme('<script>'), null);
  assert.strictEqual(styles.sanitiseTheme(''), null);
  assert.strictEqual(styles.sanitiseTheme(null), null);
  assert.strictEqual(styles.sanitiseTheme(undefined), null);
});

// The guess is what dresses a paper with no AI configured, so it has to be
// conservative: a page over-dressed by a guess has already printed.
test('the derived theme is conservative, and page one is always the front', () => {
  assert.strictEqual(styles.guessTheme({ pageNumber: 1 }), 'front');
  assert.strictEqual(styles.guessTheme({ pageNumber: 1, tags: ['sports'] }), 'front');
  assert.strictEqual(styles.guessTheme({ pageNumber: 5, tags: ['sports', 'sports', 'local'] }), 'sport');
  assert.strictEqual(styles.guessTheme({ pageNumber: 5 }), 'city');
  assert.strictEqual(styles.guessTheme({ pageNumber: 8, pageCount: 8 }), 'feature');
});

// A radius may only be asked for where there is a rule on both edges of a
// corner. A single rule below has nothing to meet.
test('only a boxed block may round its corners', () => {
  const borders = require('../public/editor/layout/borders');
  assert.strictEqual(borders.canRound('box'), true);
  assert.strictEqual(borders.canRound('box-double'), true);
  assert.strictEqual(borders.canRound('rule'), false);
  assert.strictEqual(borders.canRound('none'), false);
  assert.strictEqual(borders.borderRadiusPx(-4), 0, 'a negative radius is square');
  assert.strictEqual(borders.borderRadiusPx(0), 0);
  assert.ok(borders.borderRadiusPx(1e9) <= borders.BORDER_RADII[borders.BORDER_RADII.length - 1].px,
    'a runaway radius is clamped to the ladder');
});
