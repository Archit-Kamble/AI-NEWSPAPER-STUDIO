// The day's standing features.
//
// There is a fourth kind of ink on a newspaper page, beside the standing
// furniture, the derived edition numbers and the day's file: content that
// changes every single day and yet needs no reporter. राशिभविष्य, सूर्योदय-
// सूर्यास्त, दिनविशेष, सुविचार, सोन्याचे भाव, कोडी. In a Marathi daily these
// fill a real share of the inside pages, and today they are keyed in by hand
// every morning by somebody who would rather be editing news.
//
// Each one is classified by WHERE ITS CONTENT COMES FROM, because that decides
// what the software is allowed to do with it:
//
//   computed   derivable from the date alone. Costs nothing, works offline,
//              cannot be wrong. सूर्योदय-सूर्यास्त, राहुकाळ, शक संवत.
//
//   curated    a fact that a person checked once. दिनविशेष. Never generated -
//              a model will produce a plausible wrong year.
//
//   written    a model writes it, and everyone understands it as writing rather
//              than as fact. राशिभविष्य, सुविचार. All of these share ONE model
//              call a day.
//
//   feed       a number from outside that must be true. सोन्याचे भाव, बाजारभाव,
//              हवामान, शेअर बाजार. A feed only runs after a real provider is
//              connected; Havaman now uses Open-Meteo while the other two stay
//              unavailable. Inventing a rate is not a feature, it is a false
//              statement printed over the masthead.

const panchang = require('./panchang');
const dinvishesh = require('./dinvishesh');
const written = require('./written');
const sudoku = require('./sudoku');
const havaman = require('./havaman');

const catalogue = [
  {
    key: 'panchang',
    name: 'सूर्योदय - सूर्यास्त',
    description: 'Sunrise, sunset, day length, राहुकाळ and the Shaka year.',
    source: 'computed',
    build: (date, options) => panchang.build(date, options),
  },
  {
    key: 'dinvishesh',
    name: 'आजचा दिनविशेष',
    description: 'Anniversaries a Maharashtra desk would not want to miss.',
    source: 'curated',
    build: (date) => dinvishesh.build(date),
  },
  {
    key: 'sudoku',
    name: 'आजचे सुडोकू',
    description: 'A puzzle seeded by the date - the same every time that date prints.',
    source: 'computed',
    build: (date) => sudoku.build(date),
  },
  {
    key: 'sudoku-solution',
    name: 'कालच्या सुडोकूचे उत्तर',
    description: "Yesterday's answer, printed beside today's puzzle.",
    source: 'computed',
    build: (date) => {
      const [y, m, d] = String(date).split('T')[0].split('-').map(Number);
      const yesterday = new Date(Date.UTC(y, m - 1, d - 1)).toISOString().slice(0, 10);
      return sudoku.buildSolution(yesterday);
    },
  },
  {
    key: 'rashi',
    name: 'आजचे राशिभविष्य',
    description: 'All twelve signs, with a lucky number and colour.',
    source: 'written',
  },
  {
    key: 'suvichar',
    name: 'आजचा सुविचार',
    description: 'A thought for the day, with its attribution.',
    source: 'written',
  },

  // A box with no source does not run - see the note at the top of this file.
  {
    key: 'sone-chandi',
    name: 'सोने - चांदी दर',
    description: 'Bullion rates. Needs a market feed; will not be generated.',
    source: 'feed',
    needs: 'A bullion rate source (IBJA or a bank feed).',
  },
  {
    key: 'bajarbhav',
    name: 'बाजारभाव',
    description: 'APMC crop prices, the page a district reader turns to first.',
    source: 'feed',
    needs: 'The Agmarknet / APMC price API.',
  },
  {
    key: 'havaman',
    name: 'हवामान',
    description: 'City-wise maximum, minimum and rainfall.',
    source: 'feed',
    needs: 'Live Open-Meteo forecast (commercial API key in production); IMD can replace it when the publication IP is whitelisted.',
    build: (date, options) => havaman.build(date, options),
  },
];

const byKey = new Map(catalogue.map((feature) => [feature.key, feature]));

function list() {
  return catalogue.map(({ build, ...rest }) => rest);
}

/**
 * Builds every feature that can be built for a date.
 *
 * The model-written ones are done together, in a single call, so a day's
 * features cost one request rather than one per box.
 */
async function buildAll(isoDate, options = {}) {
  const out = {};
  const notes = [];

  for (const feature of catalogue) {
    if (feature.source === 'computed' || feature.source === 'curated') {
      const result = await feature.build(isoDate, options);
      if (result?.error) notes.push(`${feature.name}: ${result.error}`);
      else if (result?.empty) notes.push(`${feature.name}: nothing checked for this date.`);
      else out[feature.key] = result;
    }
    if (feature.source === 'feed') {
      const requestedFeeds = Array.isArray(options.feedKeys) ? options.feedKeys : [];
      if (feature.build && requestedFeeds.includes(feature.key)) {
        const result = await feature.build(isoDate, options);
        if (result?.error) notes.push(`${feature.name}: ${result.error}`);
        else out[feature.key] = result;
      } else {
        notes.push(`${feature.name}: not run — ${feature.needs}`);
      }
    }
  }

  const composed = await written.buildAll(isoDate, options);
  let writtenBy = null;
  if (composed.error) {
    notes.push(`राशिभविष्य / सुविचार: ${composed.error}`);
  } else {
    // Provenance is reported beside the features, not mixed in among them -
    // `out` is a map of feature key to feature, and everything in it gets
    // looked up by key when the blocks are filled.
    const { writtenBy: attribution, ...features } = composed;
    writtenBy = attribution || null;
    Object.assign(out, features);
    if (writtenBy?.fellBackTo) {
      notes.push(`राशिभविष्य / सुविचार: written by the fallback provider (${writtenBy.fellBackTo}).`);
    }
  }

  return { date: String(isoDate).split('T')[0], features: out, notes, writtenBy };
}

async function build(key, isoDate, options = {}) {
  const feature = byKey.get(key);
  if (!feature) return { error: 'No such feature.' };
  if (feature.source === 'feed') {
    if (!feature.build) return { error: `Not run — ${feature.needs}` };
    return feature.build(isoDate, options);
  }

  if (feature.source === 'written') {
    const composed = await written.buildAll(isoDate, options);
    if (composed.error) return composed;
    return composed[key] || { error: 'That feature was not in the reply.' };
  }
  return feature.build(isoDate, options);
}

module.exports = { list, build, buildAll, catalogue };
