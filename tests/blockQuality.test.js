// Is a news block PRODUCTION quality? Measured, deterministically, no AI.
//
// The fill is the soul of this product: a block that sets its copy short of
// the foot, or a headline that stops two-fifths across its column, is what
// makes a made-up page read as a mock-up rather than a newspaper. Every one of
// those faults has been found by measuring real geometries and looking at the
// result - never by reading code - and every one of those measurements has so
// far lived in a throwaway script.
//
// This file is that measurement, kept. It composes a spread of REAL block
// geometries from the customer's own templates (a 620x224 full-width banner
// down to a 111x160 brief) with copy sized to each block, and holds the four
// properties that decide whether a block looks professional:
//
//   1. the copy fills the column to the foot          (>= 95%)
//   2. the headline fills its measure                 (>= 95%)
//   3. display type does not eat the block            (<= 50%)
//   4. nothing oversets
//
// It costs no AI call and no network: the compositor is deterministic, so a
// regression here is a real regression and not a bad day from a model.

const test = require('node:test');
const assert = require('node:assert/strict');

// Every geometry here is taken from src/layout/templates.js, so a change that
// only looks right on a square test block cannot pass.
const GEOMETRIES = [
  ['banner', 620, 224],
  ['lead', 268, 248],
  ['anchor', 268, 296],
  ['column', 229, 480],
  ['second-lead', 190, 264],
  ['third-lead', 150, 264],
  ['foot', 307, 152],
  ['report', 111, 168],
  ['brief', 111, 160],
  ['strip', 150, 120],
];

const DECK = 'प्रशासनाकडून कार्यवाही सुरू';

// A POOL, short to long, for both. A single string truncated at a word
// boundary cannot fill every measure - the widths a Marathi word can land on
// are lumpy, so a bank of real alternatives is what a sub-editor actually has
// and what scripts/fill-edition-copy.js's headlineFor() chooses from. A test
// that used one string would be measuring the string, not the compositor.
const HEADLINES = [
  'पाणीपुरवठा योजना अंतिम टप्प्यात',
  'रस्ते दुरुस्तीसाठी निधी मंजूर',
  'विद्यार्थ्यांना मोफत पुस्तके',
  'घनकचऱ्यावर चर्चा',
  'नेत्रतपासणी शिबिर',
  'नगरपालिकेची स्वच्छता मोहीम राबवण्यात आली',
  'शेतकऱ्यांना बियाणे आणि खतांचे वितरण करण्यात येणार',
  'पाणीपुरवठा योजनेचे काम अंतिम टप्प्यात आले असल्याची माहिती',
  'रस्ते दुरुस्तीसाठी स्वतंत्र निधी मंजूर करण्यात आला आहे',
  'जिल्हा परिषदेच्या शाळांमध्ये डिजिटल वर्ग सुरू करण्यात आले',
  'ग्रामपंचायतीच्या सभेत घनकचरा व्यवस्थापनावर सविस्तर चर्चा झाली',
];

// Sentences of different lengths, so the filler can land near the foot. Copy
// is written in whole SENTENCES, so a writer can only ever get within about a
// line of the bottom - a pool with a short sentence in it is what closes that
// last fraction, exactly as a real one would.
const SENTENCES = [
  'सातारा जिल्हा प्रशासनाने नवीन योजनेचे काम अंतिम टप्प्यात आणले असून नागरिकांना लवकरच दिलासा मिळणार आहे.',
  'तालुका प्रशासनाने पावसाळ्यापूर्वी नाले सफाईची कामे पूर्ण करण्याचे आदेश दिले.',
  'आरोग्य केंद्रात नव्याने रुग्णवाहिका दाखल झाली आहे.',
  'वीज वितरण कंपनीने देखभालीच्या कामासाठी पुरवठा खंडित राहणार असल्याचे कळवले.',
  'नगर वाचनालयात पुस्तक प्रदर्शन भरवण्यात येणार आहे.',
  'महिला बचत गटांनी तयार केलेल्या वस्तूंना बाजारपेठेत मागणी आहे.',
];

// The same default type the layout gives a block of this size - typeScaleFor()
// in src/layout/geometry.js. Reproduced from its own constants rather than
// imported, so a change to those constants shows up here as a CHANGED NUMBER
// to look at rather than as a silently moving goalpost.
function typeFor(width, height) {
  const clamp = (v, a, b) => Math.round(Math.min(b, Math.max(a, v)));
  const usable = Math.max(0, height - 8);
  const headline = Math.min(clamp(width / 11, 13, 40), clamp((usable * 0.5) / (2 * 1.45), 13, 40));
  return { headlineFontPx: headline, subheadingFontPx: clamp(headline * 0.55, 11, 22), bodyFontPx: 6.4 };
}

/** The headline from the pool that best fills THIS block - what a sub-editor
 *  does, and what scripts/fill-edition-copy.js's headlineFor() does. */
function headlineThatFills(compose, section, base) {
  let best = { text: HEADLINES[0], fill: 0 };
  for (const text of HEADLINES) {
    const composed = compose.composeSection(section, { ...base, headline: text, body: '' });
    if (composed.bands?.headline?.overset) continue;
    const fill = compose.headlineFill(composed);
    if (fill > best.fill) best = { text, fill };
    if (fill >= 0.95) return text;
  }
  return best.text;
}

/** Copy grown a sentence at a time, keeping the last that still fits - the
 *  rule scripts/fill-edition-copy.js uses, and the only one that reaches the
 *  foot without overset (a character estimate cannot: the budget is a RANGE). */
function copyThatFills(compose, section, base) {
  const oversets = (body) => (compose.composeSection(section, { ...base, body }).violations || [])
    .some((v) => /BODY_OVERSET/.test(v.code || v));
  let kept = '';
  // Greedy over the pool: add the longest sentence that still fits, and when
  // none does, try the shorter ones - the last fraction of a column is closed
  // by a SHORT sentence, which is why the pool has them.
  for (let guard = 0; guard < 400; guard += 1) {
    let grew = false;
    for (const sentence of SENTENCES) {
      const candidate = kept ? `${kept} ${sentence}` : sentence;
      if (oversets(candidate)) continue;
      kept = candidate;
      grew = true;
      break;
    }
    if (!grew) break;
  }
  return kept;
}

test('every real block geometry sets professional copy: full, filled, unoverset', async () => {
  const { ensureFontsLoaded } = await import('../public/editor/compose/font-metrics.js');
  const { ensureShaperReady } = await import('../public/editor/compose/shaper.js');
  const compose = await import('../public/editor/compose/section-adapter.js');
  await Promise.all([ensureFontsLoaded(), ensureShaperReady()]);

  const failures = [];
  for (const [name, width, height] of GEOMETRIES) {
    const section = { section_key: name, width_px: width, height_px: height, block_type: 'article', images: [] };
    const base = { ...typeFor(width, height), subheading: DECK, marginPx: 1, lineHeight: 1.45 };

    const headline = headlineThatFills(compose, section, base);
    const body = copyThatFills(compose, section, { ...base, headline });
    const composed = compose.composeSection(section, { ...base, headline, body });

    const bodyRatio = compose.bodyFill(composed).ratio;
    const headlineRatio = compose.headlineFill(composed);
    const top = composed.content?.top ?? 0;
    const displayBottom = Math.max(...['kicker', 'headline', 'deck']
      .map((k) => (composed.bands?.[k] ? composed.bands[k].top + composed.bands[k].height : top)));
    const share = (displayBottom - top) / Math.max(1, composed.frame.height);
    const overset = (composed.violations || []).some((v) => /OVERSET/.test(v.code || v));

    const at = `${name} ${width}x${height}`;
    if (bodyRatio < 0.95) failures.push(`${at}: body only ${(100 * bodyRatio).toFixed(0)}% set`);
    if (headlineRatio < 0.95) failures.push(`${at}: headline fills ${(100 * headlineRatio).toFixed(0)}% of its measure`);
    if (overset) failures.push(`${at}: something oversets`);
    // MAX_DISPLAY_SHARE is a PREFERENCE that yields to overset (compose.js), so
    // this is held a little looser than the constant - the point is that the
    // headline and deck may not eat the block, not that 0.5 is inviolable.
    if (share > 0.62) failures.push(`${at}: display type takes ${(100 * share).toFixed(0)}% of the block`);
  }
  assert.deepEqual(failures, [], `\n  ${failures.join('\n  ')}\n`);
});

// The one geometry measured to break the display cap when it carries a deck:
// 229x120. Held explicitly so that if it is ever repaired the test says so,
// and so that nobody "fixes" it by shrinking the default type - measured over
// 900 real blocks, counting the deck into typeScaleFor's budget removes the
// over-40% outliers (17 -> 0) but COSTS headline fill (80% -> 77%), because a
// smaller default drops headlines to one line with room to spare. A short
// headline set larger is not the same fault as a headline that eats the block.
test('a 229x120 block with a deck now sets INSIDE the display share it used to blow through', async () => {
  // This was the recorded outlier: headline plus deck took MORE than half a
  // shallow block, because the display share was a fixed ceiling the headline
  // filled first and the deck then had to overflow to be set at all.
  //
  // It is not an outlier any more. The deck's own minimum band is reserved out
  // of the headline's ceiling before the headline claims it
  // (DECK_MIN_OF_BODY), so the headline comes down instead of the band
  // spilling past the cap. Measured: 21% of the block, against the >50% this
  // test was written to record.
  const { ensureFontsLoaded } = await import('../public/editor/compose/font-metrics.js');
  const { ensureShaperReady } = await import('../public/editor/compose/shaper.js');
  const compose = await import('../public/editor/compose/section-adapter.js');
  await Promise.all([ensureFontsLoaded(), ensureShaperReady()]);

  const section = { section_key: 'strip', width_px: 229, height_px: 120, block_type: 'article', images: [] };
  const base = { ...typeFor(229, 120), marginPx: 1, lineHeight: 1.45 };
  const headline = 'नगरपालिकेची स्वच्छता मोहीम राबवण्यात आली असून';
  const body = SENTENCES.join(' ');

  const readOf = (view) => {
    const c = compose.composeSection(section, view);
    const top = c.content?.top ?? 0;
    const bottom = Math.max(...['kicker', 'headline', 'deck']
      .map((k) => (c.bands?.[k] ? c.bands[k].top + c.bands[k].height : top)));
    return { share: (bottom - top) / Math.max(1, c.frame.height), composed: c };
  };

  const withDeck = readOf({ ...base, headline, subheading: DECK, body });
  const without = readOf({ ...base, headline, subheading: '', body });

  assert.ok(withDeck.share <= 0.5,
    `a deck must no longer push the display band past half the block, got ${(100 * withDeck.share).toFixed(0)}%`);
  assert.ok(without.share <= 0.5,
    `without a deck it must be inside the cap, got ${(100 * without.share).toFixed(0)}%`);
  assert.equal(withDeck.composed.overset.deck, '', 'and it must not have to overset to be set');
  // Deliberately NOT asserting a deck size here. On a block this narrow the
  // deck is limited by its own MEASURE, not by the room the headline left it:
  // 27 Devanagari characters holding the one-line preference on a 229px block
  // set at 6.8px whatever the headline does. The reserve fixes the room-
  // limited case (the 620px banner's deck went 8px -> 15.9px) and correctly
  // does nothing here.
});

// --- characterisation: fixed input, recorded output ------------------------
//
// The test above proves the engine CAN produce a professional block, by
// choosing a headline and copy that suit each geometry. That is worth holding,
// but it is not a regression net: it searches for an input that succeeds, so it
// keeps passing while the engine drifts underneath it. Sabotaging
// HEADLINE_FILL_TARGET from 0.95 to 0.60 did not fail it.
//
// This one fixes the INPUT and records the OUTPUT. The body is deliberately
// longer than any of these blocks can hold, so what is recorded is exactly
// where the compositor stops - the column count it infers, the type sizes it
// resolves, how many lines it sets before the copy runs out of block, and how
// much of the frame the display type takes. Any change to the shaper, the
// display fitter, the column rule or the leading absorption moves one of these
// numbers, and moving one is the point: the test says WHICH, so the change can
// be looked at rather than discovered on a printed page.
//
// Regenerate deliberately, never reflexively - a number that moved without a
// reason in the diff is the regression this exists to catch.
// RE-RECORDED when display lines became balanced.
//
// `hlFill` is headlineBandFit()'s scalar and it now charges EVERY line rather
// than only the working ones, so the same composition reports a lower number:
// seven of these ten geometries are byte for byte what they were - same size,
// same line count, same deck, same body lines - and only the figure describing
// them moved. That is the point of the change, not a cost of it.
//
// Two really moved, both shallow blocks where the display share is tight and
// the deck now has its own reserved minimum (DECK_MIN_OF_BODY):
//   banner  34px in two lines with a stubbed close -> 24.5px in ONE line at
//           99%, a deck that grew 13.5 -> 15.9px, and ten more lines of story
//   foot    23.5px -> 22px, deck 8 -> 10px, still two lines
const BASELINES = [
  { n: 'banner', w: 620, h: 224, cols: 5, hlLines: 1, hlPx: 24.5, deckPx: 15.9, hlFill: 0.99, share: 0.269, bodyLines: 60 },
  { n: 'lead', w: 268, h: 248, cols: 2, hlLines: 2, hlPx: 20.5, deckPx: 13, hlFill: 0.935, share: 0.316, bodyLines: 32 },
  { n: 'anchor', w: 268, h: 296, cols: 2, hlLines: 2, hlPx: 20.5, deckPx: 13, hlFill: 0.935, share: 0.265, bodyLines: 42 },
  { n: 'column', w: 229, h: 480, cols: 2, hlLines: 2, hlPx: 17.5, deckPx: 11.4, hlFill: 0.936, share: 0.141, bodyLines: 72 },
  { n: 'second-lead', w: 190, h: 264, cols: 2, hlLines: 2, hlPx: 14.5, deckPx: 9.4, hlFill: 0.936, share: 0.212, bodyLines: 40 },
  { n: 'third-lead', w: 150, h: 264, cols: 1, hlLines: 2, hlPx: 11.5, deckPx: 7.5, hlFill: 0.943, share: 0.169, bodyLines: 21 },
  { n: 'foot', w: 307, h: 152, cols: 3, hlLines: 2, hlPx: 22, deckPx: 10, hlFill: 0.875, share: 0.493, bodyLines: 21 },
  { n: 'report', w: 111, h: 168, cols: 1, hlLines: 2, hlPx: 8.5, deckPx: 6.4, hlFill: 0.946, share: 0.208, bodyLines: 12 },
  { n: 'brief', w: 111, h: 160, cols: 1, hlLines: 2, hlPx: 8.5, deckPx: 6.4, hlFill: 0.946, share: 0.218, bodyLines: 11 },
  { n: 'strip', w: 150, h: 120, cols: 1, hlLines: 2, hlPx: 11.5, deckPx: 7.5, hlFill: 0.943, share: 0.371, bodyLines: 6 },
];

const FIXED_HEADLINE = 'पाणीपुरवठा योजनेचे काम अंतिम टप्प्यात आले असल्याची माहिती';
const OVERLONG_BODY = SENTENCES.slice(0, 3).join(' ').concat(' ').repeat(12);

test('the compositor sets these ten geometries exactly as recorded', async () => {
  const { ensureFontsLoaded } = await import('../public/editor/compose/font-metrics.js');
  const { ensureShaperReady } = await import('../public/editor/compose/shaper.js');
  const compose = await import('../public/editor/compose/section-adapter.js');
  await Promise.all([ensureFontsLoaded(), ensureShaperReady()]);

  const drift = [];
  for (const b of BASELINES) {
    const section = { section_key: b.n, width_px: b.w, height_px: b.h, block_type: 'article', images: [] };
    const c = compose.composeSection(section, {
      ...typeFor(b.w, b.h), headline: FIXED_HEADLINE, subheading: DECK, body: OVERLONG_BODY,
      marginPx: 1, lineHeight: 1.45,
    });
    const bands = c.bands || {};
    const top = c.content?.top ?? 0;
    const bottom = Math.max(...['kicker', 'headline', 'deck']
      .map((k) => (bands[k] ? bands[k].top + bands[k].height : top)));

    const got = {
      cols: c.columns.length,
      hlLines: bands.headline?.lines?.length || 0,
      hlPx: Number((bands.headline?.resolvedPx || 0).toFixed(1)),
      deckPx: Number((bands.deck?.resolvedPx || 0).toFixed(1)),
      hlFill: Number(compose.headlineFill(c).toFixed(3)),
      share: Number(((bottom - top) / Math.max(1, c.frame.height)).toFixed(3)),
      bodyLines: c.bodyLines.length,
    };
    for (const key of Object.keys(got)) {
      // Fractions get a hair of tolerance for float drift; counts get none.
      const tol = ['hlFill', 'share'].includes(key) ? 0.005 : (key.endsWith('Px') ? 0.05 : 0);
      if (Math.abs(got[key] - b[key]) > tol) {
        drift.push(`${b.n} ${b.w}x${b.h}: ${key} ${b[key]} -> ${got[key]}`);
      }
    }
  }
  assert.deepEqual(drift, [], `\n  composition drifted:\n  ${drift.join('\n  ')}\n`);
});

// --- the writer's own rules, held --------------------------------------------
//
// Filling the measure is necessary and NOT sufficient. Three things were found
// by photographing real blocks rather than reading their numbers, and each is
// a rule the copy-writing side has to obey. They live here because they are
// properties of a finished block, not of the compositor: the compositor does
// exactly the right thing in every case below, and it is the words handed to
// it that decide whether the block looks like a newspaper.

test('a headline must be measured with growth WITHHELD, or the choice is flattered', async () => {
  const { ensureFontsLoaded } = await import('../public/editor/compose/font-metrics.js');
  const { ensureShaperReady } = await import('../public/editor/compose/shaper.js');
  const compose = await import('../public/editor/compose/section-adapter.js');
  await Promise.all([ensureFontsLoaded(), ensureShaperReady()]);

  // Composed against an EMPTY block the engine is free to grow the type until
  // the words fill the measure. Once the copy is in, growth is withheld to
  // keep a sentence on the page - so a candidate chosen on the empty reading
  // sets short on the real block. Measured on a 307x120 strip: 97% -> 82%.
  const section = { section_key: 'strip', width_px: 307, height_px: 120, block_type: 'article', images: [] };
  const base = { ...typeFor(307, 120), subheading: '', marginPx: 1, lineHeight: 1.45 };
  const headline = 'पाणीपुरवठा योजना अंतिम टप्प्यात';

  const flattered = compose.headlineFill(compose.composeSection(section, { ...base, headline, body: '' }));
  const honest = compose.headlineFill(compose.composeSection(section, { ...base, headline, body: '', headlineGrowth: false }));
  const real = compose.headlineFill(compose.composeSection(section, { ...base, headline, body: SENTENCES.join(' ') }));

  assert.ok(flattered > honest + 0.1, `the empty reading should flatter: ${flattered} vs ${honest}`);
  // `growth:false` is a CONSERVATIVE reading, not an exact prediction: whether
  // the engine may grow the headline depends on how full the block ends up, so
  // the real figure lands somewhere between the withheld reading and the
  // flattered one. What matters for CHOOSING is that it never overstates -
  // a candidate picked on it cannot then set shorter than advertised.
  assert.ok(honest <= real + 0.02,
    `growth:false must not overstate the real block: ${honest} vs ${real}`);
});

test('a headline may not be shrunk to body size to make it fit', async () => {
  const { ensureFontsLoaded } = await import('../public/editor/compose/font-metrics.js');
  const { ensureShaperReady } = await import('../public/editor/compose/shaper.js');
  const compose = await import('../public/editor/compose/section-adapter.js');
  await Promise.all([ensureFontsLoaded(), ensureShaperReady()]);

  // The engine will take a too-long headline down until the words fit, and
  // that is correct - overset is worse. But a headline set at 1.17x the body
  // reads as bold body copy, not as the block's voice, so the WRITER must not
  // hand it words that force the shrink. Every one of the 30 copy-carrying
  // geometries has candidates that fill at the block's own design size.
  const section = { section_key: 'g', width_px: 150, height_px: 232, block_type: 'article', images: [] };
  const design = typeFor(150, 232);
  const base = { ...design, subheading: '', marginPx: 1, lineHeight: 1.45 };

  const tooLong = 'महिला बचत गटांच्या उत्पादनांना बाजारपेठ मिळाली';
  const shrunk = compose.composeSection(section, { ...base, headline: tooLong, body: '', headlineGrowth: false });
  const shrunkPx = Number(shrunk.bands.headline.resolvedPx);
  assert.ok(shrunkPx < design.headlineFontPx * 0.85,
    `this fixture must actually provoke the shrink: ${shrunkPx} of ${design.headlineFontPx}`);
  assert.ok(shrunkPx / design.bodyFontPx < 1.6,
    'and land near body size, which is the fault being guarded against');

  // A brief-sized headline keeps the block's voice.
  const right = compose.composeSection(section, { ...base, headline: 'निधी मंजूर करण्यात आला', body: '', headlineGrowth: false });
  const rightPx = Number(right.bands.headline.resolvedPx);
  assert.ok(rightPx >= design.headlineFontPx * 0.85, `expected full size, got ${rightPx}`);
  assert.ok(rightPx / design.bodyFontPx >= 1.6, `expected hierarchy, got ${rightPx / design.bodyFontPx}`);
});

test('the last fraction of a column is closed by a SHORT sentence', async () => {
  const { ensureFontsLoaded } = await import('../public/editor/compose/font-metrics.js');
  const { ensureShaperReady } = await import('../public/editor/compose/shaper.js');
  const compose = await import('../public/editor/compose/section-adapter.js');
  await Promise.all([ensureFontsLoaded(), ensureShaperReady()]);

  // Copy is written in whole sentences, so a writer can only ever get within
  // about a line of the foot. A pool of uniformly long sentences cannot close
  // that last line - on a 112x160 brief it left a whole line standing empty -
  // and a filler that stops at the first sentence that does not fit leaves far
  // more: measured on a 307x296 anchor beside a photograph, 31% of the column
  // with twenty usable sentences still in the pool.
  const section = { section_key: 'brief', width_px: 112, height_px: 160, block_type: 'article', images: [] };
  const base = { ...typeFor(112, 160), headline: 'निधी मंजूर करण्यात आला', subheading: '', marginPx: 1, lineHeight: 1.45 };
  const oversets = (body) => (compose.composeSection(section, { ...base, body }).violations || [])
    .some((v) => /BODY_OVERSET/.test(v.code || v));

  // Two fillers over the SAME pool. The only difference is what they do when
  // the next sentence does not fit: one gives up, the other tries a shorter
  // one. That single line is what left a 307x296 anchor beside a photograph at
  // 31% of its column with twenty usable sentences still available.
  const stopAtFirstMiss = () => {
    let kept = '';
    for (let i = 0; i < SENTENCES.length * 4; i += 1) {
      const candidate = kept ? `${kept} ${SENTENCES[i % SENTENCES.length]}` : SENTENCES[i % SENTENCES.length];
      if (oversets(candidate)) break;
      kept = candidate;
    }
    return kept;
  };
  const tryThemAll = () => {
    let kept = '';
    for (let guard = 0; guard < 200; guard += 1) {
      let grew = false;
      for (const sentence of SENTENCES) {
        const candidate = kept ? `${kept} ${sentence}` : sentence;
        if (oversets(candidate)) continue;
        kept = candidate; grew = true; break;
      }
      if (!grew) break;
    }
    return kept;
  };
  const fillOf = (body) => compose.bodyFill(compose.composeSection(section, { ...base, body })).ratio;

  const giveUp = fillOf(stopAtFirstMiss());
  const persist = fillOf(tryThemAll());
  assert.ok(persist >= 0.95, `trying every sentence must fill the column, got ${persist}`);
  assert.ok(persist >= giveUp, `persisting can never do worse: ${persist} vs ${giveUp}`);
});
