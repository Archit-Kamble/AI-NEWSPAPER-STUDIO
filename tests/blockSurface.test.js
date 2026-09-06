// THE BLOCK'S OWN SURFACE - what it is for, what it shows, and what it is set in.
//
// Five reports off one screen recording, and they are five different things
// wearing the same clothes: a queue full of copy nobody filed, a label sitting
// over the headline it names, a viewport that jumps on the first click, a
// block whose purpose only a template could set, and a palette of four.

require('dotenv').config();
const test = require('node:test');
const assert = require('node:assert/strict');
const bcrypt = require('bcryptjs');
const pool = require('../src/config/db');
const { createApp } = require('../server');
const { signIn } = require('./helpers/desk');

test.after(() => pool.end());

const SUFFIX = `${process.pid}-${Date.now()}`;

// The desk login these tests use is created and removed by
// tests/helpers/desk-owner.js. This used to upsert `admin@esahas.com` and
// REPLACE its password with a constant published in this repository - the
// real administrator of a real newspaper, overwritten on every run.
async function ensureOwner() { /* helpers/desk.js signs in as its own disposable owner */ }

test("a reporter's draft is their own - the desk's list carries what was FILED", async () => {
  const server = createApp().listen(0);
  const port = server.address().port;
  let reporterId = null;
  const made = [];
  try {
    await ensureOwner();
    const owner = await signIn(port);
    const email = `zz-draft-${SUFFIX}@example.test`;
    const created = await (await owner('/api/staff', {
      method: 'POST',
      body: JSON.stringify({ name: 'ZZ Draft Reporter', email, password: 'draft-pass-123', role: 'reporter' }),
    })).json();
    reporterId = created.id;

    const reporter = await signIn(port, { email, password: 'draft-pass-123', role: 'reporter' });
    const draft = await (await reporter('/api/news', {
      method: 'POST', body: JSON.stringify({ title: `ZZ unfinished ${SUFFIX}`, description: 'half a sentence', status: 'draft' }),
    })).json();
    const filed = await (await reporter('/api/news', {
      method: 'POST', body: JSON.stringify({ title: `ZZ filed ${SUFFIX}`, description: 'ready for the desk', status: 'pending' }),
    })).json();
    made.push(draft.id, filed.id);

    // THE DESK'S LIST. It is not only noise: the Take-from-Reporter picker
    // reads this same list, so an unsubmitted draft in it is a story a
    // sub-editor could put on page one that its author never sent.
    const deskList = await (await owner('/api/news')).json();
    const titles = deskList.map((n) => n.title);
    assert.ok(titles.includes(`ZZ filed ${SUFFIX}`), 'a filed story reaches the desk');
    assert.ok(!titles.includes(`ZZ unfinished ${SUFFIX}`), 'an unsubmitted draft does not');
    assert.equal(deskList.some((n) => n.status === 'draft'), false, 'no draft of anybody\'s is in the desk list');

    // THE REPORTER'S OWN INBOX still holds it - that is what a draft is for.
    const mine = await (await reporter('/api/news')).json();
    assert.ok(mine.map((n) => n.title).includes(`ZZ unfinished ${SUFFIX}`), 'a reporter keeps their own drafts');

    // And a desk that asks for drafts BY NAME is not being surprised by them.
    const asked = await (await owner('/api/news?status=draft')).json();
    assert.ok(asked.every((n) => n.status === 'draft'));
    assert.ok(asked.length > 0, 'an explicit question is still answered');
  } finally {
    if (made.length) await pool.query('DELETE FROM news_items WHERE id = ANY($1)', [made]);
    if (reporterId) await pool.query('DELETE FROM users WHERE id = $1', [reporterId]);
    await pool.query(`DELETE FROM users WHERE email LIKE 'zz-draft-%${SUFFIX}@example.test'`);
    server.close();
  }
});

test('a desk can say what a block is for, and fill it in the same press', async () => {
  const server = createApp().listen(0);
  const port = server.address().port;
  let editionId = null;
  try {
    await ensureOwner();
    const desk = await signIn(port);
    const started = await (await desk('/api/newspapers/start', {
      method: 'POST', body: JSON.stringify({ publicationDate: '2099-05-05', pageCount: 4 }),
    })).json();
    editionId = started.newspaper.id;
    const pages = await (await desk(`/api/newspapers/${editionId}/pages`)).json();
    const page = pages[0];
    const block = page.sections.find((s) => s.block_type !== 'feature') || page.sections[0];

    // A COMPUTED feature, so this test needs no AI key and no network: the
    // point is the plumbing, not whether a model answered.
    const set = await desk(`/api/pages/${page.id}/sections/${block.section_key}/purpose`, {
      method: 'PATCH', body: JSON.stringify({ featureKey: 'panchang', fill: true }),
    });
    assert.equal(set.status, 200);
    const result = await set.json();
    assert.equal(result.section.feature_key, 'panchang');
    // NAMING A FEATURE IMPLIES THE KIND. A block carrying the almanac is a
    // feature block whatever anybody typed, and a desk should not have to say
    // one thing twice for it to be true.
    assert.equal(result.section.block_type, 'feature');
    assert.equal(result.filled.filled.length, 1, JSON.stringify(result.filled).slice(0, 200));
    assert.equal(result.filled.filled[0].feature, 'panchang');

    const after = await (await desk(`/api/newspapers/${editionId}/pages`)).json();
    const stored = after[0].sections.find((s) => s.section_key === block.section_key);
    assert.equal(stored.smart_card_key, 'panchang', 'the card itself is in the block, not just prose');
    assert.ok((stored.body || '').length > 0);

    // And it can be taken back off.
    const cleared = await (await desk(`/api/pages/${page.id}/sections/${block.section_key}/purpose`, {
      method: 'PATCH', body: JSON.stringify({ featureKey: null, blockType: 'article' }),
    })).json();
    assert.equal(cleared.section.feature_key, null);
    assert.equal(cleared.section.block_type, 'article');

    // An invented feature is refused rather than stored.
    const bad = await desk(`/api/pages/${page.id}/sections/${block.section_key}/purpose`, {
      method: 'PATCH', body: JSON.stringify({ featureKey: 'not-a-feature' }),
    });
    assert.equal(bad.status, 400);
    const badKind = await desk(`/api/pages/${page.id}/sections/${block.section_key}/purpose`, {
      method: 'PATCH', body: JSON.stringify({ blockType: 'not-a-kind' }),
    });
    assert.equal(badKind.status, 400);
  } finally {
    if (editionId) {
      const desk = await signIn(port);
      await desk(`/api/newspapers/${editionId}`, { method: 'DELETE' });
    }
    server.close();
  }
});

test('the palette got longer, and everything still separates onto four plates', async () => {
  const inks = await import('../public/editor/layout/inks.js');
  assert.ok(inks.INKS.length >= 7, 'more inks for a character, a word or a line');
  assert.ok(inks.TINTS.length >= 8, 'more grounds for a block');

  // EVERY ONE IS NAMED AND SEPARATED. An ink with no Scribus name reaches the
  // press file as an auto-generated colour, which is a real colour with a name
  // that says nothing in a file a designer opens by hand.
  for (const ink of inks.INKS) {
    assert.ok(ink.scribus, `${ink.key} has no separation`);
    if (ink.hex) assert.match(ink.hex, /^#[0-9a-f]{6}$/i, ink.key);
  }
  for (const tint of inks.TINTS) {
    assert.ok(tint.scribus, `${tint.key} has no separation`);
  }
  // And the .sla names them all, or a block set in one prints black.
  const scribus = require('fs').readFileSync('src/services/scribus.service.js', 'utf8');
  for (const entry of [...inks.INKS, ...inks.TINTS]) {
    if (entry.scribus === 'None' || entry.scribus === 'Black') continue;
    assert.ok(scribus.includes(`NAME="${entry.scribus}"`), `${entry.scribus} is not defined in the .sla`);
  }

  // A foreign colour is still refused - a longer palette is not an open one.
  assert.equal(inks.sanitiseInk('#ff00ff'), null);
  assert.equal(inks.sanitiseTint('#ff00ff'), null);
  assert.equal(inks.sanitiseInk('#5b2a86'), '#5b2a86');
});

test('a display band may carry a screen, and it names the compositor\'s own band', async () => {
  const inks = await import('../public/editor/layout/inks.js');
  assert.deepEqual(inks.groundedBands('plain'), []);
  assert.deepEqual(inks.groundedBands('reverse'), []);
  assert.deepEqual(inks.groundedBands('band'), ['headline']);
  // `deck`, NOT `subheading`. That is the compositor's own key for the band
  // (BAND_CLASS in compose/render.js) - naming the column drew the screen
  // behind the headline and silently nothing behind the deck.
  assert.deepEqual(inks.groundedBands('band-deck'), ['deck']);
  assert.deepEqual(inks.groundedBands('band-both'), ['headline', 'deck']);
  assert.deepEqual(inks.groundedBands('nonsense'), []);

  // A screen is the ink laid down lightly - light enough to read black
  // Devanagari through, which is why the type is left in its own colour.
  const screen = inks.screenOf('#c8102e');
  assert.match(screen, /^#[0-9a-f]{6}$/i);
  const value = parseInt(screen.slice(1), 16);
  const channels = [(value >> 16) & 0xff, (value >> 8) & 0xff, value & 0xff];
  assert.ok(channels.every((c) => c > 200), `${screen} is too heavy to set type on`);
});

test('a table is a card, so it lives in a block or a panel with no second implementation', async () => {
  const [{ ensureFontsLoaded }, { ensureShaperReady }, layout] = await Promise.all([
    import('../public/editor/compose/font-metrics.js'),
    import('../public/editor/compose/shaper.js'),
    import('../public/editor/smart-cards/layout.js'),
  ]);
  await Promise.all([ensureFontsLoaded(), ensureShaperReady()]);
  const { smartCardLines } = require('../src/services/export/smart-card-lines');
  const cards = await import('../public/editor/smart-cards/smart-cards.js');

  const card = {
    columns: ['गाव', 'मते', 'टक्के'],
    rows: [['सातारा', '१२०००', '४२'], ['वडूज', '८५००', '३०'], ['पुसेगाव', '७९००', '२८']],
    source: 'स्रोत : निवडणूक विभाग',
  };
  const frame = { width: 220, height: 160 };
  const solved = layout.layoutSmartCard('table', card, frame);
  assert.equal(solved.fitState, 'FITS');
  assert.equal(solved.items.length, 3);
  assert.equal(solved.geometry.columns, 3);

  // EVERY COLUMN IS MEASURED FROM ITS OWN CONTENT AND THEY ARE SCALED TOGETHER,
  // so the proportions are the content's and the total is exactly the frame.
  // Scaling them independently is how a table comes to have one column of air
  // beside one that clips.
  // Against the card's own CONTENT box, not the frame: a table is ruled
  // (CARD_BORDERS), and a ruled card sets its type inside its own rule.
  const total = solved.geometry.widths.reduce((sum, w) => sum + w, 0);
  const contentWidth = solved.contentBox.width;
  assert.ok(Math.abs(total - contentWidth) < 0.5, `columns total ${total}, content box ${contentWidth}`);
  assert.ok(contentWidth < frame.width, 'and that box is inside the rule, not on it');
  assert.ok(solved.geometry.widths.every((w) => w > 0));
  // And it says how tall it really is, so a panel can be cut to it - the same
  // rule the chart follows.
  assert.ok(solved.geometry.contentHeight > 0);
  assert.ok(solved.geometry.contentHeight <= frame.height);

  // THE PLATE DRAWS WHAT THE CANVAS DRAWS. Every cell reaches the export walk,
  // in the face the solver measured it in.
  const lines = smartCardLines('table', card, frame, layout);
  const texts = lines.filter((l) => !l.kind && l.text).map((l) => l.text);
  for (const cell of ['गाव', 'सातारा', '१२०००', 'टक्के', 'स्रोत : निवडणूक विभाग']) {
    assert.ok(texts.includes(cell), `"${cell}" never reaches the plate`);
  }
  assert.ok(lines.filter((l) => !l.kind && l.text).every((l) => l.family === 'sans'));
  // The head rule and the row hairlines are ink, and they are emitted.
  assert.ok(lines.filter((l) => l.kind === 'bar').length >= 3, 'the rules reach the plate');

  // A CARD SAYS WHAT IT HOLDS, for everything that measures a block by its copy.
  const prose = cards.smartCardText('table', card);
  assert.match(prose, /सातारा/);
  assert.match(prose, /गाव/);

  // And a malformed one draws nothing rather than throwing - an EMPTY card
  // carries no geometry at all, and reading through it takes the whole page
  // canvas down rather than one block.
  assert.equal(layout.layoutSmartCard('table', { rows: [] }, frame).fitState, 'EMPTY');
  assert.doesNotThrow(() => cards.smartCardMarkup('table', { rows: [] }, frame));
  assert.doesNotThrow(() => cards.smartCardMarkup('table', 'not a card', frame));
});

test('a table panel is sanitised on its own terms - a grid, not a list of readings', () => {
  const { panelOf } = require('../public/editor/layout/inset-panels');
  const frame = { width: 300, height: 300 };
  const panel = panelOf({
    id: 't', kind: 'table', x: 10, y: 10, width: 120, height: 90,
    card: { columns: ['a', 'b'], rows: [['1', '2'], ['3', '4']], source: 's' },
  }, frame);
  assert.equal(panel.kind, 'table');
  assert.deepEqual(panel.card.columns, ['a', 'b']);
  assert.equal(panel.card.rows.length, 2);

  // A table panel with no grid in it is refused, exactly as a chart panel with
  // no readings is: the card IS the panel, and without one there is nothing to
  // draw but a rectangle the copy is set clear of for no reason.
  assert.equal(panelOf({ id: 't', kind: 'table', width: 120, height: 90 }, frame), null);
  assert.equal(panelOf({ id: 't', kind: 'table', width: 120, height: 90, card: { rows: [] } }, frame), null);
});
