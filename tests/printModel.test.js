// THE ONE WALK, checked against the one that already went to press.
//
// `print-model.js` exists so that InDesign, Word and the CMYK press PDF do not
// each re-walk the composition - four walks of the same page is the
// duplicated-catalog failure this project has already been bitten by twice.
// But a shared walk is only worth having if it agrees with the walk that is
// already tested and already printing: scribus.service.js.
//
// So these assertions do not restate what compose.js decided. They check that
// the neutral model puts every line at the SAME millimetre the .sla puts it,
// carries the same text in the same order, and does not quietly lose a fill, a
// picture or a caption on the way.
//
// Real publication fonts, like the Scribus tests: export refuses the hmtx
// fallback, so testing it against anything else tests a path export never
// takes.

require('dotenv').config();
const test = require('node:test');
const assert = require('node:assert/strict');

const scribus = require('../src/services/scribus.service');
const model = require('../src/services/export/print-model');
const { identityFor } = require('../src/layout/identity');
const identityOf = () => identityFor(newspaper.publication_date, 3);

test.before(async () => { await model.ensureComposeReady(); });

const newspaper = {
  id: 1, publication_date: '2026-08-24', page_width_px: 660, page_height_px: 1060,
  margin_x_px: 20, margin_y_px: 20, matter_width_px: 620, matter_height_px: 1020,
};

function articleSection(overrides = {}) {
  return {
    section_key: 'lead', block_type: 'article',
    x_px: 40, y_px: 60, width_px: 260, height_px: 400, margin_px: 1,
    kicker: '', headline: 'शेतकऱ्यांसाठी नवी योजना जाहीर', subheading: 'निर्णय एकमताने घेण्यात आला',
    body: 'ज्ञानेश्वर महाराजांच्या पालखीचे प्रस्थान उद्या सकाळी होणार असल्याचे कळते. '
      + 'आरोग्य केंद्रात नव्याने रुग्णवाहिका दाखल झाल्याने नागरिकांना दिलासा मिळाला. '
      + 'तालुका प्रशासनाने पावसाळ्यापूर्वी नाले सफाईची कामे पूर्ण करण्याचे आदेश दिले.',
    headline_font_px: 24, subheading_font_px: 13, body_font_px: 6.4, line_height: 1.45,
    text_align: 'justify', font_family: 'serif', font_weight: 400, column_count: null,
    reporter_name: 'साहस वार्ता', location: 'सातारा', category: 'बातमी',
    background_color: null, border_style: 'none', headline_style: 'plain',
    drop_cap_lines: 0, images: [], ...overrides,
  };
}

const pageOf = (sections) => [{ id: 1, page_number: 1, sections }];

// Millimetres, as both sides round them.
const near = (a, b, tolerance = 0.01) => Math.abs(a - b) <= tolerance;

/** Every `PAGE` object in the .sla, with the numbers this model also carries. */
function slaFrames(sla) {
  return [...sla.matchAll(/<PAGEOBJECT\b[^>]*>/g)].map((match) => {
    const attr = (name) => {
      const found = match[0].match(new RegExp(`\\\\b${name}="([^"]*)"`));
      return found ? found[1] : null;
    };
    return {
      type: attr('PTYPE'),
      x: Number(attr('XPOS')), y: Number(attr('YPOS')),
      width: Number(attr('WIDTH')), height: Number(attr('HEIGHT')),
    };
  });
}

test('every composed line the press file places, the shared model places at the same millimetre', async () => {
  const sections = [articleSection()];
  const sla = await scribus.buildDocument(newspaper, pageOf(sections));
  const built = await model.buildPrintModel(newspaper, pageOf(sections));

  const slaText = slaFrames(sla).filter((frame) => frame.type === '4');
  const modelText = built.pages[0].items.filter((item) => item.kind === 'text');

  // The model carries the page furniture too, so it is the superset; every
  // BLOCK line in the .sla must appear in it at the same place.
  assert.ok(modelText.length >= slaText.length, `model ${modelText.length} < sla ${slaText.length}`);

  for (const frame of slaText) {
    const match = modelText.find((item) => near(item.x, frame.x) && near(item.y, frame.y));
    assert.ok(match, `no model item at ${frame.x},${frame.y}`);
    assert.ok(near(match.height, frame.height, 0.02), `height ${match.height} vs ${frame.height}`);
  }
});

test('the model carries the same words, in the same order, as the press file', async () => {
  const sections = [articleSection()];
  const sla = await scribus.buildDocument(newspaper, pageOf(sections));
  const built = await model.buildPrintModel(newspaper, pageOf(sections));

  const slaWords = [...sla.matchAll(/<ITEXT\s+CH="([^"]*)"/g)].map((m) => m[1]);
  const modelWords = built.pages[0].items
    .filter((item) => item.kind === 'text')
    .flatMap((item) => item.runs.map((run) => run.text));

  // Every run the press file writes appears in the model, in order.
  let cursor = 0;
  for (const word of slaWords) {
    const decoded = word.replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
      .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"');
    const found = modelWords.indexOf(decoded, cursor);
    assert.ok(found >= 0, `press run ${JSON.stringify(decoded)} is not in the model`);
    cursor = found;
  }
});

test('the automatic dateline and byline are bold furniture in every press path', async () => {
  const sections = [articleSection()];
  const [sla, built] = await Promise.all([
    scribus.buildDocument(newspaper, pageOf(sections)),
    model.buildPrintModel(newspaper, pageOf(sections)),
  ]);
  const prefix = '■ सातारा, साहस वार्ता ';
  const prefixRun = built.pages[0].items
    .filter((item) => item.kind === 'text')
    .flatMap((item) => item.runs)
    .find((run) => run.text === prefix);
  const bodyRun = built.pages[0].items
    .filter((item) => item.kind === 'text')
    .flatMap((item) => item.runs)
    .find((run) => run.text.startsWith('ज्ञानेश्वर'));
  assert.equal(prefixRun?.bold, true);
  assert.equal(prefixRun?.weight, 700);
  assert.equal(bodyRun?.bold, false, 'the authored report remains ordinary body weight');
  assert.match(sla, /CH="■ सातारा, साहस वार्ता "[^>]+FONT="Noto Serif Devanagari Bold"/);
  assert.match(sla, /CH="ज्ञानेश्वर[^"<]*"[^>]+FONT="Noto Serif Devanagari Regular"/);
});

test('a tinted block puts its ground down first, and a reversed headline its panel', async () => {
  const built = await model.buildPrintModel(newspaper, pageOf([
    articleSection({ background_color: '#fbf3e9', headline_style: 'reverse' }),
  ]));
  // Page one opens with the nameplate, so the block's own items start after
  // it; what matters is the order WITHIN the block. The block sits at
  // 40x60 editor px, which is 20x30 mm.
  // The block sits at 40x60 editor px and is 260x400 - so 20x30 mm, 130x200.
  // Bounded at its own foot as well as its head: the page carries furniture
  // AFTER the blocks too (the footer band at 506 mm, the press registration
  // patches at 523 mm), and an open-ended slice counted those patches as the
  // block's own grounds.
  const all = built.pages[0].items;
  const items = all
    .slice(all.findIndex((item) => item.kind === 'fill' && Math.abs(item.x - 20) < 0.01))
    .filter((item) => item.y < 250);
  const firstFill = items.findIndex((item) => item.kind === 'fill');
  const firstText = items.findIndex((item) => item.kind === 'text');
  assert.equal(firstFill, 0, 'the ground is the first thing on the block');
  assert.ok(firstFill < firstText, 'the ground is under the type, not over it');
  const fills = items.filter((item) => item.kind === 'fill');
  assert.equal(fills.length, 2, 'the ground and the reverse panel');
  assert.equal(fills[1].ink, '#c8102e', 'the panel is the paper accent');
  assert.ok(items.filter((item) => item.kind === 'text')
    .some((item) => item.runs.some((run) => run.ink === '#ffffff')), 'the headline sets white out of it');
});

test('a picture and its caption both reach the model, in millimetres', async () => {
  const built = await model.buildPrintModel(newspaper, pageOf([articleSection({
    images: [{
      id: 7, url: '/uploads/photo.jpg', x_px: 10, y_px: 120, width_px: 120, height_px: 90,
      shape: 'box', fit_mode: 'cover', rotation: 0, flip_h: false, flip_v: false,
      caption: 'फोटो : साहस वार्ता', z_index: 1,
    }],
  })]));
  const items = built.pages[0].items;
  // The nameplate is an image too, so the block's own picture is named by its
  // file rather than by being the first one on the page.
  const picture = items.find((item) => item.kind === 'image' && item.file.startsWith('uploads/'));
  assert.ok(picture, 'the picture is in the model');
  assert.equal(picture.file, 'uploads/photo.jpg', 'referenced by path, relative to public/');
  assert.ok(near(picture.x, (40 + 10) / 2) && near(picture.y, (60 + 120) / 2), 'placed in mm from the page corner');
  assert.ok(near(picture.width, 60) && near(picture.height, 45), 'sized in mm');
  assert.ok(items.some((item) => item.kind === 'text'
    && item.runs.some((run) => run.text.includes('फोटो'))), 'the caption is there too');
});

test('Smart Card artwork and all twelve Rashi panels reach every shared export', async () => {
  const keys = ['mesh', 'vrishabh', 'mithun', 'kark', 'sinh', 'kanya', 'tula', 'vrischik', 'dhanu', 'makar', 'kumbh', 'meen'];
  const built = await model.buildPrintModel(newspaper, pageOf([articleSection({
    block_type: 'feature', headline: '', subheading: '', body: '',
    width_px: 307, height_px: 632,
    smart_card_key: 'rashi',
    smart_card_data: {
      signs: keys.map((key, index) => ({
        key, name: `राशी${index}`, text: 'आजचा दिवस चांगला जाईल.', luckyNumber: index + 1, luckyColour: 'निळा',
      })),
    },
  })]));
  const artwork = built.pages[0].items.filter((item) => item.kind === 'image' && item.file.startsWith('assets/smart-cards/'));
  assert.equal(artwork.length, 13, 'one title plus twelve sign panels');
  assert.ok(artwork.some((item) => item.file.endsWith('rashi-vrishchik.png')), 'the vrischik data key maps to the correctly spelled downloaded file');
});

test('type sizes are POINTS, and the page is millimetres - never editor pixels', async () => {
  const built = await model.buildPrintModel(newspaper, pageOf([articleSection()]));
  assert.equal(built.widthMm, 330, '660 editor px is 330 mm at 2 px/mm');
  assert.equal(built.heightMm, 530);
  const body = built.pages[0].items
    .filter((item) => item.kind === 'text')
    .flatMap((item) => item.runs)
    .find((run) => Math.abs(run.sizePt - 9.07) < 0.05);
  assert.ok(body, '6.4 editor px of body sets as 9.07 pt');
});

test('the page furniture is on every page, and the imprint on exactly one', async () => {
  const pages = [
    { id: 1, page_number: 1, sections: [articleSection()] },
    { id: 2, page_number: 2, sections: [] },
    { id: 3, page_number: 3, sections: [] },
  ];
  const built = await model.buildPrintModel(newspaper, pages);
  const words = (n) => built.pages[n].items.flatMap((item) => item.runs?.map((run) => run.text) || []);
  for (const index of [0, 1, 2]) {
    assert.ok(words(index).some((text) => text.startsWith('पृष्ठ')), `page ${index + 1} carries its folio`);
  }
  // Matched on the disclosure's own words, not on the letters "AI" anywhere in
  // the page: the masthead's contact line carries sahasnews@gmail.com, and a
  // case-insensitive /AI/ finds the "ai" in "gmail".
  const carries = [0, 1, 2].map((index) => words(index)
    .some((text) => text === identityOf().aiDisclosure));
  assert.deepEqual(carries, [false, true, false], 'the AI disclosure prints once, on page two');
});

test('page one carries the paper\'s own nameplate, which no export used to', async () => {
  // Found by rendering a real edition to a press PDF and looking at it: a
  // hand's width of white where the paper's name goes. scribus.service.js has
  // the same gap and always has.
  const built = await model.buildPrintModel(newspaper, [
    { id: 1, page_number: 1, sections: [articleSection()] },
    { id: 2, page_number: 2, sections: [articleSection()] },
  ]);
  const plate = (index) => built.pages[index].items
    .find((item) => item.kind === 'image' && /nameplate|masthead/i.test(item.file || ''));
  assert.ok(plate(0), 'page one has the nameplate');
  assert.equal(plate(1), undefined, 'an inside page does not repeat it');

  // At its own proportions, never stretched: it is a registered mark.
  const aspect = plate(0).width / plate(0).height;
  assert.ok(Math.abs(aspect - 1600 / 300) < 0.01, `aspect ${aspect}`);

  const words = built.pages[0].items.flatMap((item) => item.runs?.map((run) => run.text) || []);
  assert.ok(words.some((text) => /प्रसिद्ध होणारे दैनिक/.test(text)), 'and the strapline');
  // The registered artwork already carries the RNI; printing it again is the
  // "set twice" fault CLAUDE.md records for the browser masthead.
  assert.equal(words.filter((text) => /RNI/.test(text)).length, 0, 'the RNI is not repeated as type');
});
