// A news block WITH A PHOTOGRAPH in it - rectangle, cut-out, or none at all.
//
// tests/blockQuality.test.js holds the block that carries only type. This one
// holds the block that carries a picture, because every fault below was found
// the same way the fill faults were - by placing real photographs (a portrait,
// a district map, a street scene) into real block geometries, filling them,
// and LOOKING at the result - and every one of them reads as fine in the
// numbers. They are, in the order they were found:
//
//   1. display type stepped a whole line box at a time past a picture, so the
//      white under a top photograph was a different size on every block;
//   2. the dateline was the one field composeSection() read from the view
//      alone, so a stored block composed one body line shorter for every
//      server-side caller than it did on the page;
//   3. a picture dropped into an empty article block landed where the headline
//      was about to be set and halved its measure;
//   4. a picture frame chosen without reference to the photograph's own shape
//      showed the paper through it - up to 54% of the frame.
//
// No AI, no network, no database: the compositor is deterministic.

const test = require('node:test');
const assert = require('node:assert/strict');

const TYPE = { headlineFontPx: 20, subheadingFontPx: 11, bodyFontPx: 6.4, marginPx: 1, lineHeight: 1.45 };
const HEADLINE = 'पाणीपुरवठा योजनेचे काम अंतिम टप्प्यात आले';
const BODY = [
  'सातारा जिल्हा प्रशासनाने नवीन योजनेचे काम अंतिम टप्प्यात आणले असून नागरिकांना लवकरच दिलासा मिळणार आहे.',
  'तालुका प्रशासनाने पावसाळ्यापूर्वी नाले सफाईची कामे पूर्ण करण्याचे आदेश दिले.',
  'आरोग्य केंद्रात नव्याने रुग्णवाहिका दाखल झाली आहे.',
  'वीज वितरण कंपनीने देखभालीच्या कामासाठी पुरवठा खंडित राहणार असल्याचे कळवले.',
].join(' ');

async function engine() {
  const { ensureFontsLoaded } = await import('../public/editor/compose/font-metrics.js');
  const { ensureShaperReady } = await import('../public/editor/compose/shaper.js');
  const compose = await import('../public/editor/compose/section-adapter.js');
  await Promise.all([ensureFontsLoaded(), ensureShaperReady()]);
  return compose;
}

const picture = (over = {}) => ({
  x_px: 0, y_px: 1, width_px: 190, height_px: 79,
  shape: 'rect', rotation: 0, stand_off_px: 6, fit_mode: 'cover',
  url: '/uploads/none.jpg', ...over,
});

/** The topmost ink of a display band, and the picture's own bottom edge. */
function displayTopUnder(composed, pic) {
  const bands = Object.values(composed.bands || {}).filter((b) => b?.lines?.length);
  const top = Math.min(...bands.map((b) => Math.min(...b.lines.map((l) => l.y))));
  return top - (Number(pic.y_px) + Number(pic.height_px) + Number(pic.stand_off_px));
}

// ---------------------------------------------------------------------------

test('display type starts where the picture ends, not a whole line box later', async () => {
  const compose = await engine();
  // Three depths that are NOT multiples of a headline line box. Stepping a
  // whole band from the block top lands the headline anywhere from nothing to
  // one entire box below the picture; measured on the real fixture that was
  // 17px on a 190x264 second lead, 10px on a 150x240 and 4px on a 150x264 -
  // the same gesture giving three different answers.
  const worst = [];
  for (const [w, h] of [[190, 264], [150, 240], [150, 264], [111, 168]]) {
    for (const depth of [55, 72, 79, 88]) {
      const pic = picture({ width_px: w, height_px: depth });
      const composed = compose.composeSection(
        { section_key: 'x', width_px: w, height_px: h, block_type: 'article', images: [pic] },
        { ...TYPE, headline: HEADLINE, subheading: '', body: BODY },
      );
      if (!Object.values(composed.bands || {}).some((b) => b?.lines?.length)) continue;
      worst.push({ at: `${w}x${h} pic ${depth}`, gap: displayTopUnder(composed, pic) });
    }
  }
  const bad = worst.filter((r) => r.gap > 4);
  assert.deepEqual(bad, [], `display type left unasked-for white under a picture:\n  `
    + bad.map((r) => `${r.at}: ${r.gap.toFixed(1)}px`).join('\n  '));
  // And it is still BELOW the picture - clearing it, not overlapping it.
  assert.ok(worst.every((r) => r.gap >= -0.5), 'display type ran into the picture');
});

test('a headline is never broken in two across a photograph', async () => {
  const compose = await engine();
  // A full-measure picture placed where a two-line headline would reach it:
  // half the headline above, half below, is two stories to a reader.
  const split = [];
  for (const [w, h] of [[229, 480], [190, 264], [268, 296]]) {
    for (const y of [24, 30, 36, 42]) {
      const composed = compose.composeSection(
        { section_key: 'x', width_px: w, height_px: h, block_type: 'article', images: [picture({ width_px: w, y_px: y, height_px: 90 })] },
        { ...TYPE, headline: HEADLINE, subheading: '', body: BODY },
      );
      for (const [key, band] of Object.entries(composed.bands || {})) {
        const lines = band?.lines || [];
        for (let i = 1; i < lines.length; i += 1) {
          const gap = lines[i].y - (lines[i - 1].y + lines[i - 1].height);
          if (gap > 2) split.push(`${w}x${h} y=${y}: ${key} broken by ${gap.toFixed(0)}px`);
        }
      }
    }
  }
  assert.deepEqual(split, [], `a photograph was set through a display flow:\n  ${split.join('\n  ')}`);
});

test('the dateline is read from the row, so every caller composes the same block', async () => {
  const compose = await engine();
  // composeBlock() promises one answer. The dateline was the single field the
  // adapter read from the view alone: the page canvas builds its view with
  // flowViewFromSection() (which carries location and author), while preflight,
  // the worklist's quoted capacity, copyFit's settle loop and the placement
  // repair all compose the stored row with an EMPTY view - and got a block one
  // whole body line shorter than the one that prints.
  const row = {
    section_key: 'x', width_px: 150, height_px: 176, block_type: 'article', images: [],
    headline: HEADLINE, subheading: '', body: BODY,
    location: 'सातारा', reporter_name: 'साहस वार्ता',
    headline_font_px: 20, subheading_font_px: 11, body_font_px: 6.4, margin_px: 1, line_height: 1.45,
  };
  const fromRow = compose.composeSection(row, {});
  const fromView = compose.composeSection(row, {
    ...TYPE, headline: row.headline, subheading: row.subheading, body: row.body,
    location: row.location, author: row.reporter_name,
  });
  assert.equal(fromRow.bodyLines.length, fromView.bodyLines.length,
    'the same block composed to a different number of lines depending on who asked');
  assert.ok(String(fromRow.bodyLines[0]?.text || '').startsWith('■'),
    'composing the stored row dropped the dateline the page prints');
  assert.equal(
    fromRow.whitespace.occupancy.ratio.toFixed(3),
    fromView.whitespace.occupancy.ratio.toFixed(3),
    'the fill ratio depended on who asked',
  );
});

test('a cut-out narrows the lines it crosses and the copy still sets', async () => {
  const compose = await engine();
  // The exclusion comes from the real alpha mask, so an irregular silhouette
  // narrows the individual scanlines it crosses - nothing models that, it only
  // asks. A coarse occupancy grid standing in for one: solid down the middle,
  // clear at the shoulders, which is what a person cut out of a photograph is.
  const rows = 44;
  const cols = 32;
  const cells = [];
  for (let r = 0; r < rows; r += 1) {
    const spread = r < rows / 3 ? 6 : 12;
    cells.push(Array.from({ length: cols }, (_, c) => (Math.abs(c - cols / 2) <= spread ? 1 : 0)));
  }
  const cut = picture({ x_px: 100, y_px: 60, width_px: 110, height_px: 130, shape: 'cutout', mask: { rows, cols, cells } });
  const composed = compose.composeSection(
    { section_key: 'x', width_px: 229, height_px: 480, block_type: 'article', images: [cut] },
    { ...TYPE, headline: HEADLINE, subheading: '', body: BODY },
  );
  const beside = composed.bodyLines.filter((l) => l.y >= 60 && l.y + l.height <= 190);
  assert.ok(beside.length > 0, 'no copy set beside the cut-out at all');
  const narrowed = beside.filter((l) => l.measure < composed.content.measure - 1);
  assert.ok(narrowed.length > 0, 'the cut-out narrowed no line - its mask was not read');
  assert.ok(!(composed.violations || []).some((v) => /BODY_OVERSET/.test(v.code || v)),
    'the copy overset around the cut-out');
});

test('a picture in an empty article block lands clear of the headline to come', async () => {
  // The service decides this, not the engine: an article block is never
  // published without a headline, so the room one needs is reserved before the
  // picture lands. Without it a picture dropped into an empty block sits
  // exactly where the headline is about to be set and HALVES its measure -
  // measured across the database, a headline a picture narrows fills 59.4% of
  // its column against 95.0% where it keeps its full measure, and 46 of 96
  // such blocks run to three or four lines against none elsewhere.
  //
  // Asked of the SERVICE, deliberately. This used to rebuild the reservation
  // from headline-reserve.js's character limits, which is a different and
  // explicitly rougher answer - it reserved one line where a real headline
  // takes two. The reservation that runs is measured in LINES; that is what is
  // held here.
  const { copyStartsAt } = require('../src/services/sectionImage.service.js');
  const compose = await engine();
  const empty = { section_key: 'x', width_px: 229, height_px: 480, block_type: 'article', images: [],
    margin_px: 1, line_height: 1.45, body_font_px: 6.4, headline: '', subheading: '', body: '' };

  const bare = compose.composeSection(empty, { headline: '', subheading: '', body: '' });
  const reservedTop = await copyStartsAt(empty);

  assert.ok(reservedTop > bare.bodyTop + 8,
    'a headline-less block reserved no room for the headline it will certainly get');

  // And the reserved position clears a real headline of the length a desk
  // actually writes.
  const real = compose.composeSection(empty, { ...TYPE, headline: HEADLINE, subheading: '', body: '' });
  assert.ok(reservedTop >= real.bodyTop - 12,
    `reserved ${reservedTop} but a real headline needs ${real.bodyTop}`);
});
