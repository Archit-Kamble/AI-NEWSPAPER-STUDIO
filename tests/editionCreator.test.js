const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const load = () => import(path.join(__dirname, '..', 'public', 'admin', 'editions.js'));

test('editionForDate follows the selected date instead of silently returning today', async () => {
  const { editionForDate } = await load();
  const editions = [
    { id: 12, publication_date: '2026-08-26T00:00:00.000Z' },
    { id: 13, publication_date: '2026-08-27' },
  ];

  assert.equal(editionForDate(editions, '2026-08-26').id, 12);
  assert.equal(editionForDate(editions, '2026-08-27').id, 13);
  assert.equal(editionForDate(editions, '2026-08-28'), null);
});

test('the edition creator sends its complete production choices in one request', async () => {
  const { editionStartPayload } = await load();
  assert.deepEqual(editionStartPayload({
    publicationDate: '2026-08-28',
    pageCount: '8',
    name: '  सातारा विशेष  ',
    carryForward: false,
    fillFeatures: true,
  }), {
    publicationDate: '2026-08-28',
    pageCount: 8,
    name: 'सातारा विशेष',
    carryForward: false,
    fillFeatures: true,
  });
});

test('the edition creator keeps the production-safe defaults when optional controls are omitted', async () => {
  const { editionStartPayload } = await load();
  assert.deepEqual(editionStartPayload({ publicationDate: '2026-08-29' }), {
    publicationDate: '2026-08-29',
    pageCount: 4,
    carryForward: true,
    fillFeatures: true,
  });
});
