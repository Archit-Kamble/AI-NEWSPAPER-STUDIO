const test = require('node:test');
const assert = require('node:assert/strict');

const market = require('../src/features/market');

function responseFor(symbol) {
  const closes = {
    '^BSESN': [77000, 77770],
    '^NSEI': [24000, 23880],
    'GC=F': [4600, 4646],
    'SI=F': [68, 68],
    // The rupee rate the bullion closes are converted through - fetched from
    // the same session as the metal it converts, so a Tuesday gold close is
    // never priced at Thursday's rupee.
    'INR=X': [88, 88],
  }[symbol];
  return {
    ok: true, status: 200,
    async json() {
      return {
        chart: { result: [{
          timestamp: [1787616000, 1787702400],
          indicators: { quote: [{ close: closes }] },
        }] },
      };
    },
  };
}

test('market card fetches every rate automatically and derives the previous-session brief', async () => {
  const calls = [];
  const result = await market.build('2026-08-27', {
    currentDate: '2026-08-27',
    fetchImpl: async (url) => {
      const parsed = new URL(url);
      const symbol = decodeURIComponent(parsed.pathname.split('/').pop());
      calls.push({ symbol, parsed });
      return responseFor(symbol);
    },
  });

  assert.deepEqual(calls.map((call) => call.symbol), ['^BSESN', '^NSEI', 'GC=F', 'SI=F', 'INR=X']);
  assert.equal(result.card.items.length, 4);
  assert.equal(result.card.items[0].change, '+१.००%');
  // The minus is U+2212, the typographic sign a printed rate table sets - not
  // the hyphen a keyboard produces.
  assert.equal(result.card.items[1].change, '\u2212०.५०%');
  assert.equal(result.card.items[0].direction, 'up');
  assert.equal(result.card.items[1].direction, 'down');

  // BULLION IS PRINTED IN RUPEES PER १० ग्रॅम AND PER किलो, NOT IN DOLLARS
  // PER TROY OUNCE. 4646 $/oz at Rs 88 is Rs 1,31,478 per 10 g.
  const gold = result.card.items.find((item) => item.key === 'gold');
  assert.equal(gold.unit, '१० ग्रॅम');
  assert.match(gold.value, /^₹/);
  assert.equal(gold.value, `₹${new Intl.NumberFormat('mr-IN', { maximumFractionDigits: 0 })
    .format(Math.round((4646 * 88 * 10) / market.GRAMS_PER_TROY_OUNCE))}`);
  const silver = result.card.items.find((item) => item.key === 'silver');
  assert.equal(silver.unit, 'किलो');
  assert.match(silver.value, /^₹/);

  // The brief says which way the session went and names the biggest mover -
  // never the same verb three times over.
  assert.match(result.card.yesterdayBrief, /संमिश्र|वधारले|घसरले|स्थिर/);
  assert.match(result.card.yesterdayBrief, /सर्वाधिक हालचाल/);
  // And the card SAYS the bullion rate is derived, rather than passing an
  // international parity off as a सराफा retail quote.
  assert.match(result.card.note, /सूचक दर/);
  assert.equal(result.card.source, 'स्रोत : Yahoo Finance · बंद भाव');
});

test('a close of zero is not a price - the row is refused, not printed as Rs 0', async () => {
  // The live FX feed really returned `INR=X` close 0 for the newest session,
  // which is its way of saying "not settled yet". Number.isFinite let it
  // through and the card went out reading सोने ₹० and −१००.००%.
  const zeroed = await market.build('2026-08-27', {
    currentDate: '2026-08-27',
    fetchImpl: async (url) => {
      const symbol = decodeURIComponent(new URL(url).pathname.split('/').pop());
      if (symbol !== 'INR=X') return responseFor(symbol);
      return {
        ok: true,
        async json() {
          return {
            chart: { result: [{
              timestamp: [1787616000, 1787702400],
              indicators: { quote: [{ close: [88, 0] }] },
            }] },
          };
        },
      };
    },
  });
  assert.equal(zeroed.upstream, true);
  assert.match(zeroed.error, /विश्वासार्ह बाजार/);
});

test('market card refuses a future edition and incomplete provider data', async () => {
  const future = await market.build('2026-08-28', { currentDate: '2026-08-27' });
  assert.match(future.error, /भविष्यातील तारीख/);

  const broken = await market.build('2026-08-27', {
    currentDate: '2026-08-27',
    fetchImpl: async () => ({ ok: true, async json() { return { chart: { result: [] } }; } }),
  });
  assert.equal(broken.upstream, true);
  assert.match(broken.error, /विश्वासार्ह बाजार/);
});
