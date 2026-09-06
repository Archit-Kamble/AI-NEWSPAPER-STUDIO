// WRITING A STORY THAT DOES NOT FIT IN ONE BLOCK, AND SAYING WHERE THE NEWS IS.
//
// Three reports off one screen recording: carry-over "not working", a chart
// that has to be asked for separately from the story it plots, and a newsdesk
// run that can only ever ask about the town the office is in.

require('dotenv').config();
const test = require('node:test');
const assert = require('node:assert/strict');
const bcrypt = require('bcryptjs');
const pool = require('../src/config/db');
const { createApp } = require('../server');
const { signIn } = require('./helpers/desk');
const jump = require('../src/services/jump.service');
const writer = require('../src/services/storyWriter.service');

test.after(() => pool.end());

// The desk login these tests use is created and removed by
// tests/helpers/desk-owner.js. This used to upsert `admin@esahas.com` and
// REPLACE its password with a constant published in this repository - the
// real administrator of a real newspaper, overwritten on every run.
async function ensureOwner() { /* helpers/desk.js signs in as its own disposable owner */ }

test('a desk carries a story over because of the PAGE, not only because of the overflow', async () => {
  const server = createApp().listen(0);
  const port = server.address().port;
  let editionId = null;
  try {
    await ensureOwner();
    const desk = await signIn(port);
    const started = await (await desk('/api/newspapers/start', {
      method: 'POST', body: JSON.stringify({ publicationDate: '2099-05-06', pageCount: 4 }),
    })).json();
    editionId = started.newspaper.id;
    const pages = await (await desk(`/api/newspapers/${editionId}/pages`)).json();

    const open = (page) => page.sections.find((s) => s.block_type === 'article'
      && !(s.body || '').trim() && !(s.headline || '').trim() && !s.feature_key && !s.smart_card_key);
    const from = open(pages[0]);
    const to = open(pages[2]);
    assert.ok(from && to, 'a fresh edition has empty article blocks on pages one and three');

    // A SHORT STORY THAT COMFORTABLY FITS. This used to be refused with "All of
    // this story already fits — there is nothing to carry", which is the wrong
    // question: running a story across two legs is ordinary make-up, and a
    // paper starts its lead on page one and finishes it on page three because
    // that is how a front page is built.
    const body = ['पहिला परिच्छेद. यात काही मजकूर आहे.',
      'दुसरा परिच्छेद. यातही मजकूर आहे.',
      'तिसरा परिच्छेद, जो शेवटचा आहे.'].join('\n\n');
    await desk(`/api/pages/${pages[0].id}/sections/${from.section_key}`, {
      method: 'PUT', body: JSON.stringify({ headline: 'चाचणी मथळा', subheading: 'उपमथळा', body }),
    });

    const carried = await desk(`/api/pages/${pages[0].id}/sections/${from.section_key}/carry-over`, {
      method: 'POST', body: JSON.stringify({ toPageId: pages[2].id, toSectionKey: to.section_key }),
    });
    // Read ONCE - a Response body cannot be consumed twice, and reading it in
    // the assertion message and again afterwards throws before the assertion
    // it was meant to explain ever runs.
    const result = await carried.json();
    assert.equal(carried.status, 200, JSON.stringify(result).slice(0, 200));
    assert.equal(result.ok, true);

    const after = await (await desk(`/api/newspapers/${editionId}/pages`)).json();
    const leg1 = after[0].sections.find((s) => s.section_key === from.section_key);
    const leg2 = after[2].sections.find((s) => s.section_key === to.section_key);

    // WHAT THE DESK ASKED FOR, exactly: the first leg keeps the display type
    // and ends by saying where the story goes; the second carries body only,
    // opening with where it came from.
    assert.ok(leg1.headline, 'the first leg keeps its headline');
    assert.ok(leg1.subheading, 'and its deck');
    assert.match(leg1.body, /उर्वरित पान ३ वर/, 'and ends by naming the page it continues on');
    assert.equal(leg2.subheading || '', '', 'the second leg carries no deck');
    assert.match(leg2.body, /पान १ वरून/, 'and opens by naming the page it came from');
    assert.equal(Number(leg2.continued_from_section_id), Number(leg1.id), 'the two are linked');

    // A SINGLE SENTENCE still refuses: a jump line and a pick-up line either
    // side of half a sentence is not a continuation.
    await desk(`/api/pages/${pages[0].id}/sections/${from.section_key}/reunite`, { method: 'POST', body: '{}' });
    await desk(`/api/pages/${pages[0].id}/sections/${from.section_key}`, {
      method: 'PUT', body: JSON.stringify({ headline: 'एक', subheading: '', body: 'एकच वाक्य' }),
    });
    const tiny = await desk(`/api/pages/${pages[0].id}/sections/${from.section_key}/carry-over`, {
      method: 'POST', body: JSON.stringify({ toPageId: pages[2].id, toSectionKey: to.section_key }),
    });
    assert.equal(tiny.status, 400);
    assert.match((await tiny.json()).error, /single sentence/);
  } finally {
    if (editionId) {
      const desk = await signIn(port);
      await desk(`/api/newspapers/${editionId}`, { method: 'DELETE' });
    }
    server.close();
  }
});

test('the room the pair has is measured with the display type the story will carry', async () => {
  const server = createApp().listen(0);
  const port = server.address().port;
  let editionId = null;
  try {
    await ensureOwner();
    const desk = await signIn(port);
    const started = await (await desk('/api/newspapers/start', {
      method: 'POST', body: JSON.stringify({ publicationDate: '2099-05-07', pageCount: 4 }),
    })).json();
    editionId = started.newspaper.id;
    const pages = await (await desk(`/api/newspapers/${editionId}/pages`)).json();
    const open = (page) => page.sections.find((s) => s.block_type === 'article'
      && !(s.body || '').trim() && !(s.headline || '').trim() && !s.feature_key && !s.smart_card_key);
    const from = open(pages[0]);
    const to = open(pages[2]);

    const rooms = await jump.roomsFor(pages[0].id, from.section_key, {
      toPageId: pages[2].id, toSectionKey: to.section_key,
      headline: 'एक साधा मथळा', subheading: 'एक ओळ',
    });
    assert.ok(rooms.sourceRoom > 0 && rooms.landingRoom > 0);
    assert.equal(rooms.total, rooms.sourceRoom + rooms.landingRoom);
    assert.equal(rooms.samePage, false);
    assert.equal(rooms.pageNumber, 3);

    // A LONGER HEADLINE LEAVES THE FIRST LEG LESS ROOM, which is the whole
    // reason this is asked twice - once to size the brief and once, with the
    // real display type, to decide what the copy is trimmed to.
    const roomy = await jump.roomsFor(pages[0].id, from.section_key, {
      toPageId: pages[2].id, toSectionKey: to.section_key, headline: '', subheading: '',
    });
    assert.ok(roomy.sourceRoom > rooms.sourceRoom,
      `no display type should leave more room (${roomy.sourceRoom} vs ${rooms.sourceRoom})`);
    // The landing never carries a headline, so its room does not move.
    assert.equal(roomy.landingRoom, rooms.landingRoom);
  } finally {
    if (editionId) {
      const desk = await signIn(port);
      await desk(`/api/newspapers/${editionId}`, { method: 'DELETE' });
    }
    server.close();
  }
});

test('a chart is asked for with the story, and only when the desk asks', () => {
  // The key is ALWAYS in the schema - a model told to omit one answers less
  // reliably than one told to fill it - and write() drops it when the desk did
  // not ask, which is the only way the drop is guaranteed rather than hoped for.
  assert.ok(writer.STORY_SCHEMA.properties.chart, 'the key is always offered');
  assert.ok(!writer.STORY_SCHEMA.required.includes('chart'), 'and never required');

  const reading = writer.STORY_SCHEMA.properties.chart.properties.items.items;
  assert.equal(reading.properties.value.type, 'number',
    'a figure is a number - a chart plots quantities, not strings');
  assert.equal(writer.STORY_SCHEMA.properties.chart.additionalProperties, false);
});

test('where the local news is: a catalogue, not a free-text box', async () => {
  const places = await import('../public/editor/layout/places.js');

  assert.equal(places.DEFAULT_PLACE.district, 'Satara');
  assert.equal(places.DEFAULT_PLACE.state, 'MH');
  assert.ok(places.districtsOf('MH').includes('Sangli'), 'the neighbouring district is offerable');
  assert.ok(places.districtsOf('MH').includes('Satara'));
  // A state this file carries no districts for takes free text rather than
  // pretending to a completeness it has not got.
  assert.equal(places.districtsOf('KA'), null);

  // A QUERY READS MOST SPECIFIC FIRST, and never carries an empty part.
  assert.equal(places.placeQuery({ state: 'MH', district: 'Satara', city: 'Vaduj' }), 'Vaduj, Satara, Maharashtra');
  assert.equal(places.placeQuery({ state: 'MH', district: 'Satara', city: '' }), 'Satara, Maharashtra');
  assert.equal(places.placeQuery({ state: 'MH' }), 'Maharashtra');

  // A misspelt district returns nothing and looks exactly like a district with
  // no news today, so an unknown one is refused rather than stored.
  assert.equal(places.placeOf({ state: 'MH', district: 'Nowhereabad' }).district, '');
  assert.equal(places.placeOf({ state: 'MH', district: 'Sangli' }).district, 'Sangli');
  assert.equal(places.placeOf({ state: 'ZZ' }).state, 'MH', 'an unknown state falls back');
  // But a state with no district list takes what it is given.
  assert.equal(places.placeOf({ state: 'KA', district: 'Belagavi' }).district, 'Belagavi');
});

test('a settings save that never mentions the coverage leaves it alone', async () => {
  const server = createApp().listen(0);
  const port = server.address().port;
  try {
    await ensureOwner();
    const owner = await signIn(port);
    const before = await (await owner('/api/settings/general')).json();

    // EVERY CALLER WRITTEN BEFORE THE COVERAGE EXISTED sends no coverage at
    // all. Treating that as "clear it" wiped the district to empty and the
    // Newsdesk Run then opened on the whole state - found by watching the panel
    // say "Chasing: Maharashtra" where it should have said Satara.
    const saved = await owner('/api/settings/general', {
      method: 'PUT',
      body: JSON.stringify({
        publicationName: before.publication_name,
        contactEmail: before.contact_email,
        timezone: before.timezone,
        defaultLanguage: before.default_language,
      }),
    });
    assert.equal(saved.status, 200);
    const after = await (await owner('/api/settings/general')).json();
    assert.equal(after.coverage_district, before.coverage_district);
    assert.equal(after.coverage_state, before.coverage_state);
  } finally {
    server.close();
  }
});
