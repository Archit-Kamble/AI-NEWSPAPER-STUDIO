// A malformed card must never take the page down.
//
// Two of the Smart Cards are written by a model (राशिभविष्य and सुविचार) and the
// rest are computed. The computed ones cannot be malformed. The written ones
// can: a provider can drop a sign, send eleven instead of twelve, put a string
// where a number belongs, or return an empty text - and `written.js` catches
// the missing-sign case, but nothing stops a card that was SAVED months ago
// from being drawn again today by a renderer that has since changed.
//
// The rule this holds: a card the renderer cannot make sense of falls back to
// prose or to nothing. It never throws, because the thing it would take down is
// the newspaper canvas - every block on the page, not just the broken one.

const test = require('node:test');
const assert = require('node:assert/strict');

let cards;
test.before(async () => {
  cards = await import('../public/editor/smart-cards/smart-cards.js');
});

const MALFORMED = {
  'null data': null,
  'undefined data': undefined,
  'a string where an object belongs': 'सुविचार',
  'a number': 42,
  'an empty object': {},
  'an array': [],
  'signs missing entirely': { signs: undefined },
  'signs is not a list': { signs: 'मेष' },
  'an empty list of signs': { signs: [] },
  'eleven signs instead of twelve': { signs: Array.from({ length: 11 }, (_, i) => ({ key: `k${i}`, name: 'मेष', text: 'ठीक' })) },
  'a sign with no key': { signs: [{ name: 'मेष', text: 'ठीक' }] },
  'a sign with no text': { signs: [{ key: 'mesh', name: 'मेष' }] },
  'a sign that is null': { signs: [null] },
  'a lucky number that is a string': { signs: [{ key: 'mesh', name: 'मेष', text: 'ठीक', luckyNumber: 'सात' }] },
  'an empty text': { text: '', attribution: '' },
  'attribution only': { attribution: 'अज्ञात' },
  'extra fields nobody asked for': { text: 'विचार', attribution: 'अज्ञात', colour: 'red', nested: { deep: [1, 2] } },
  'a grid that is not a grid': { grid: 'क' },
  'a grid with the wrong number of rows': { grid: [[1, 2, 3]] },
  'a grid row that is null': { grid: [null, null] },
  'entries that are not a list': { entries: 7 },
  'items that are not a list': { items: 'काही' },
};

test('no malformed card can throw out of the renderer', () => {
  for (const key of cards.SMART_CARD_KEYS) {
    for (const [name, data] of Object.entries(MALFORMED)) {
      assert.doesNotThrow(
        () => cards.smartCardMarkup(key, data),
        `${key} threw on ${name} — this would take the whole page canvas down, not one block`,
      );
      assert.doesNotThrow(
        () => cards.smartCardText(key, data),
        `${key} threw rendering ${name} to body copy — everything that MEASURES a block reads that text`,
      );
    }
  }
});

test('what it returns for a broken card is drawable, or nothing at all', () => {
  for (const key of cards.SMART_CARD_KEYS) {
    for (const [name, data] of Object.entries(MALFORMED)) {
      const markup = cards.smartCardMarkup(key, data);
      assert.ok(markup === null || typeof markup === 'string',
        `${key} on ${name} returned something the canvas cannot put in innerHTML`);
      const text = cards.smartCardText(key, data);
      assert.ok(text === null || typeof text === 'string',
        `${key} on ${name} returned a non-string to the character grid`);
    }
  }
});

test('an unrecognised card key falls through rather than vanishing', () => {
  assert.equal(cards.canRenderSmartCard('no-such-card'), false);
  assert.equal(cards.smartCardMarkup('no-such-card', { text: 'x' }), null,
    'null is the signal to draw it as ordinary prose - a feature can never silently disappear off the page');
  assert.equal(cards.smartCardMarkup(null, null), null);
  assert.equal(cards.smartCardMarkup(undefined, undefined), null);
});

test('a good card still draws — the guard did not blunt the renderer', () => {
  const rashi = cards.smartCardMarkup('rashi', {
    signs: [{ key: 'mesh', name: 'मेष', text: 'आजचा दिवस चांगला.', luckyNumber: 7, luckyColour: 'निळा' }],
  });
  assert.match(rashi, /मेष/);
  assert.match(rashi, /आजचा दिवस चांगला/);

  const suvichar = cards.smartCardMarkup('suvichar', { text: 'प्रयत्ने वाळूचे कण रगडिता तेलही गळे.', attribution: 'समर्थ रामदास' });
  assert.match(suvichar, /प्रयत्ने/);
  assert.match(suvichar, /रामदास/);

  const grid = Array.from({ length: 9 }, () => Array.from({ length: 9 }, () => 0));
  grid[0][0] = 5;
  const sudoku = cards.smartCardMarkup('sudoku', { grid });
  assert.equal((sudoku.match(/<td/g) || []).length, 81, 'nine rows of nine, still');
});
