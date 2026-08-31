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

async function ensureOwner() {
  const hash = await bcrypt.hash('admin123', 4);
  await pool.query(
    `INSERT INTO users (name, email, password_hash, role, is_active)
     VALUES ('Owner', 'admin@esahas.com', $1, 'admin', TRUE)
     ON CONFLICT (email) DO UPDATE SET password_hash = $1, role = 'admin', is_active = TRUE`,
    [hash],
  );
}

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
