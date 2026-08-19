const test = require('node:test');
const assert = require('node:assert/strict');
const { createApp } = require('../server');
const pool = require('../src/config/db');
const { signIn } = require('./helpers/desk');

// Making up the paper requires a desk sign-in, so the tests hold one too.
let desk = null;

async function setup(port, newspaperName) {
  desk = await signIn(port);
  const newspaper = await desk.json('/api/newspapers', {
    method: 'POST',
    body: JSON.stringify({ name: newspaperName }),
  });
  const page = await desk.json(`/api/newspapers/${newspaper.id}/pages`, {
    method: 'POST',
    body: JSON.stringify({ pageNumber: 1, templateKey: 'front' }),
  });
  return { newspaper, page };
}

async function putSection(port, pageId, sectionKey, body) {
  return desk(`/api/pages/${pageId}/sections/${sectionKey}`, {
    method: 'PUT',
    body: JSON.stringify(body),
  });
}

async function cleanupNewspaper(id) {
  await pool.query('DELETE FROM newspapers WHERE id = $1', [id]);
}

test('saving a section with direct field names persists every field', async () => {
  const app = createApp();
  const server = app.listen(0);
  const port = server.address().port;
  let newspaper;

  try {
    const setupResult = await setup(port, 'Page section test - direct fields');
    newspaper = setupResult.newspaper;
    const page = setupResult.page;

    const response = await putSection(port, page.id, 'anchor', {
      headline: 'Direct Headline',
      subheading: 'Direct Sub',
      body: 'Direct Body',
      headlineFontPx: 40,
      subheadingFontPx: 22,
      bodyFontPx: 18,
      category: 'Politics',
      location: 'Pune',
      tags: 'a,b',
      reporterName: 'Ravi',
      aiNotes: 'note',
    });
    assert.equal(response.status, 200);

    const updated = await response.json();
    const section = updated.sections.find((s) => s.section_key === 'anchor');
    assert.equal(section.headline, 'Direct Headline');
    assert.equal(section.subheading, 'Direct Sub');
    assert.equal(section.body, 'Direct Body');
    // Type sizes are NUMERIC now, because a printer sets type in half points -
    // so these come back over the wire as strings, the same as the page's mm
    // dimensions always have. Every reader in the application coerces.
    assert.equal(Number(section.headline_font_px), 40);
    assert.equal(Number(section.subheading_font_px), 22);
    assert.equal(Number(section.body_font_px), 18);
    assert.equal(section.category, 'Politics');
    assert.equal(section.location, 'Pune');
    assert.equal(section.tags, 'a,b');
    assert.equal(section.reporter_name, 'Ravi');
    assert.equal(section.ai_notes, 'note');
  } finally {
    if (newspaper) await cleanupNewspaper(newspaper.id);
    server.close();
  }
});

test('saving a section accepts the title/subtitle/description aliases', async () => {
  const app = createApp();
  const server = app.listen(0);
  const port = server.address().port;
  let newspaper;

  try {
    const setupResult = await setup(port, 'Page section test - aliases');
    newspaper = setupResult.newspaper;
    const page = setupResult.page;

    const response = await putSection(port, page.id, 'lead', {
      title: 'Alias Headline',
      subtitle: 'Alias Sub',
      description: 'Alias Body',
    });
    assert.equal(response.status, 200);

    const updated = await response.json();
    const section = updated.sections.find((s) => s.section_key === 'lead');
    assert.equal(section.headline, 'Alias Headline');
    assert.equal(section.subheading, 'Alias Sub');
    assert.equal(section.body, 'Alias Body');
  } finally {
    if (newspaper) await cleanupNewspaper(newspaper.id);
    server.close();
  }
});

test('saving a section links a reporter news item via newsItemId', async () => {
  const app = createApp();
  const server = app.listen(0);
  const port = server.address().port;
  let newspaper;
  let newsId;

  try {
    const setupResult = await setup(port, 'Page section test - linked news');
    newspaper = setupResult.newspaper;
    const page = setupResult.page;

    const newsFormData = new FormData();
    newsFormData.append('title', 'Linked reporter story');
    newsFormData.append('description', 'story body');
    // Filing a story needs a signed-in reporter; multipart carries the session
    // cookie by hand because FormData sets its own content type.
    const news = await fetch(`http://127.0.0.1:${port}/api/news`, {
      method: 'POST',
      headers: { Cookie: desk.cookie },
      body: newsFormData,
    }).then((response) => response.json());
    newsId = news.id;

    const response = await putSection(port, page.id, 'report-one', {
      newsItemId: newsId,
      headline: 'Linked',
    });
    assert.equal(response.status, 200);

    const updated = await response.json();
    const section = updated.sections.find((s) => s.section_key === 'report-one');
    assert.equal(section.news_item_id, newsId);
  } finally {
    if (newsId) await pool.query('DELETE FROM news_items WHERE id = $1', [newsId]);
    if (newspaper) await cleanupNewspaper(newspaper.id);
    server.close();
  }
});

test('saving a section twice overwrites the previous content', async () => {
  const app = createApp();
  const server = app.listen(0);
  const port = server.address().port;
  let newspaper;

  try {
    const setupResult = await setup(port, 'Page section test - overwrite');
    newspaper = setupResult.newspaper;
    const page = setupResult.page;

    await putSection(port, page.id, 'lead', { headline: 'First' });
    const response = await putSection(port, page.id, 'lead', { headline: 'Second' });
    assert.equal(response.status, 200);

    const updated = await response.json();
    const section = updated.sections.find((s) => s.section_key === 'lead');
    assert.equal(section.headline, 'Second');
  } finally {
    if (newspaper) await cleanupNewspaper(newspaper.id);
    server.close();
  }
});

test('saving a section on a nonexistent page returns 404', async () => {
  const app = createApp();
  const server = app.listen(0);
  const port = server.address().port;
  desk = await signIn(port);

  try {
    const response = await putSection(port, 999999999, 'lead', { headline: 'x' });
    assert.equal(response.status, 404);
    const body = await response.json();
    assert.equal(body.error, 'Not found');
  } finally {
    server.close();
  }
});

test('saving a section with an unknown section key is a silent no-op', async () => {
  const app = createApp();
  const server = app.listen(0);
  const port = server.address().port;
  let newspaper;

  try {
    const setupResult = await setup(port, 'Page section test - bogus key');
    newspaper = setupResult.newspaper;
    const page = setupResult.page;

    const response = await putSection(port, page.id, 'not-a-real-section', { headline: 'x' });
    assert.equal(response.status, 200);

    const updated = await response.json();
    assert.equal(updated.sections.length, page.sections.length);
    assert.ok(!updated.sections.some((s) => s.section_key === 'not-a-real-section'));
  } finally {
    if (newspaper) await cleanupNewspaper(newspaper.id);
    server.close();
  }
});

// A picture that lands on the headline takes no room from the copy, so
// dropping one changes the character budget by nothing - the opposite of what
// the composition editor promises. It has to land in the text.
test('a new picture lands in the copy, not on the headline, and takes room from it', async () => {
  const app = createApp();
  const server = app.listen(0);
  const port = server.address().port;
  let newspaper;

  try {
    const setupResult = await setup(port, 'Page section test - picture lands in the copy');
    newspaper = setupResult.newspaper;
    const page = setupResult.page;

    // A headline long enough to take real rows off the top of the block.
    await putSection(port, page.id, 'lead', {
      headline: 'सातारा जिल्ह्यात पावसाने उघडीप दिल्याने शेतीकामांना वेग',
      subheading: 'शेतकऱ्यांनी पेरणीच्या कामांना सुरुवात केली',
    });

    // What the block holds, measured by the worklist - the one character grid.
    const capacityOfLead = async () => {
      const list = await desk.json(`/api/newspapers/${newspaper.id}/worklist`);
      return list.pages.flatMap((p) => p.blocks).find((b) => b.sectionKey === 'lead')?.capacity;
    };
    const before = await capacityOfLead();

    const placed = await desk.json(`/api/pages/${page.id}/sections/lead/images`, {
      method: 'POST',
      body: JSON.stringify({ url: '/uploads/does-not-need-to-exist.png', filename: 'p.png' }),
    });

    const picture = placed[0];
    assert.ok(picture, 'the picture is placed');

    const { rows } = await pool.query(
      'SELECT margin_px, headline_font_px, body_font_px FROM page_sections WHERE page_id = $1 AND section_key = $2',
      [page.id, 'lead'],
    );
    const margin = Number(rows[0].margin_px) || 12;
    assert.ok(
      Number(picture.y_px) > margin,
      `a picture at y=${picture.y_px} sits on the headline, which starts at ${margin}`,
    );

    // The point of landing it there: the copy now has less room.
    const after = await capacityOfLead();
    assert.ok(after < before, `the budget should fall when a picture lands: ${before} -> ${after}`);

    // An explicit placement is still obeyed - this is a default, not a rule.
    const second = await desk.json(`/api/pages/${page.id}/sections/lead/images`, {
      method: 'POST',
      body: JSON.stringify({ url: '/uploads/does-not-need-to-exist-2.png', filename: 'q.png', x: 4, y: 2 }),
    });
    assert.equal(Number(second.find((i) => i.id !== picture.id).y_px), 2);
  } finally {
    if (newspaper) await cleanupNewspaper(newspaper.id);
    server.close();
  }
});

// Resizing a picture must not move it, and the order pictures are stacked in
// has to survive a reload. Neither was true: a size-only patch fell back to
// x: 0, y: 0, and z-order was restacked inside the old canvas and thrown away.
test('a picture stays where it is when it is resized, and its order is kept', async () => {
  const app = createApp();
  const server = app.listen(0);
  const port = server.address().port;
  let newspaper;

  try {
    const setupResult = await setup(port, 'Page section test - picture placement');
    newspaper = setupResult.newspaper;
    const page = setupResult.page;

    const placed = await desk.json(`/api/pages/${page.id}/sections/lead/images`, {
      method: 'POST',
      body: JSON.stringify({ url: '/uploads/placement-test.png', filename: 'p.png', x: 40, y: 60, width: 80, height: 60 }),
    });
    const picture = placed[0];
    assert.equal(Number(picture.x_px), 40);

    const patch = (body) => desk.json(
      `/api/pages/${page.id}/sections/lead/images/${picture.id}`,
      { method: 'PATCH', body: JSON.stringify(body) },
    ).then((rows) => rows.find((row) => row.id === picture.id));

    const bigger = await patch({ width: 88, height: 66 });
    assert.equal(Number(bigger.width_px), 88, 'it did get bigger');
    assert.equal(Number(bigger.x_px), 40, 'and it did NOT move');
    assert.equal(Number(bigger.y_px), 60);

    const raised = await patch({ zIndex: 5 });
    assert.equal(Number(raised.z_index), 5, 'bring forward is stored, not just drawn');

    // And it is still 5 when the block is read back from the database.
    const reread = await desk.json(`/api/pages/${page.id}/sections/lead/images`);
    assert.equal(Number(reread.find((row) => row.id === picture.id).z_index), 5);
  } finally {
    if (newspaper) await cleanupNewspaper(newspaper.id);
    server.close();
  }
});

// A picture may not be LEFT where the block can set nothing at all.
//
// The two NO_LEGAL_MEASURE blocks in this database were not dragged into it -
// a picture defaults to HALF the block's width at its left edge, and on a
// narrow block in large type that is already the fault: 190px wide, 16px
// type, a 95px picture, and the 81px strip left beside it is under the 96px
// one word needs. The block keeps its depth, keeps its copy, and prints none
// of it.
//
// Enforced in the service as well as in the editor's drag, so a direct API
// caller cannot make the layout the UI now refuses to.
test('a picture that would leave the block unable to set a line is placed legally instead', async () => {
  const app = createApp();
  const server = app.listen(0);
  const port = server.address().port;
  let newspaper;

  try {
    const setupResult = await setup(port, 'Page section test - unprintable picture');
    newspaper = setupResult.newspaper;
    const page = setupResult.page;

    // A narrow block set in large type, with real copy in it. Written
    // straight to the row: the section PUT does not carry frame geometry (a
    // block's size is the template's, moved by its own endpoint), and the
    // rule under test is about the picture, not about that contract.
    await pool.query(
      `UPDATE page_sections
          SET width_px=190, height_px=264, margin_px=4, column_count=1,
              headline=$2, headline_font_px=17,
              subheading=$3, subheading_font_px=16,
              body_font_px=16, line_height=1.25, text_align='justify', body=$4
        WHERE page_id=$1 AND section_key='lead'`,
      [page.id, 'सातारा: पाणीटंचाईची सावट',
        'अनेक भागात पाणीपुरवठा कमी झाला असून नागरिक त्रस्त आहेत.',
        'पाणीपुरवठा कमी झाल्याने दैनंदिन जीवन विस्कळीत होऊन नागरिक त्रस्त आहेत.'],
    );

    const placed = await desk.json(`/api/pages/${page.id}/sections/lead/images`, {
      method: 'POST',
      body: JSON.stringify({ url: '/uploads/corridor-test.png', filename: 'c.png', x: 0, y: 151, width: 95, height: 88 }),
    });
    const picture = placed[0];

    // 182px of measure and a 96px minimum column: a 95px picture cannot leave
    // one anywhere, so the honest placement is the full measure.
    assert.equal(Number(picture.width_px), 182, 'it must become a full-measure picture');
    assert.equal(Number(picture.x_px), 4, 'flush with the measure, not the frame');
    assert.equal(Number(picture.height_px), 88, 'and its height is never touched');
    // Widening it alone is not enough: floating in the middle of the copy it
    // would leave 15px above and 15px below, and one line of this type needs
    // 25px. A full-measure picture goes at the top of the copy or the foot.
    assert.ok(Number(picture.y_px) <= 130 || Number(picture.y_px) >= 170,
      `a full-measure picture must go to the top or the foot, not float at ${picture.y_px}`);

    // And the block really can set its copy again.
    const shaper = await import('../public/editor/compose/shaper.js');
    const metrics = await import('../public/editor/compose/font-metrics.js');
    const adapter = await import('../public/editor/compose/section-adapter.js');
    await Promise.all([metrics.ensureFontsLoaded(), shaper.ensureShaperReady()]);
    const { rows } = await pool.query(
      'SELECT * FROM page_sections WHERE page_id = $1 AND section_key = $2', [page.id, 'lead']);
    const composed = adapter.composeSection({ ...rows[0], images: [{
      x_px: picture.x_px, y_px: picture.y_px, width_px: picture.width_px, height_px: picture.height_px,
      shape: 'rect', rotation: 0, stand_off_px: picture.stand_off_px,
    }] }, {});
    assert.ok(!composed.warnings.some((w) => w.code === 'NO_LEGAL_MEASURE'),
      'the placement the service chose must be printable by the engine\'s own reckoning');
  } finally {
    if (newspaper) await cleanupNewspaper(newspaper.id);
    server.close();
  }
});
