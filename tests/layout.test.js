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
