// The production capabilities a real daily needs: jump lines, district
// editions, colour formes, the rate card and the e-paper.
//
// Each of these was taken from what Lokmat, Sakal, Maharashtra Times, Loksatta
// and Pudhari actually do. The tests hold the property that makes each one
// worth having, not the shape of its output.

const test = require('node:test');
const assert = require('node:assert/strict');
const { createApp } = require('../server');
const pool = require('../src/config/db');
const { signIn } = require('./helpers/desk');
const { printsColourByDefault } = require('../src/layout/formes');
const { quote } = require('../src/layout/rateCard');
const { splitAt } = require('../src/services/jump.service');
const sudoku = require('../src/features/sudoku');
const epaper = require('../src/services/epaper.service');
const fs = require('node:fs/promises');
const path = require('node:path');

test.after(() => pool.end());

// --------------------------------------------------------------- the press ---

test('colour lands on the outer forme and the centre spread', () => {
  const colour = [];
  for (let n = 1; n <= 8; n += 1) if (printsColourByDefault(n, 8)) colour.push(n);
  assert.deepEqual(colour, [1, 2, 4, 5, 7, 8]);

  // In a 16-page paper the centre moves with it.
  assert.equal(printsColourByDefault(8, 16), true);
  assert.equal(printsColourByDefault(9, 16), true);
  assert.equal(printsColourByDefault(6, 16), false);
});

// ------------------------------------------------------------- jump lines ---

test('a story breaks at a sentence when one is within reach', () => {
  const text = 'पहिले वाक्य आहे. दुसरे वाक्य आहे. तिसरे वाक्य आहे.';
  const { head, tail } = splitAt(text, 34);
  assert.ok(head.endsWith('.'), `broke mid-sentence: ${head}`);
  assert.ok(tail.startsWith('तिसरे'), tail);
});

test('a story never breaks in the middle of a word', () => {
  // No sentence end anywhere near the limit, so it has to break at a word.
  const text = 'एकसंध मजकूर कोणत्याही पूर्णविरामाशिवाय पुढे चालत राहतो आणि संपत नाही';
  const { head, tail } = splitAt(text, 30);
  assert.ok(!head.endsWith(' '), 'head should be trimmed');
  // Rejoining must give the original words back, in order.
  assert.deepEqual(`${head} ${tail}`.split(/\s+/), text.split(/\s+/));
});

test('text that already fits is not split at all', () => {
  const { head, tail } = splitAt('छोटी बातमी.', 200);
  assert.equal(tail, '');
  assert.equal(head, 'छोटी बातमी.');
});

// -------------------------------------------------------------- rate card ---

test('an advert is priced by column-centimetre, and position dominates', () => {
  // Five columns wide, 248 px tall = 124 mm = 12.4 cm.
  const block = { x_px: 450, y_px: 164, width_px: 190, height_px: 248 };
  const ear = quote(block, { page_number: 1, prints_colour: true }, { totalPages: 8 });
  const inside = quote({ ...block, x_px: 20 }, { page_number: 5, prints_colour: false }, { totalPages: 8 });

  assert.equal(ear.columns, 5);
  assert.equal(ear.heightCm, 12.4);
  assert.equal(ear.position, 'front-ear');
  assert.equal(ear.columnCm, 62);
  assert.ok(ear.total > inside.total * 5, `ear ${ear.total} vs inside ${inside.total}`);
});

test('colour is charged for, mono is not', () => {
  const block = { x_px: 20, y_px: 400, width_px: 190, height_px: 248 };
  const colour = quote(block, { page_number: 5, prints_colour: true }, { totalPages: 8 });
  const mono = quote(block, { page_number: 5, prints_colour: false }, { totalPages: 8 });

  assert.equal(mono.colourSurcharge, 0);
  assert.ok(colour.colourSurcharge > 0);
  assert.equal(colour.base, mono.base);
});

// ---------------------------------------------------------------- sudoku ----

test('the puzzle is valid, symmetric and the same for a given date for ever', async () => {
  const first = await sudoku.build('2026-08-04');
  const second = await sudoku.build('2026-08-04');
  const nextDay = await sudoku.build('2026-08-05');

  assert.deepEqual(first.grid, second.grid, 'the same date must give the same puzzle');
  assert.notDeepEqual(first.grid, nextDay.grid);

  const grid = first.solution;
  for (let i = 0; i < 9; i += 1) {
    assert.equal(new Set(grid[i]).size, 9, `row ${i} repeats a digit`);
    assert.equal(new Set(grid.map((row) => row[i])).size, 9, `column ${i} repeats a digit`);
  }
  for (let band = 0; band < 3; band += 1) {
    for (let stack = 0; stack < 3; stack += 1) {
      const box = [];
      for (let r = 0; r < 3; r += 1) for (let c = 0; c < 3; c += 1) box.push(grid[band * 3 + r][stack * 3 + c]);
      assert.equal(new Set(box).size, 9, `box ${band}${stack} repeats a digit`);
    }
  }

  // Every given must agree with the solution it was carved from.
  first.grid.forEach((row, r) =>
    row.forEach((value, c) => {
      if (value) assert.equal(value, grid[r][c]);
    }),
  );
});

// ------------------------------------------------- district editions + e-paper ---

test('a district edition shares its parent pages and owns only its own', async () => {
  const app = createApp();
  const server = app.listen(0);
  const port = server.address().port;
  const desk = await signIn(port);
  const base = `http://localhost:${port}`;
  const post = (path, body) =>
    desk(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

  let parentId = null;
  let childId = null;
  let pdfPath = null;
  try {
    const parent = await post('/api/newspapers', { name: 'District test', publicationDate: '2026-08-04' }).then((r) => r.json());
    parentId = parent.id;
    for (const [n, layout] of [[1, 'front'], [2, 'local'], [3, 'opinion'], [4, 'dense']]) {
      await post(`/api/newspapers/${parent.id}/pages`, { pageNumber: n, templateKey: layout });
    }

    const created = await post(`/api/newspapers/${parent.id}/district-editions`, {
      district: 'सातारा',
      localPages: [2, 4],
    }).then((r) => r.json());
    childId = created.edition.id;
    assert.deepEqual(created.localPages, [2, 4]);

    const printed = await desk(`/api/newspapers/${childId}/printed-pages`).then((r) => r.json());
    assert.equal(printed.length, 4);
    assert.deepEqual(printed.map((page) => page.origin), ['common', 'local', 'common', 'local']);

    // The point of sharing rather than copying: one correction, every district.
    const parentPages = await desk(`/api/newspapers/${parentId}/pages`).then((r) => r.json());
    await desk(`/api/pages/${parentPages[0].id}/sections/lead`, {
      method: 'PUT',
            body: JSON.stringify({ headline: 'एकदाच दुरुस्त', status: 'ready' }),
    });
    const afterFix = await desk(`/api/newspapers/${childId}/printed-pages`).then((r) => r.json());
    assert.equal(
      afterFix[0].sections.find((s) => s.section_key === 'lead').headline,
      'एकदाच दुरुस्त',
    );

    // Merely knowing an edition id must not reveal unpublished newsroom copy.
    const unpublished = await fetch(`${base}/epaper/${parentId}`);
    assert.equal(unpublished.status, 404);

    // Publication freezes one immutable manifest. The reader serves that
    // snapshot as page images/hotspots AND searchable text; it never reads the
    // subsequently editable newsroom rows for an anonymous request.
    const snapshot = await epaper.buildEdition(parentId);
    snapshot.edition.status = 'published';
    snapshot.edition.pdfUrl = `/epaper/${parentId}/pdf`;
    snapshot.pages[0].imageUrl = `/uploads/epaper/${parentId}/page-1.png`;
    await fs.mkdir(epaper.editionDirectory(parentId), { recursive: true });
    await fs.writeFile(epaper.manifestPath(parentId), JSON.stringify(snapshot));
    await fs.writeFile(path.join(epaper.editionDirectory(parentId), 'page-1.png'), Buffer.from('published-page'));
    const pdfName = `epaper-gate-${process.pid}-${parentId}.pdf`;
    pdfPath = path.join(epaper.PUBLIC_DIR, 'uploads', pdfName);
    await fs.writeFile(pdfPath, Buffer.from('published-pdf'));
    await pool.query(
      `INSERT INTO publication_files (newspaper_id, file_type, storage_path) VALUES ($1, 'print_pdf', $2)`,
      [parentId, `/uploads/${pdfName}`],
    );
    assert.equal(
      (await fetch(`${base}/uploads/epaper/${parentId}/page-1.png`)).status,
      404,
      'a generated asset cannot bypass the publication status gate',
    );
    assert.equal((await fetch(`${base}/epaper/${parentId}/pdf`)).status, 404);
    await pool.query(`UPDATE newspapers SET status = 'published' WHERE id = $1`, [parentId]);

    const html = await fetch(`${base}/epaper/${parentId}`).then((r) => r.text());
    assert.match(html, /एकदाच दुरुस्त/);
    // The headline carries its own alignment now (schema.sql's headline_align),
    // so the tag is no longer bare.
    assert.match(html, /<h3 style="text-align:/);
    assert.match(html, /class="epaper-transcript"/, 'the archive text remains readable/indexable without its enhancements');
    assert.match(html, /data-page-stage/, 'the public reader carries the page-image viewer');

    const data = await fetch(`${base}/api/newspapers/${parentId}/epaper`).then((r) => r.json());
    const hotspot = data.pages[0].articles[0].hotspot;
    assert.ok(hotspot.widthPct > 0 && hotspot.widthPct <= 100);
    assert.ok(hotspot.topPct >= 0 && hotspot.topPct < 100);
    const publicPage = await fetch(`${base}/uploads/epaper/${parentId}/page-1.png`);
    assert.equal(publicPage.status, 200);
    assert.equal(await publicPage.text(), 'published-page');
    const publicPdf = await fetch(`${base}/epaper/${parentId}/pdf`);
    assert.equal(publicPdf.status, 200);
    assert.equal(await publicPdf.text(), 'published-pdf');
  } finally {
    if (parentId) await fs.rm(epaper.editionDirectory(parentId), { recursive: true, force: true });
    if (pdfPath) await fs.rm(pdfPath, { force: true });
    if (childId) await pool.query('DELETE FROM newspapers WHERE id = $1', [childId]);
    if (parentId) await pool.query('DELETE FROM newspapers WHERE id = $1', [parentId]);
    server.close();
  }
});

test('a partial save does not reset the fields it was not asked about', async () => {
  const app = createApp();
  const server = app.listen(0);
  const port = server.address().port;
  const desk = await signIn(port);
  const base = `http://localhost:${port}`;
  let paperId = null;

  try {
    const paper = await desk(`/api/newspapers`, {
      method: 'POST',       body: JSON.stringify({ name: 'Partial save test', publicationDate: '2026-08-04' }),
    }).then((r) => r.json());
    paperId = paper.id;

    const page = await desk(`/api/newspapers/${paper.id}/pages`, {
      method: 'POST',       body: JSON.stringify({ pageNumber: 1, templateKey: 'front' }),
    }).then((r) => r.json());

    const before = page.sections.find((s) => s.section_key === 'lead');
    // The layout boxed the advert and sized the lead to its measure; a save that
    // says nothing about either must leave both alone.
    const advertBefore = page.sections.find((s) => s.section_key === 'top-advert');

    await desk(`/api/pages/${page.id}/sections/lead`, {
      method: 'PUT',       body: JSON.stringify({ headline: 'फक्त मथळा' }),
    });
    await desk(`/api/pages/${page.id}/sections/top-advert`, {
      method: 'PUT',       body: JSON.stringify({ headline: 'जाहिरात' }),
    });

    const validTint = await desk(`/api/pages/${page.id}/sections/lead`, {
      method: 'PUT', body: JSON.stringify({ backgroundColor: '#fbf3e9' }),
    });
    assert.equal(validTint.status, 200, 'a palette tint is accepted');
    const foreignTint = await desk(`/api/pages/${page.id}/sections/lead`, {
      method: 'PUT', body: JSON.stringify({ backgroundColor: 'red; background:url(evil)' }),
    });
    assert.equal(foreignTint.status, 400, 'an arbitrary style value is rejected at the API boundary');
    const zeroMargin = await desk(`/api/pages/${page.id}/sections/lead`, {
      method: 'PUT', body: JSON.stringify({ marginPx: 0 }),
    });
    assert.equal(zeroMargin.status, 400, 'zero is not offered when the compositor cannot honour it');

    const after = await desk(`/api/newspapers/${paper.id}/pages`).then((r) => r.json());
    const lead = after[0].sections.find((s) => s.section_key === 'lead');
    const advert = after[0].sections.find((s) => s.section_key === 'top-advert');

    assert.equal(lead.headline_font_px, before.headline_font_px, 'the type scale must survive a save');
    assert.equal(lead.body_font_px, before.body_font_px);
    assert.equal(lead.background_color, '#fbf3e9', 'a rejected colour leaves the accepted tint untouched');
    assert.equal(Number(lead.margin_px), 1, 'a rejected zero leaves the paper minimum untouched');
    assert.equal(advert.border_style, advertBefore.border_style, 'the layout box must survive a save');
  } finally {
    if (paperId) await pool.query('DELETE FROM newspapers WHERE id = $1', [paperId]);
    server.close();
  }
});
