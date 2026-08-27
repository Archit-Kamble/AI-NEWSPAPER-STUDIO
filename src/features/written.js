// The daily features a model writes: आजचे राशिभविष्य, आजचा सुविचार, शब्दकोडे.
//
// The economics are the whole point. A paper that asked the model once per
// zodiac sign would make twelve calls a day for one box; asked once per box, it
// would make three or four. This makes ONE call for the whole day's standing
// features, because they share a date, a language and a house style and none of
// them depends on another's answer. Same output, a third of the tokens, one
// round trip - and one place where the paper's voice is set.
//
// What may be written this way and what may not:
//
//   MAY   राशिभविष्य, सुविचार, कोडी - writing that is understood to be
//         entertainment or reflection. Nobody is misled by a generated
//         horoscope; that is what a horoscope is.
//
//   MAY NOT  anything that asserts a fact about the world: gold rates, market
//         closes, mandi prices, weather numbers, "on this day in history".
//         Those come from a source or they do not run. A model asked for
//         yesterday's gold rate will produce a number, and it will be wrong,
//         and it will be printed under this paper's masthead.

const ai = require('../services/ai.service');

// The twelve signs, in the order every Marathi almanac prints them, with the
// Sanskrit-derived names a reader looks for.
const RASHIS = [
  { key: 'mesh', name: 'मेष', english: 'Aries' },
  { key: 'vrishabh', name: 'वृषभ', english: 'Taurus' },
  { key: 'mithun', name: 'मिथुन', english: 'Gemini' },
  { key: 'kark', name: 'कर्क', english: 'Cancer' },
  { key: 'sinh', name: 'सिंह', english: 'Leo' },
  { key: 'kanya', name: 'कन्या', english: 'Virgo' },
  { key: 'tula', name: 'तूळ', english: 'Libra' },
  { key: 'vrischik', name: 'वृश्चिक', english: 'Scorpio' },
  { key: 'dhanu', name: 'धनु', english: 'Sagittarius' },
  { key: 'makar', name: 'मकर', english: 'Capricorn' },
  { key: 'kumbh', name: 'कुंभ', english: 'Aquarius' },
  { key: 'meen', name: 'मीन', english: 'Pisces' },
];

const SCHEMA = {
  type: 'object',
  properties: {
    rashi: {
      type: 'array',
      description: 'Exactly twelve entries, in the order given, one per sign.',
      items: {
        type: 'object',
        properties: {
          key: { type: 'string' },
          text: { type: 'string' },
          lucky_number: { type: 'integer' },
          lucky_colour: { type: 'string' },
        },
        required: ['key', 'text', 'lucky_number', 'lucky_colour'],
      },
    },
    suvichar: {
      type: 'object',
      properties: {
        text: { type: 'string' },
        attribution: { type: 'string' },
      },
      required: ['text', 'attribution'],
    },
  },
  required: ['rashi', 'suvichar'],
};

// The brief. It carries the house style, the measure each entry has to fit and
// the things a newspaper must not say - a horoscope that promises a cure or
// predicts a death is a liability, not a feature.
//
// Two things this brief used to get wrong, both about the सुविचार:
//
//   It asked for the name of whoever said the thought, and four lines later
//   forbade mentioning any person at all. A model given contradictory rules
//   follows one of them, and which one is not something to leave to chance.
//   The ban belongs to the horoscope, where it was meant.
//
//   Nothing stopped an invented attribution. A quotation the model composed
//   itself, printed under a real person's name over this masthead, is a
//   falsehood in print - the same class of harm the news brief spends a whole
//   paragraph forbidding. It may now say अज्ञात, and is told to.
function promptFor(isoDate, weekday, charsPerSign) {
  return [
    'तुम्ही "दैनिक साहस वार्ता" या मराठी दैनिकाचे उपसंपादक आहात.',
    `${isoDate} (${weekday}) या दिवसाच्या अंकासाठी खालील सदरे लिहा. सर्व मजकूर मराठीत, देवनागरी लिपीत.`,
    '',
    '१) आजचे राशिभविष्य — बारा राशींसाठी, दिलेल्या क्रमाने आणि दिलेल्या key सह.',
    `   प्रत्येक राशीचा मजकूर जास्तीत जास्त ${charsPerSign} अक्षरांचा. एक किंवा दोन लहान वाक्ये; छापल्यावर २ ते ३ ओळींमध्ये बसेल इतकाच मजकूर.`,
    '   विषय: कामकाज, आर्थिक बाबी, कुटुंब, आरोग्य यांपैकी एखादा. सकारात्मक पण संयत भाषा.',
    '   प्रत्येक राशीसाठी शुभ अंक (१-९) आणि शुभ रंग द्या.',
    '',
    '२) आजचा सुविचार — एक ओळीचा विचार.',
    '   श्रेय (attribution) फक्त तेव्हाच नाव द्या जेव्हा तो विचार खरोखर त्याच व्यक्तीचा आहे',
    '   याची तुम्हाला खात्री आहे. खात्री नसेल तर श्रेय म्हणून "अज्ञात" असे लिहा.',
    '   कोणत्याही खऱ्या व्यक्तीच्या नावावर तिने न म्हटलेले वाक्य लावू नका.',
    '',
    'बंधने:',
    '- आजार बरा होईल, अपघात होईल, मृत्यू, गर्भधारणा अशी कोणतीही भाकिते करू नका.',
    '- गुंतवणुकीचा किंवा वैद्यकीय सल्ला देऊ नका.',
    '- राशिभविष्यात कोणत्याही व्यक्ती, जात, धर्म किंवा पक्षाचा उल्लेख करू नका.',
    '- अक्षरमर्यादा काटेकोरपणे पाळा; मजकूर ठराविक जागेत छापला जातो.',
    '',
    'राशींचा क्रम आणि key:',
    RASHIS.map((r, i) => `${i + 1}. ${r.name} (key: ${r.key})`).join('\n'),
  ].join('\n');
}

const WEEKDAYS = ['रविवार', 'सोमवार', 'मंगळवार', 'बुधवार', 'गुरुवार', 'शुक्रवार', 'शनिवार'];

function weekdayOf(isoDate) {
  const [y, m, d] = String(isoDate).split('T')[0].split('-').map(Number);
  return WEEKDAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
}

/**
 * Writes every model-written feature for one day, in a single call.
 *
 * `charsPerSign` comes from the block the horoscope is going into - the same
 * character grid that measures a news block measures this one, so the copy
 * comes back already fitting the space rather than being trimmed afterwards.
 */
async function buildAll(isoDate, { charsPerSign = 90, tier } = {}) {
  const prompt = promptFor(isoDate, weekdayOf(isoDate), charsPerSign);
  // The tier is how hard the model is asked to think. The standing features are
  // short, formulaic and read for pleasure rather than for fact, so they do not
  // need the expensive setting - `basic` is the default and is right here.
  const result = await ai.askForJson(prompt, SCHEMA, { tier });
  if (result.error) return result;

  const byKey = new Map((result.data.rashi || []).map((row) => [row.key, row]));
  const missing = RASHIS.filter((r) => !byKey.has(r.key)).map((r) => r.name);
  if (missing.length) {
    return { error: `The model left these signs out: ${missing.join(', ')}` };
  }

  return {
    // Which provider actually answered, and at what effort. If the fallback
    // wrote tonight's horoscope the desk should be able to see that.
    writtenBy: { provider: result.provider, tier: result.tier, fellBackTo: result.fellBackTo },
    rashi: {
      title: 'आजचे राशिभविष्य',
      // The Smart Card payload keeps the lucky number and the lucky colour as
      // their own fields. `items` below glues them into a note because that is
      // printable copy, and a reader looks for those two - flattening them and
      // then splitting the string back apart on " । " to draw them is how they
      // ended up welded to the end of a paragraph.
      card: {
        signs: RASHIS.map((sign) => {
          const row = byKey.get(sign.key);
          return {
            key: sign.key,
            name: sign.name,
            text: row.text,
            luckyNumber: row.lucky_number,
            luckyColour: row.lucky_colour,
          };
        }),
      },
      items: RASHIS.map((sign) => {
        const row = byKey.get(sign.key);
        return {
          label: sign.name,
          text: row.text,
          note: `शुभ अंक ${row.lucky_number} । शुभ रंग ${row.lucky_colour}`,
        };
      }),
    },
    suvichar: {
      title: 'आजचा सुविचार',
      card: { text: result.data.suvichar.text, attribution: result.data.suvichar.attribution },
      items: [{ text: result.data.suvichar.text, note: result.data.suvichar.attribution }],
    },
  };
}

module.exports = { buildAll, promptFor, RASHIS, SCHEMA };
