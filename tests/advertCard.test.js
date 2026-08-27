// THE DISPLAY ADVERTISEMENT CARD.
//
// An advertisement is a statement by the advertiser printed over this paper's
// masthead, so the thing this card must never do is invent one. These pin the
// two halves of that: the structuring prompt forbids a made-up price, date or
// telephone number, and the artwork brief forbids text in the image (generated
// Devanagari is unreadable, and the advertiser's words are the compositor's to
// set).

const test = require('node:test');
const assert = require('node:assert/strict');

const advert = require('../src/features/advert');
const newsImage = require('../src/services/newsImage.service');

const SOURCE = 'श्री गणेश ट्रेडर्स, सातारा — शेती अवजारे व पंप विक्री. १०% सवलत, २० सप्टेंबरपर्यंत. संपर्क ९८२२०१२३४५.';

const CARD = {
  advertiser: 'श्री गणेश ट्रेडर्स, सातारा',
  headline: 'शेती अवजारे व ठिबक संच',
  subheadline: 'विक्री, बसवणूक आणि दुरुस्ती',
  lines: ['सर्व प्रकारचे पाण्याचे पंप', 'अधिकृत सेवा केंद्र'],
  offer: 'सर्व पंपांवर १०% सवलत',
  contact: '९८२२० १२३४५',
  address: 'पोवई नाका, सातारा',
  footer: 'अटी लागू',
};

const stubAi = (data) => ({ askForJson: async () => ({ data, provider: 'stub', tier: 'basic' }) });

test('the advert brief forbids inventing anything the advertiser did not say', () => {
  const prompt = advert.promptFor(SOURCE);
  assert.match(prompt, /किंमत, सवलत, तारीख, हमी, पत्ता, दूरध्वनी क्रमांक किंवा दावा कधीही तयार करू नका/);
  // The pasted copy is source data, never instructions - the same boundary the
  // notice card and the information layer already hold.
  assert.match(prompt, /अविश्वसनीय source data/);
  assert.ok(prompt.includes(SOURCE), 'the advertiser\'s own words reach the model verbatim');
});

test('the artwork brief forbids text in the image and asks for the block\'s own shape', () => {
  const brief = newsImage.advertBriefFor({
    advertiser: 'श्री गणेश ट्रेडर्स', headline: 'शेती अवजारे', aspect: '4:3',
  });
  assert.match(brief, /NO text, no lettering, no numerals/);
  assert.match(brief, /no logos/);
  assert.match(brief, /aspect ratio approximately 4:3/i);
  // A generated advert illustration is NOT a news photograph and must not be
  // asked for as one.
  assert.doesNotMatch(brief, /documentary-style news photograph/);
});

test('a supplied picture always beats a generated one - nothing is asked of a model', async () => {
  let asked = 0;
  const built = await advert.build('2026-08-27', {
    sourceText: SOURCE,
    imageUrl: '/uploads/advertiser-own.jpg',
    wantsArtwork: true,
    aiClient: stubAi(CARD),
    imageService: {
      advertBriefFor: newsImage.advertBriefFor,
      propose: async () => { asked += 1; return { candidates: [], warning: '' }; },
    },
  });
  assert.equal(built.card.imageUrl, '/uploads/advertiser-own.jpg');
  assert.equal(built.card.aiArtwork, false);
  assert.equal(asked, 0, 'a desk holding the advertiser\'s own artwork is not asking a model to imagine it');
});

test('a refused illustration leaves an ordinary text advert, and says so', async () => {
  const built = await advert.build('2026-08-27', {
    sourceText: SOURCE,
    wantsArtwork: true,
    blockWidth: 268,
    blockHeight: 300,
    aiClient: stubAi(CARD),
    imageService: {
      advertBriefFor: newsImage.advertBriefFor,
      propose: async () => ({ candidates: [], warning: 'Google Gemini has no image quota.' }),
    },
  });
  // The card is still printable. An advert without a picture is an ordinary
  // advert; a provider that refuses must not take the whole card down with it.
  assert.equal(built.error, undefined);
  assert.equal(built.card.imageUrl, '');
  assert.match(built.warning, /image quota/);
  assert.equal(built.card.headline, CARD.headline);
});

test('the block a generated illustration is briefed for is the block it is going into', async () => {
  const briefs = [];
  await advert.build('2026-08-27', {
    sourceText: SOURCE,
    wantsArtwork: true,
    blockWidth: 268,
    blockHeight: 201,
    aiClient: stubAi(CARD),
    imageService: {
      advertBriefFor: newsImage.advertBriefFor,
      propose: async (_section, options) => { briefs.push(options.brief); return { candidates: [{ url: '/uploads/ai-1.png' }], warning: null }; },
    },
  });
  assert.equal(briefs.length, 1);
  // 268 x 201 reduces to 4:3 - the shape of the hole, so what comes back fits
  // the block rather than being cropped into it.
  assert.match(briefs[0], /approximately 4:3/);
});

test('empty or oversized source copy is refused before a provider is called', async () => {
  let asked = 0;
  const client = { askForJson: async () => { asked += 1; return { data: CARD }; } };
  assert.match((await advert.build('2026-08-27', { sourceText: '   ', aiClient: client })).error, /पेस्ट करा/);
  assert.match((await advert.build('2026-08-27', { sourceText: 'x'.repeat(20001), aiClient: client })).error, /२०,०००/);
  assert.equal(asked, 0);
});
