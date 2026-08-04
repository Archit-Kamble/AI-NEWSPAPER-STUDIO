// The standing furniture of the paper.
//
// A newspaper page carries three kinds of ink: what never changes (the
// nameplate, the printline, the cover price), what changes daily but is
// derivable (the date line, the volume and issue number, the page count), and
// the day's file. Only the last is anyone's work. These tests hold the middle
// row: the numbers a date already determines must never have to be keyed, and
// must never drift.

const test = require('node:test');
const assert = require('node:assert/strict');
const { createApp } = require('../server');
const pool = require('../src/config/db');
const { signIn } = require('./helpers/desk');
const { identity, identityFor, numberingFor, dateLine } = require('../src/layout/identity');

test.after(() => pool.end());

test('the issue number advances by exactly one a day', () => {
  const monday = numberingFor('2026-08-03');
  const tuesday = numberingFor('2026-08-04');

  assert.equal(tuesday.issue, monday.issue + 1);
  assert.equal(tuesday.volume, monday.volume);
});

test('the volume turns over on the founding anniversary, and the issue restarts', () => {
  const lastDay = numberingFor('2025-12-31');
  const firstDay = numberingFor('2026-01-01');

  assert.equal(firstDay.volume, lastDay.volume + 1);
  assert.equal(firstDay.issue, 1);
  assert.equal(lastDay.issue, 365);
});

test('the paper started at volume one, issue one', () => {
  const first = numberingFor(identity.foundedOn);
  assert.deepEqual({ volume: first.volume, issue: first.issue }, { volume: 1, issue: 1 });
});

test('the date line is set in Marathi and Devanagari numerals', () => {
  // 3 August 2026 was a Monday.
  assert.deepEqual(dateLine('2026-08-03'), {
    day: '३',
    weekday: 'सोमवार',
    monthYear: 'ऑगस्ट २०२६',
  });
});

test('a date is read as a day, never shifted by a timezone', () => {
  // The trap this guards: node-pg used to hand a DATE back as a local-midnight
  // Date, which east of Greenwich serialises to the previous day in UTC. An
  // edition dated the 3rd then printed as the 2nd.
  assert.deepEqual(dateLine('2026-08-03T00:00:00.000Z').day, '३');
  assert.deepEqual(dateLine('2026-08-03').day, '३');
});

test('GET /api/identity carries the standing facts and the edition numbering', async () => {
  const app = createApp();
  const server = app.listen(0);
  const port = server.address().port;
  const desk = await signIn(port);

  try {
    const response = await desk(`/api/identity?date=2026-08-03&pages=4`);
    assert.equal(response.status, 200);
    const body = await response.json();

    assert.equal(body.nameplateUrl, identity.nameplateUrl);
    assert.equal(body.rni, identity.rni);
    assert.ok(body.printline, 'the printline is a legal requirement and must be served');
    assert.equal(body.volumeLine, identityFor('2026-08-03', 4).volumeLine);
    assert.equal(body.pageCountLabel, 'पृष्ठे ४');
  } finally {
    server.close();
  }
});

test('an edition stored on one day is served as that same day', async () => {
  const app = createApp();
  const server = app.listen(0);
  const port = server.address().port;
  const desk = await signIn(port);
  let id = null;

  try {
    const created = await desk(`/api/newspapers`, {
      method: 'POST',
            body: JSON.stringify({ name: 'Identity date test', publicationDate: '2026-08-03' }),
    }).then((r) => r.json());
    id = created.id;

    const fetched = await desk(`/api/newspapers/${id}`).then((r) => r.json());
    assert.equal(String(fetched.publication_date).slice(0, 10), '2026-08-03');
  } finally {
    if (id) await pool.query('DELETE FROM newspapers WHERE id = $1', [id]);
    server.close();
  }
});
