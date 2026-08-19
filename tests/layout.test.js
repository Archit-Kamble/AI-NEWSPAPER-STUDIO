// The layout engine: the column grid, and blocks drawn freely on a page.
//
// A page is no longer limited to whatever its template declared - an editor
// adds the blocks the day's file needs and drags them onto the grid. These
// tests hold the two properties that make the printed page work: every block
// covers a whole number of columns, and nothing ever leaves the matter box.

const test = require('node:test');
const assert = require('node:assert/strict');
const { createApp } = require('../server');
const pool = require('../src/config/db');
const { signIn } = require('./helpers/desk');
const { geometryOf } = require('../src/layout/geometry');
const { templates } = require('../src/layout/templates');

const G = geometryOf({});

async function withServer(run) {
  const server = createApp().listen(0);
  const port = server.address().port;
  const desk = await signIn(port);
  let newspaper;
  try {
    newspaper = await desk(`/api/newspapers`, {
      method: 'POST',
            body: JSON.stringify({ name: 'Layout test' }),
    }).then((r) => r.json());

    const page = await desk(`/api/newspapers/${newspaper.id}/pages`, {
      method: 'POST',
            body: JSON.stringify({ pageNumber: 1, templateKey: 'dense' }),
    }).then((r) => r.json());

    await run({ port, newspaper, page, desk });
  } finally {
    if (newspaper) await pool.query('DELETE FROM newspapers WHERE id = $1', [newspaper.id]);
    server.close();
  }
}

const onGrid = (section) =>
  G.snapLeftPx.includes(Number(section.x_px)) &&
  G.snapRightPx.includes(Number(section.x_px) + Number(section.width_px));

const insideMatter = (section) =>
  Number(section.x_px) >= G.marginXPx &&
  Number(section.y_px) >= G.marginYPx &&
  Number(section.x_px) + Number(section.width_px) <= G.marginXPx + G.matterWidthPx &&
  Number(section.y_px) + Number(section.height_px) <= G.marginYPx + G.matterHeightPx;

test('the editor pixel scale is exactly 2 px per mm of the printed page', () => {
  assert.equal(G.pxPerMm, 2);
  assert.equal(G.pageWidthMm, 330);
  assert.equal(G.pageHeightMm, 530);
  assert.equal(G.pageWidthPx, 660);
  assert.equal(G.pageHeightPx, 1060);
  assert.equal(G.matterWidthPx, 620);
  assert.equal(G.matterHeightPx, 1020);
});

test('every template block covers whole columns and stays inside the matter box', () => {
  for (const template of Object.values(templates)) {
    for (const section of template.sections) {
      const asRow = { x_px: section.x, y_px: section.y, width_px: section.width, height_px: section.height };
      assert.ok(onGrid(asRow), `${template.key}/${section.key} is off the column grid`);
      assert.ok(insideMatter(asRow), `${template.key}/${section.key} escapes the matter box`);
    }
  }
});

test('a dense page carries far more blocks than a template of six', () => {
  assert.ok(templates.dense.sections.length >= 15, 'dense layout should hold a real inside page');
});

test('a block can be added to a page, moved, and deleted', async () => {
  await withServer(async ({ port, newspaper, page, desk }) => {
    const before = page.sections.length;

    const created = await desk(`/api/pages/${page.id}/sections`, {
      method: 'POST',
            body: JSON.stringify({ x: G.marginXPx, y: G.marginYPx, width: 150, height: 200 }),
    });
    assert.equal(created.status, 201);

    const withBlock = await created.json();
    assert.equal(withBlock.sections.length, before + 1);

    const added = withBlock.sections.find((s) => s.section_key.startsWith('block-'));
    assert.ok(added, 'a custom block gets its own key');
    assert.equal(added.is_custom, true);
    assert.ok(onGrid(added), 'a new block lands on the column grid');

    // Moved to a deliberately off-grid position: the server must correct it.
    const moved = await desk(`/api/pages/${page.id}/sections/${added.section_key}/geometry`,
      {
        method: 'PATCH',
                body: JSON.stringify({ x: 143, y: 371, width: 151, height: 203 }),
      },
    ).then((r) => r.json());

    const movedBlock = moved.sections.find((s) => s.section_key === added.section_key);
    assert.ok(onGrid(movedBlock), 'a moved block is snapped back onto the column grid');
    assert.equal(Number(movedBlock.y_px) % G.baselinePx, 0, 'a moved block sits on the baseline');
    assert.ok(insideMatter(movedBlock));

    const removed = await desk(`/api/pages/${page.id}/sections/${added.section_key}`,
      { method: 'DELETE' },
    );
    assert.equal(removed.status, 200);
    const after = await removed.json();
    assert.equal(after.sections.length, before);
    assert.equal(after.sections.some((s) => s.section_key === added.section_key), false);
  });
});

test('a block dragged past the page edge is clamped into the matter box', async () => {
  await withServer(async ({ port, page, desk }) => {
    const created = await desk(`/api/pages/${page.id}/sections`, {
      method: 'POST',
            body: JSON.stringify({ x: 5000, y: 9000, width: 4000, height: 4000 }),
    }).then((r) => r.json());

    const added = created.sections.find((s) => s.section_key.startsWith('block-'));
    assert.ok(insideMatter(added), 'a block flung off the page is pulled back onto it');
    assert.ok(onGrid(added));
  });
});

test('a block dragged onto the nameplate or the footer band is clamped into the CONTENT region, not just the matter box', async () => {
  // Before this fix, snapGeometry() clamped against the raw matter box, so a
  // block dragged to the very top or foot of page one could legally land on
  // top of the nameplate or the page-foot/imprint furniture - the same
  // collision the region model exists to rule out (Bug #7/#8/#9). This is
  // page one specifically (withServer's fixture), so the FRONT region - the
  // taller nameplate band - is the one that must hold.
  await withServer(async ({ page, desk }) => {
    const ontoNameplate = await desk(`/api/pages/${page.id}/sections`, {
      method: 'POST',
      body: JSON.stringify({ x: G.marginXPx, y: 0, width: 150, height: 60 }),
    }).then((r) => r.json());
    const top = ontoNameplate.sections.find((s) => s.section_key.startsWith('block-'));
    assert.ok(top.y_px >= G.regions.front.content.top, 'a block cannot be dragged up onto the nameplate');

    const ontoFooter = await desk(`/api/pages/${page.id}/sections`, {
      method: 'POST',
      body: JSON.stringify({ x: G.marginXPx, y: 9000, width: 150, height: 60 }),
    }).then((r) => r.json());
    const foot = ontoFooter.sections.filter((s) => s.section_key.startsWith('block-')).pop();
    assert.ok(foot.y_px + foot.height_px <= G.regions.front.content.bottom, 'a block cannot be dragged down onto the footer band');
  });
});

test('deleting a block that does not exist is a 404, not a crash', async () => {
  await withServer(async ({ port, page, desk }) => {
    const response = await desk(`/api/pages/${page.id}/sections/no-such-block`, {
      method: 'DELETE',
    });
    assert.equal(response.status, 404);
  });
});

test('every layout in templates.js exists in the templates table', async () => {
  const { rows } = await pool.query('SELECT template_key FROM templates');
  const inDatabase = new Set(rows.map((r) => r.template_key));
  for (const key of Object.keys(templates)) {
    assert.ok(inDatabase.has(key), `layout "${key}" is missing from the templates table`);
  }
});

// --- every block must be able to hold a story ---------------------------------
//
// A block whose character budget is zero is a hole nothing can be written into,
// and the software would not say so until copy had already been written and
// measured. The `local` page's full-width banner was exactly this: at 620x168
// with the default 40px headline it held zero characters. The rule that sizes
// type had a cliff in it rather than a reason.

test('no block in any layout is born unable to hold a word of copy', async () => {
  const { buildFlowMap } = await import('../public/editor/layout/text-flow.js');
  const { typeScaleFor } = require('../src/layout/geometry');
  const { templates } = require('../src/layout/templates');

  const barren = [];
  for (const template of Object.values(templates)) {
    for (const section of template.sections) {
      // Adverts, photographs and feature boxes are not written into as running
      // copy, but every article block must hold some.
      if (section.blockType && section.blockType !== 'article') continue;

      const type = typeScaleFor(section.width, section.height);

      // Measured with a headline on it, because an empty block always looks
      // like it has room - the budget only collapses once the headline is
      // there. The headline is scaled to the block's own measure: a full-width
      // banner carries a long one, a foot strip carries a short one, and
      // holding both to the same length would be testing the wrong thing.
      const perLine = Math.max(6, Math.floor((section.width - 24) / (type.headlineFontPx * 0.52)));
      const headline = 'शहरातील रस्त्यांची दुरवस्था महापालिकेवर टीका जोरदार '.repeat(4)
        .slice(0, Math.round(perLine * 1.5));

      const map = buildFlowMap(
        { width_px: section.width, height_px: section.height },
        {
          marginPx: 12,
          lineHeight: 1.25,
          headline,
          headlineFontPx: type.headlineFontPx,
          subheading: '',
          subheadingFontPx: type.subheadingFontPx,
          body: '',
          bodyFontPx: type.bodyFontPx,
        },
        [],
      );
      // A sentence. Below this the block is a hole, not a story slot.
      if (map.bodyCharBudget < 40) {
        barren.push(`${template.key}/${section.key} ${section.width}x${section.height} holds ${map.bodyCharBudget}`);
      }
    }
  }

  assert.deepEqual(barren, [], 'these blocks cannot hold a usable story');
});

test('sizing type down for a short block never makes it bigger', () => {
  const { typeScaleFor } = require('../src/layout/geometry');
  // A block that is plainly deep enough keeps the size its measure earns.
  assert.equal(typeScaleFor(268, 480).headlineFontPx, typeScaleFor(268, 4800).headlineFontPx);
  // A shallow block of the same width gets less, never more.
  assert.ok(typeScaleFor(620, 90).headlineFontPx < typeScaleFor(620, 600).headlineFontPx);
});

// --- one gap, everywhere -----------------------------------------------------
//
// Horizontally the gap was always right, because it is the column gutter and
// the grid enforces it. Vertically it was typed by hand into every template and
// had drifted to seven different values - 8, 10, 11, 12, 13, 14 and 16px,
// sometimes three of them on one page. A reader never measures the white
// between two stories, but uneven white is why a page looks homemade.

test('every layout uses exactly one vertical gap between blocks', () => {
  const { templates } = require('../src/layout/templates');
  const { geometryOf } = require('../src/layout/geometry');
  const expected = geometryOf({}).baselinePx;

  const offenders = [];
  for (const template of Object.values(templates)) {
    const found = new Set();
    for (const a of template.sections) {
      for (const b of template.sections) {
        if (a === b) continue;
        // Only blocks that share a column can have a gap between them.
        const sharedColumns = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
        if (sharedColumns <= 0) continue;
        const gap = b.y - (a.y + a.height);
        if (gap >= 0 && gap < 80) found.add(gap);
      }
    }
    const gaps = [...found].sort((x, y) => x - y);
    if (gaps.length !== 1 || gaps[0] !== expected) {
      offenders.push(`${template.key}: ${gaps.join(', ') || 'none'}`);
    }
  }

  assert.deepEqual(offenders, [], `every gap should be ${expected}px`);
});

test('the vertical gap is the same measure as the column gutter is wide', () => {
  const { geometryOf } = require('../src/layout/geometry');
  const g = geometryOf({});
  // 8px vertical against a 6px gutter - both 3-4mm, both a whole number of
  // baselines apart. The vertical one is a baseline so the text rhythm holds.
  assert.equal(g.baselinePx % 2, 0);
  assert.ok(Math.abs(g.baselinePx - g.gutterPx) <= g.baselinePx / 2,
    'the two gaps should read as the same amount of white');
});

test('content starts on the baseline, so bands divide into the page exactly', () => {
  const { templates } = require('../src/layout/templates');
  const { geometryOf } = require('../src/layout/geometry');
  const g = geometryOf({});
  const bottom = g.marginYPx + g.matterHeightPx;

  for (const template of Object.values(templates)) {
    const top = Math.min(...template.sections.map((s) => s.y));
    assert.equal(
      (bottom - top) % g.baselinePx, 0,
      `${template.key}: the depth available must be a whole number of baselines, or the ` +
      'remainder comes out as a fatter gap above the last band',
    );
  }
});

// --- the page-region model: header / content / footer, one source ------------
//
// Project A, Bug #7/#8/#9: templates.js let a block's content region run all
// the way to the matter's true bottom edge, while masthead.js independently
// drew an opaque page-foot bar (and, on the imprint page, the printer's Act
// declaration) inside that same band, on top of it - a content block and page
// furniture claiming the same pixels, on every inside page and the front page
// alike. geometry.js's regionsFor() is now the one place that reserves the
// footer band; these tests hold that no template block ever enters it, and
// that the furniture pieces sharing the band never collide with each other
// either.

test('no template block enters the reserved footer band', () => {
  const { templates } = require('../src/layout/templates');
  const { geometryOf } = require('../src/layout/geometry');
  const g = geometryOf({});

  for (const template of Object.values(templates)) {
    for (const section of template.sections) {
      assert.ok(
        section.y + section.height <= g.regions.inside.footer.top,
        `${template.key}/${section.key} ends at ${section.y + section.height}, past the footer band's top at ${g.regions.inside.footer.top}`,
      );
    }
  }
});

test('only Page 2 reserves the legal-imprint band; ordinary pages recover that editorial height', () => {
  const { geometryOf } = require('../src/layout/geometry');
  const g = geometryOf({});
  assert.equal(g.regions.front.footer.imprintHeightPx, 0);
  assert.equal(g.regions.inside.footer.imprintHeightPx, 0);
  assert.equal(g.regions.insideImprint.footer.imprintHeightPx, 40);
  assert.ok(g.regions.inside.content.bottom > g.regions.insideImprint.content.bottom);
});

test('the page-foot strip and the imprint declaration are stacked, not overlapping', () => {
  const { geometryOf } = require('../src/layout/geometry');
  const g = geometryOf({});
  const { footer } = g.regions.insideImprint;
  assert.ok(
    footer.imprintTop + footer.imprintHeightPx <= footer.footTop,
    'the imprint block must end at or before the foot strip begins',
  );
  assert.equal(footer.footTop + footer.footHeightPx, footer.bottom, 'the foot strip fills exactly to the matter edge');
});

test('a page-region content bottom is exactly the footer band top - one boundary, not two', () => {
  const { geometryOf } = require('../src/layout/geometry');
  const g = geometryOf({});
  assert.equal(g.regions.front.content.bottom, g.regions.front.footer.top);
  assert.equal(g.regions.inside.content.bottom, g.regions.inside.footer.top);
  assert.equal(g.regions.insideImprint.content.bottom, g.regions.insideImprint.footer.top);
});

test('compact Devanagari-safe furniture leaves one small canonical gap after its rule', () => {
  const { geometryOf, HEADER, FOOTER } = require('../src/layout/geometry');
  const g = geometryOf({});
  assert.equal(HEADER.mastheadClearancePx, 4);
  assert.equal(HEADER.folioContentGapPx, 4);
  assert.equal(FOOTER.contentFooterGapPx, 4);
  assert.equal(g.regions.front.content.top, 144);
  assert.equal(g.regions.inside.content.top, 56);
});

test('the front page starts its content below the nameplate; inside pages start below the slimmer folio', () => {
  const { geometryOf } = require('../src/layout/geometry');
  const g = geometryOf({});
  assert.ok(g.regions.front.content.top > g.regions.inside.content.top,
    'the nameplate band is taller than the folio strip, so front-page content starts lower');
});
