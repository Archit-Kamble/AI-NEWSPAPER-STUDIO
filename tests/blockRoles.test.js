// A BLOCK'S ROLE, AND THE GRID FAULT IT WAS WRITTEN FOR.
//
// The desk's report was that a dressed page looks "very saturated". Measured
// on this newspaper's own page four, that was not what was wrong: the styler
// ordered blocks by AREA and dressed the top share, and area cannot rank
// equals - so on a run of eight blocks all 150x176 it tinted two of them,
// chosen by nothing but sort stability, and left six plain.
//
// Two coloured cells in a run of eight is worse than none and worse than
// eight, because a reader looks for the pattern and there is not one. The
// first test below fails against that code with exactly that diagnosis.

const test = require('node:test');
const assert = require('node:assert/strict');

let roles;
let styles;
test.before(async () => {
  roles = await import('../public/editor/layout/block-roles.js');
  styles = await import('../public/editor/layout/page-styles.js');
});

const GEO = { gutterPx: 6, baselinePx: 8 };

/** The same predicate page-styles.js uses - two blocks the eye crosses. */
function touching(a, b) {
  const box = (s) => ({
    l: Number(s.x_px), t: Number(s.y_px),
    r: Number(s.x_px) + Number(s.width_px), b: Number(s.y_px) + Number(s.height_px),
  });
  const A = box(a); const B = box(b);
  const oy = Math.min(A.b, B.b) - Math.max(A.t, B.t) > 0;
  const ox = Math.min(A.r, B.r) - Math.max(A.l, B.l) > 0;
  return (oy && Math.max(B.l - A.r, A.l - B.r) <= 8) || (ox && Math.max(B.t - A.b, A.t - B.b) <= 10);
}

// This newspaper's own page four, to the pixel: an anchor, two half-width
// stories, and a RUN OF EIGHT equal blocks - 150 and 151 wide, a pixel apart
// because the column grid does not divide evenly, which is the case an exact
// size match would see as two runs.
const article = (key, x, y, w, h, body = 'x'.repeat(700)) =>
  ({ section_key: key, block_type: 'article', x_px: x, y_px: y, width_px: w, height_px: h, body });

const GRID_PAGE = [
  article('anchor', 20, 180, 307, 296),
  article('second-lead', 333, 180, 307, 144),
  article('shoulder', 333, 332, 307, 144),
  article('col-one-a', 20, 484, 151, 176),
  article('col-two-a', 177, 484, 150, 176),
  article('col-three-a', 333, 484, 151, 176),
  article('col-four-a', 490, 484, 150, 176),
  article('col-one-b', 20, 668, 151, 176),
  article('col-two-b', 177, 668, 150, 176),
  article('col-three-b', 333, 668, 151, 176),
  article('col-four-b', 490, 668, 150, 176),
];

const GRID_KEYS = GRID_PAGE.filter((s) => s.section_key.startsWith('col-')).map((s) => s.section_key);

// ------------------------------------------------------------ the catalogue ---

test('a run of three or more equal blocks is one grid; two is a pair', () => {
  const sets = roles.gridSets(GRID_PAGE);
  assert.strictEqual(sets.size, 1, 'the eight col-* blocks are one run, and nothing else is');
  const [members] = [...sets.values()];
  assert.strictEqual(members.length, 8);
  // A PIXEL APART IS THE SAME SIZE. 150 and 151 both belong to this run.
  assert.deepEqual(members.map((m) => m.section_key).sort(), [...GRID_KEYS].sort());

  // second-lead and shoulder are the same size as each other and there are
  // only two of them - a pair, which carries no implication about dressing.
  const pair = roles.gridSets([GRID_PAGE[1], GRID_PAGE[2]]);
  assert.strictEqual(pair.size, 0, 'two equal blocks are a pair, not a run');
});

test('the lead is the largest block that is NOT a grid cell', () => {
  const map = roles.rolesForPage(GRID_PAGE, touching);
  assert.strictEqual(map.get('anchor'), 'lead');
  for (const key of GRID_KEYS) {
    assert.strictEqual(map.get(key), 'grid', `${key} should be a grid cell`);
  }
});

test('a small block standing beside a much larger one is a sidebar, not a brief', () => {
  const page = [
    article('lead', 20, 180, 400, 300),
    article('side', 426, 180, 120, 150, 'x'.repeat(300)),
  ];
  const map = roles.rolesForPage(page, touching);
  assert.strictEqual(map.get('lead'), 'lead');
  assert.strictEqual(map.get('side'), 'sidebar',
    'a short block beside the lead is the चौकट - standing against a big story is the stronger signal');

  // The SAME block with nothing large beside it is only a brief.
  const alone = [
    article('lead', 20, 180, 400, 300),
    article('far', 20, 900, 120, 150, 'x'.repeat(300)),
  ];
  assert.strictEqual(roles.rolesForPage(alone, touching).get('far'), 'brief');
});

test('a briefs block is a brief whatever size frame it is given', () => {
  const page = [
    article('lead', 20, 180, 400, 300),
    { section_key: 'shorts', block_type: 'briefs', x_px: 20, y_px: 900, width_px: 400, height_px: 300, body: 'x'.repeat(3000) },
  ];
  assert.strictEqual(roles.rolesForPage(page, touching).get('shorts'), 'brief');
});

test('units are ranked by the CALLER\'s role order, so one page may want its lead first and another its sidebar', () => {
  const map = roles.rolesForPage(GRID_PAGE, touching);
  const leadFirst = roles.groundUnits(GRID_PAGE, map, ['lead', 'grid', 'secondary']);
  const gridFirst = roles.groundUnits(GRID_PAGE, map, ['grid', 'lead', 'secondary']);
  assert.strictEqual(leadFirst[0].role.key, 'lead');
  assert.strictEqual(gridFirst[0].role.key, 'grid');
  // A ROLE CARRIES NO RANK OF ITS OWN - one rank could not say both.
  for (const role of roles.BLOCK_ROLES) {
    assert.ok(!('order' in role), `${role.key} carries its own rank, which is a second authority on priority`);
    assert.ok(!('ground' in role), `${role.key} decides its own tint, which is a second authority on DECORATION.grounds`);
  }
});

// -------------------------------------------------- what the page then wears ---

// THE FAULT THIS WAS WRITTEN FOR. Against the area-ordered rule this fails
// reading "2 of 8" - col-one-a and col-three-a tinted, six plain.
test('a grid run is dressed ENTIRELY or not at all, and in ONE hue', () => {
  for (const theme of ['city', 'sunday', 'sport', 'world', 'front']) {
    const out = styles.styleForPage({ sections: GRID_PAGE, theme, geometry: GEO });
    const cells = out.filter((one) => GRID_KEYS.includes(one.sectionKey));
    const tinted = cells.filter((one) => one.patch.backgroundColor);
    assert.ok(tinted.length === 0 || tinted.length === GRID_KEYS.length,
      `${theme}: ${tinted.length} of ${GRID_KEYS.length} cells of one run are tinted - a run is one object`);
    const hues = new Set(tinted.map((one) => one.patch.backgroundColor));
    assert.ok(hues.size <= 1,
      `${theme}: one run wears ${hues.size} hues - colouring its cells apart says they are several stories`);
  }
});

// The neighbour rule would otherwise do exactly that, since every cell of a
// run touches the next - so this is the case that proves the run's hue is
// taken from the run and not chosen per block.
test('the run keeps one hue even though every cell touches the next', () => {
  const out = styles.styleForPage({ sections: GRID_PAGE, theme: 'city', geometry: GEO });
  const tinted = out.filter((one) => GRID_KEYS.includes(one.sectionKey) && one.patch.backgroundColor);
  assert.strictEqual(tinted.length, GRID_KEYS.length, 'the run should be dressed on a city page');
  assert.strictEqual(new Set(tinted.map((o) => o.patch.backgroundColor)).size, 1);
});

test('a front page never tints its lead and a feature page does', () => {
  const leadOf = (theme) => styles.styleForPage({ sections: GRID_PAGE, theme, geometry: GEO })
    .find((one) => one.sectionKey === 'anchor');
  assert.strictEqual(leadOf('front').patch.backgroundColor, null,
    'a front page lead already shouts by size');
  assert.ok(leadOf('world').patch.backgroundColor,
    'a feature page leads on a ground - the reference does');
});

test('a brief never takes a ground at any level, however generous', () => {
  const page = [
    article('lead', 20, 180, 400, 300),
    article('far', 20, 900, 120, 150, 'x'.repeat(300)),
  ];
  for (const theme of styles.PAGE_THEMES.map((t) => t.key)) {
    const brief = styles.styleForPage({ sections: page, theme, geometry: GEO })
      .find((one) => one.sectionKey === 'far');
    assert.strictEqual(brief.patch.backgroundColor, null,
      `${theme}: a ground behind a few lines of type is a label, not a story`);
  }
});

// The band is the page's single strongest device, and it belongs to the block
// whose role says it leads - not to whichever tinted block happened to be
// biggest, which is what it used to mean.
test('the reversed band goes on the lead, and on nothing else', () => {
  for (const theme of ['city', 'sunday', 'world']) {
    const out = styles.styleForPage({ sections: GRID_PAGE, theme, geometry: GEO });
    const banded = out.filter((one) => one.patch.headlineStyle === 'reverse');
    assert.ok(banded.length <= 1, `${theme}: ${banded.length} reversed bands is ${banded.length} leads`);
    if (banded.length) assert.strictEqual(banded[0].sectionKey, 'anchor');
  }
});

test('dressing the same page twice gives the same answer', () => {
  const once = JSON.stringify(styles.styleForPage({ sections: GRID_PAGE, theme: 'city', geometry: GEO }));
  const twice = JSON.stringify(styles.styleForPage({ sections: GRID_PAGE, theme: 'city', geometry: GEO }));
  assert.strictEqual(once, twice);
});

// THE CASE THE OLD FIXTURE COULD NOT SEE.
//
// `pageStyle.test.js` has asserted "no two blocks that touch wear the same
// hue" since it was written, and its page has no RUN on it at all - so when
// the run took its hue from its first cell without checking the neighbours of
// its last, 1145 tests passed over 17 clashing pairs on this newspaper's own
// four pages. A run is one object, so it makes ONE choice, against the union
// of every member's neighbours.
test('a run and the block beside it never wear the same hue', () => {
  // A run of four across the page, with a sidebar hard against its right end
  // and a lead above it - both of which the run touches, and neither of which
  // its FIRST cell does.
  const page = [
    article('lead', 20, 180, 620, 280),
    article('r1', 20, 468, 150, 176),
    article('r2', 176, 468, 150, 176),
    article('r3', 332, 468, 150, 176),
    article('r4', 488, 468, 150, 176),
    article('side', 20, 652, 120, 140, 'x'.repeat(300)),
  ];
  for (const theme of ['city', 'sunday', 'sport', 'world', 'feature']) {
    const out = styles.styleForPage({ sections: page, theme, geometry: GEO });
    const hue = new Map(out.filter((o) => o.patch.backgroundColor).map((o) => [o.sectionKey, o.patch.backgroundColor]));
    const box = (k) => page.find((s) => s.section_key === k);
    for (const a of hue.keys()) {
      for (const b of hue.keys()) {
        if (a >= b) continue;
        if (!touching(box(a), box(b))) continue;
        const oneRun = /^r\d$/.test(a) && /^r\d$/.test(b);
        if (oneRun) continue; // cells of one run SHARE a hue, by design
        assert.notStrictEqual(hue.get(a), hue.get(b),
          `${theme}: ${a} and ${b} touch and wear the same hue`);
      }
    }
  }
});

// THE SECOND KIND OF DRESSED BLOCK.
//
// The desk described two, not one: "a light colour background then same
// colour but medium dark shade border then dark colour heading, SOME
// HEADLINES ONLY HAVING BACKGROUND COLORS". `inks.js` has offered the screens
// (`band`, `band-deck`, `band-both`) since they were written and nothing had
// ever chosen one - 0 of 5686 blocks in this newsroom's database, against
// 5068 plain. Three of six treatments the catalogue offers had never been
// drawn, because a desk would have had to find them by hand on one block at a
// time. The same shape as `list_style` and `drop_cap`, one level up.
test('a screened headline is a block with NO ground, never both', () => {
  const page = [
    article('anchor', 20, 180, 307, 296),
    article('second-lead', 333, 180, 307, 144),
    article('shoulder', 333, 332, 307, 144),
    ...GRID_KEYS.map((k, i) => article(k, 20 + (i % 4) * 156, 484 + Math.floor(i / 4) * 184, 150, 176)),
    article('foot', 20, 852, 307, 152),
  ];
  for (const theme of ['front', 'city', 'sunday', 'sport', 'world']) {
    const out = styles.styleForPage({ sections: page, theme, geometry: GEO });
    for (const one of out) {
      // TWO GROUNDS ON ONE BLOCK IS MUDDY, and the tint is the stronger
      // device - so a block that took one never also takes a screen.
      assert.ok(!(one.patch.backgroundColor && one.patch.headlineStyle === 'band'),
        `${theme}/${one.sectionKey} carries both a ground and a screened headline`);
      if (one.patch.headlineStyle === 'band') {
        assert.ok(one.patch.headlineInk, `${theme}/${one.sectionKey}: a screen with no ink to screen`);
      }
    }
  }
});

test('a front page carries no screened headlines, and a city page reaches them', () => {
  // A lead, a चौकट beside it and two secondaries - and deliberately NO run,
  // because a run of equal blocks is a large device that can spend a city
  // page's whole budget on grounds and leave nothing for the lighter one.
  // That is correct behaviour (one budget, grounds first), so a fixture
  // carrying one could not show what this test is about.
  const page = [
    article('anchor', 20, 180, 307, 296),
    article('side', 333, 180, 120, 150, 'x'.repeat(300)),
    article('second-lead', 333, 340, 307, 144),
    article('shoulder', 20, 490, 307, 144),
  ];
  const screened = (theme) => styles.styleForPage({ sections: page, theme, geometry: GEO })
    .filter((one) => one.patch.headlineStyle === 'band');
  // A front page stays restrained: `sober` names no roles for a screen at all.
  assert.strictEqual(screened('front').length, 0,
    'a front page should carry no screened headlines');
  assert.ok(screened('city').length >= 1,
    'a city page should reach the second device - it is what stops a dressed page reading as rows of identical tinted boxes');
});

// THE BUDGET IS A SHARE OF AREA, and that is the third thing this number has
// been. Counting BLOCKS made a run cost more than a whole page's budget, so
// the one device a city page most wants was unaffordable. Counting UNITS fixed
// that and broke the other end - units are not comparable in weight, so a page
// of nine single-block units plus one eight-block run spent nine units and
// tinted seventeen blocks: measured, page four of this newspaper came out at
// 85% OF THE SHEET on every full-colour theme, which is the over-saturation
// the desk reported in the first place arriving from the other direction.
//
// Area is what the reference was measured in and what a reader perceives.
test('no theme tints more than half a dense page, and none leaves a dressable page bare', () => {
  // A dense page: a lead, five secondaries and a run of eight - the shape that
  // reached 85% under the unit budget.
  const page = [
    article('anchor', 20, 180, 307, 296),
    article('second-lead', 333, 180, 307, 144),
    article('shoulder', 333, 332, 307, 144),
    ...GRID_KEYS.map((k, i) => article(k, 20 + (i % 4) * 156, 484 + Math.floor(i / 4) * 184, 150, 176)),
    article('strip-left', 20, 852, 229, 120),
    article('strip-centre', 255, 852, 229, 120),
    article('foot-left', 20, 980, 307, 152),
    article('foot-right', 333, 980, 307, 152),
  ];
  const areaOf = (s) => Number(s.width_px) * Number(s.height_px);
  const dressable = page.reduce((sum, s) => sum + areaOf(s), 0);
  const themeDecoration = (key) => styles.themeOf(key).decoration;

  for (const theme of styles.PAGE_THEMES.map((t) => t.key)) {
    const out = styles.styleForPage({ sections: page, theme, geometry: GEO });
    const grounded = out.filter((one) => one.patch.backgroundColor);
    const byKey = new Map(page.map((s) => [s.section_key, s]));
    const inked = grounded.reduce((sum, one) => sum + areaOf(byKey.get(one.sectionKey)), 0);
    const share = inked / dressable;
    assert.ok(share <= 0.55,
      `${theme}: ${(share * 100).toFixed(0)}% of the page's own stories carry a ground - the reference's most decorated page is about half white`);
    // AND THE FIRST UNIT IS ALWAYS AFFORDABLE: a page whose only
    // ground-carrying unit is bigger than its budget must not come out bare.
    //
    // `plain` and `front` are exempt, and both deliberately. `plain` is the
    // absence of a look. A SOBER page's single device is the चौकट, and this
    // fixture has none - so a front page carrying no small block beside its
    // lead really is white, which is an ordinary printed front page and not a
    // failure.
    if (theme !== 'plain' && themeDecoration(theme) !== 'sober') {
      const anything = grounded.length || out.some((one) => one.patch.headlineStyle !== 'plain');
      assert.ok(anything, `${theme}: a themed page came out with nothing on it at all`);
    }
  }
});
