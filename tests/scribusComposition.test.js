// #7: Scribus consumes the SAME composition truth Layout, the Block Editor
// and preflight already do - not a second text-layout engine independently
// guessing `body_font_px * 1.6` for a kicker's height or wrapping a whole
// body as one paragraph a second time. Every assertion here checks that a
// press frame's own position/size/text is EXACTLY what compose.js already
// decided, never a re-derived approximation of it.
//
// These run against the REAL publication fonts, like tests/compose.test.js -
// press export explicitly refuses the hmtx fallback (requireShaperReady()),
// so testing it against anything else would test a code path press export
// itself never takes.

require('dotenv').config();
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const scribus = require('../src/services/scribus.service');
const geometry = require('../src/layout/geometry');
const identityModule = require('../src/layout/identity');

const load = (file) => import(path.join(__dirname, '..', 'public', 'editor', file));

let sectionAdapter;
let imageGeometry;
let smartCardLayout;

test.before(async () => {
  const { adapter, imageGeometry: ig, smartCardLayout: scl } = await scribus.ensureComposeReady();
  sectionAdapter = adapter;
  imageGeometry = ig;
  smartCardLayout = scl;
});

// A real block, wide enough to wrap more than one line, holding real
// conjunct-heavy Marathi copy.
function articleSection(overrides = {}) {
  return {
    x_px: 40, y_px: 60, width_px: 260, height_px: 400, margin_px: 12,
    kicker: '', headline: 'क्ष ज्ञान श्री कर्म ज्ञानेश्वर शेतकऱ्यांसाठी नवी योजना जाहीर',
    subheading: '', headline_font_px: 22, subheading_font_px: 14, body_font_px: 12,
    body: 'शेतकऱ्यांसाठी नवी योजना जाहीर करण्यात आली. ज्ञानेश्वर महाराजांच्या समाधी सोहळ्यास सुरुवात झाली आहे.',
    location: '', reporter_name: '', images: [],
    ...overrides,
  };
}

function countTextFrames(xml) {
  return (xml.match(/PTYPE="4"/g) || []).length;
}

// -------------------------------------------------------- line parity ---

test('every composed display band line and every composed body line becomes exactly one text frame - no more, no fewer', async () => {
  const section = articleSection();
  const composition = sectionAdapter.composeSection(section, section);
  const expectedLines = Object.values(composition.bands).reduce((sum, band) => sum + band.lines.length, 0)
    + composition.bodyLines.length;

  const xml = await scribus.blockFrames(section);
  assert.equal(countTextFrames(xml), expectedLines, 'one PAGEOBJECT PTYPE="4" per composed line, exactly');
  assert.ok(composition.bands.headline.lines.length > 1, 'the conjunct-heavy headline must actually wrap for this test to mean anything');
});

test('every text frame sits at the EXACT position and size the composition itself computed, in millimetres', async () => {
  const section = articleSection();
  const composition = sectionAdapter.composeSection(section, section);
  const xml = await scribus.blockFrames(section);

  for (const line of composition.bands.headline.lines) {
    const xMm = scribus.mm(section.x_px + line.x);
    const yMm = scribus.mm(section.y_px + line.y);
    const widthMm = scribus.mm(line.measure);
    const heightMm = scribus.mm(line.height);
    const needle = `XPOS="${xMm}" YPOS="${yMm}" WIDTH="${widthMm}" HEIGHT="${heightMm}"`;
    assert.ok(xml.includes(needle), `no frame found at the headline line's own composed geometry: ${needle}`);
  }

  for (const line of composition.bodyLines) {
    const xMm = scribus.mm(section.x_px + line.x);
    const yMm = scribus.mm(section.y_px + line.y);
    const widthMm = scribus.mm(line.measure + 1);
    const heightMm = scribus.mm(line.height);
    const needle = `XPOS="${xMm}" YPOS="${yMm}" WIDTH="${widthMm}" HEIGHT="${heightMm}"`;
    assert.ok(xml.includes(needle), `no frame found at a body line's own composed geometry: ${needle}`);
  }
});

test('every composed body line prints as its OWN text, in the same order compose.js resolved it - never a re-wrapped paragraph', async () => {
  const section = articleSection({
    body: 'क्ष ज्ञान श्री कर्म. ज्ञानेश्वर शेतकऱ्यांसाठी नवी योजना जाहीर करण्यात आली आज. सर्व जिल्ह्यांना याचा लाभ मिळणार आहे.',
  });
  const composition = sectionAdapter.composeSection(section, section);
  assert.ok(composition.bodyLines.length > 1, 'the body must actually wrap onto more than one line for this test to mean anything');

  const xml = await scribus.blockFrames(section);
  const chOrder = [...xml.matchAll(/CH="([^"]*)"/g)].map((m) => m[1]
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'"));

  // Every composed line's text appears, in the SAME order compose.js placed
  // it - a body handed to Scribus as one paragraph could reorder or merge
  // lines; this could only pass if each line is genuinely its own frame.
  let cursor = 0;
  for (const line of composition.bodyLines) {
    const at = chOrder.indexOf(line.text, cursor);
    assert.ok(at >= cursor, `composed line "${line.text}" not found in order in the press file`);
    cursor = at + 1;
  }
});

test('zero inset on an exact line frame - the compositor already owns the padding, Scribus must not add a second one', async () => {
  const xml = await scribus.blockFrames(articleSection());
  const objects = xml.match(/<PAGEOBJECT[^>]*PTYPE="4"[\s\S]*?<\/PAGEOBJECT>/g) || [];
  assert.ok(objects.length > 0);
  for (const obj of objects) {
    assert.match(obj, /EXTRA="0" TEXTRA="0" BEXTRA="0" REXTRA="0"/);
  }
});

// -------------------------------------------------------- rich print -----

test('bold survives to the bold publication face; a selected size converts to the corresponding print point size; tags never appear', async () => {
  const section = articleSection({
    width_px: 300, height_px: 300, body_font_px: 12,
    body: '<p>हा <strong>ठळक</strong> मजकूर आहे आणि <span data-sahas-size="28">मोठा शब्द</span> पुढे आहे.</p>',
  });
  const xml = await scribus.blockFrames(section);

  assert.ok(!/<(strong|span|p)[\s>]/i.test(xml), 'the tags themselves must never reach a press frame');
  // The bolded word's own ITEXT run, set at the bold face specifically.
  assert.match(xml, /CH="ठळक" FONT="Noto Serif Devanagari Bold"/);
  assert.match(xml, new RegExp(`FONTSIZE="${scribus.pxToPt(28)}"`), '28px must convert to its exact print point size');
});

test('the selected-size run is measured at ITS OWN width by compose.js, not the block\'s ordinary body size - so the frame reserved for that line is wide enough', async () => {
  const section = articleSection({ width_px: 300, body_font_px: 10, body: '<span data-sahas-size="40">विशाल</span> शब्द.' });
  const composition = sectionAdapter.composeSection(section, section);
  // The line's measure comes from compose.js's own real-width pour - simply
  // asserting the frame exists at that exact width (already covered by the
  // "exact position and size" test above) is what proves this; here we only
  // need the 40px run's OWN fontsize to reach the file undiminished.
  const xml = await scribus.blockFrames(section);
  assert.match(xml, new RegExp(`FONTSIZE="${scribus.pxToPt(40)}"`));
  assert.ok(composition.bodyLines.length >= 1);
});

// ----------------------------------------------------------- smart cards ---

test('a sudoku prints as its exact square-cell digits, from layoutSmartCard()\'s OWN resolved geometry - never smartCardText()\'s flattened dots', async () => {
  const grid = Array.from({ length: 9 }, (u, r) => Array.from({ length: 9 }, (u2, c) => ((r * 3 + Math.floor(r / 3) + c) % 9) + 1));
  // Blank a few cells, the way a real puzzle does.
  grid[0][1] = 0; grid[3][4] = 0; grid[7][2] = 0;
  const clueCount = grid.flat().filter((n) => n > 0).length;

  const section = {
    x_px: 20, y_px: 20, width_px: 200, height_px: 260, margin_px: 10,
    headline: '', subheading: '', body: '', images: [],
    smart_card_key: 'sudoku', smart_card_data: { grid },
  };
  const xml = await scribus.blockFrames(section);
  const digitFrames = countTextFrames(xml);
  assert.equal(digitFrames, clueCount + 1, 'one compact title plus exactly one text frame per non-blank cell (a blank square is not a dot, and is not drawn)');
  assert.match(xml, /CH="आजचे सुडोकू सोडवा — प्रत्येक ओळ, स्तंभ व ३×३ चौकटीत १ ते ९ अंक भरा"/,
    'the puzzle prints its complete solving instruction inside the Smart Card');

  // AND ITS RULES. A sudoku without its grid is eighty-one numerals scattered
  // on white paper. The browser drew them as CSS borders on the cells, so they
  // existed on screen and in no export at all - measured on a real card, the
  // whole walk emitted one bar (the heading rule) for a puzzle the canvas
  // draws with twenty. Ten verticals and ten horizontals, two weights.
  const rules = [...xml.matchAll(/PTYPE="6"/g)].length;
  assert.ok(rules >= 20, `the 9x9 grid's own rules must reach the press file, got ${rules}`);
});

test('a rashi card prints its resolved reading/lucky lines, a panchang its resolved label/value rows - the SAME lines layoutSmartCard() resolved, not a re-flattened paragraph', async () => {
  const rashiData = {
    signs: [
      { key: 'mesh', name: 'मेष', text: 'आजचा दिवस चांगला जाईल.', luckyNumber: 3, luckyColour: 'निळा' },
      { key: 'vrishabh', name: 'वृषभ', text: 'कामात यश मिळेल.', luckyNumber: 7, luckyColour: 'हिरवा' },
    ],
  };
  const rashiSection = {
    x_px: 10, y_px: 10, width_px: 260, height_px: 200, margin_px: 8,
    headline: '', subheading: '', body: '', images: [],
    smart_card_key: 'rashi', smart_card_data: rashiData,
  };
  const rashiFrame = smartCardLayout.smartCardFrameFromComposition(
    sectionAdapter.composeSection({ ...rashiSection, images: [], body: '' }, { ...rashiSection, body: '' }),
  );
  const rashiLayout = smartCardLayout.layoutSmartCard('rashi', rashiData, rashiFrame);
  const rashiXml = await scribus.blockFrames(rashiSection);
  assert.match(rashiXml, /PFILE="\.\/assets\/smart-cards\/rashi-bhavishyawithoutBG\.png"/, 'the Rashi title artwork reaches Scribus');
  assert.match(rashiXml, /PFILE="\.\/assets\/smart-cards\/rashi-mesh\.png"/, 'Mesh artwork reaches Scribus');
  assert.match(rashiXml, /PFILE="\.\/assets\/smart-cards\/rashi-vrishabh\.png"/, 'Vrishabh artwork reaches Scribus');
  for (const item of rashiLayout.items) {
    assert.ok(rashiXml.includes(`CH="${item.name}"`), `sign name ${item.name} must reach the press file`);
    for (const line of item.readingLines) assert.ok(rashiXml.includes(`CH="${scribus.escapeXml(line)}"`), `reading line "${line}" must reach the press file, resolved exactly as layoutSmartCard() wrapped it`);
  }

  const panchangData = { items: [{ label: 'सूर्योदय', text: '०६:२३' }, { label: 'सूर्यास्त', text: '१८:५५' }] };
  const panchangSection = {
    x_px: 10, y_px: 10, width_px: 200, height_px: 120, margin_px: 8,
    headline: '', subheading: '', body: '', images: [],
    smart_card_key: 'panchang', smart_card_data: panchangData,
  };
  const panchangXml = await scribus.blockFrames(panchangSection);
  assert.match(panchangXml, /PFILE="\.\/assets\/smart-cards\/panchangwithoutBG\.png"/, 'Panchang artwork reaches Scribus');
  for (const item of panchangData.items) {
    assert.ok(panchangXml.includes(`CH="${item.label}"`), `label ${item.label} must reach the press file`);
    assert.ok(panchangXml.includes(`CH="${item.text}"`), `value ${item.text} must reach the press file`);
  }
});

test('sourced market and AI-structured tender cards remain structured in the Scribus press file', async () => {
  const marketSection = {
    x_px: 10, y_px: 10, width_px: 307, height_px: 240, margin_px: 8,
    headline: '', subheading: '', body: '', images: [], smart_card_key: 'market',
    smart_card_data: {
      title: 'शेअर / सोने बाजार', source: 'स्रोत : संपादकीय पडताळणी', asOf: '२६/०८/२०२६',
      trendLabel: 'गेल्या महिन्याचा कल',
      trend: {
        label: 'सेन्सेक्स', values: [80100, 80900, 80400, 81100, 81400],
        from: '२८ जुलै', to: '२६ ऑग', sessions: 5,
        changePercent: '+१.६२%', high: '८१,४००', low: '८०,१००',
      },
      items: [{ label: 'सोने २४ कॅरेट', value: '₹७४,२५०', change: '+०.४%' }, { label: 'सेन्सेक्स', value: '८१,४००', change: '-०.२%' }],
    },
  };
  const marketXml = await scribus.blockFrames(marketSection);
  for (const text of ['शेअर / सोने बाजार', 'सोने २४ कॅरेट', '₹७४,२५०', 'सेन्सेक्स', '८१,४००',
    // The month's line reaches the plate with its own scale: the caption, the
    // high and the low on the y axis, and the two session dates on the x. A
    // chart whose scale printed only in the browser would be a decoration on
    // the plate.
    'गेल्या महिन्याचा कल · सेन्सेक्स', '८०,१००', '२८ जुलै', '२६ ऑग']) {
    assert.ok(marketXml.includes(`CH="${scribus.escapeXml(text)}"`), `${text} must reach the market press frame`);
  }
  // And the line itself, not only its labels.
  assert.ok(/PTYPE="6"/.test(marketXml), 'the month\'s line reaches the press file as real geometry');

  const tenderSection = {
    x_px: 10, y_px: 10, width_px: 307, height_px: 500, margin_px: 8,
    headline: '', subheading: '', body: '', images: [], smart_card_key: 'tender',
    smart_card_data: {
      issuer: 'जिल्हाधिकारी कार्यालय, सातारा', reference: 'निविदा/२०२६/१२', date: '२७/०८/२०२६',
      subject: 'कार्यालयीन साहित्य पुरवठा', noticeTitle: 'निविदा सूचना',
      paragraphs: ['पात्र पुरवठादारांकडून बंद लिफाफ्यात निविदा मागविण्यात येत आहेत.'],
      table: { headers: ['अ.क्र.', 'बाब', 'प्रमाण'], rows: [['१', 'कागद', '१०० रीम']] },
      signatory: 'जिल्हाधिकारी, सातारा',
    },
  };
  const tenderXml = await scribus.blockFrames(tenderSection);
  for (const text of ['जिल्हाधिकारी कार्यालय, सातारा', 'निविदा सूचना', 'अ.क्र.', 'कागद', '१०० रीम']) {
    assert.ok(tenderXml.includes(`CH="${scribus.escapeXml(text)}"`), `${text} must reach the tender press frame`);
  }
});

test('a Smart Card too small for its own block is refused by preflight, not silently clipped in the press file', async () => {
  const preflight = require('../src/services/preflight.service');
  const tinySection = {
    id: 1, section_key: 'panchang', x_px: 20, y_px: 20, width_px: 30, height_px: 20, margin_px: 8,
    headline: '', subheading: '', body: '', images: [],
    smart_card_key: 'panchang',
    smart_card_data: { items: [{ label: 'सूर्योदय', text: '०६:२३' }, { label: 'सूर्यास्त', text: '१८:५५' }, { label: 'दिनमान', text: '१२ तास' }] },
  };
  const page = {
    page_number: 3, prints_colour: true,
    sections: [tinySection],
  };
  const newspaper = { publication_date: '2031-01-01' };
  const findings = await preflight.checkPage(page, newspaper, 4);
  assert.ok(findings.some((f) => f.check === 'smart-card-overset'), 'a Smart Card too small for its block must be a preflight finding');
});

// ---------------------------------------------------------- image print ---

function imageSection(image) {
  return {
    x_px: 30, y_px: 30, width_px: 200, height_px: 200, margin_px: 10,
    headline: '', subheading: '', body: '', images: [image],
  };
}

test('Contain, Cover and Stretch each place the picture through the SAME resolved transform image-geometry.js already computes for paint/resize', async () => {
  for (const fitMode of ['contain', 'cover', 'stretch']) {
    const image = {
      url: '/uploads/zz-scribus-fit.jpg', x_px: 0, y_px: 0, width_px: 120, height_px: 80,
      source_width_px: 300, source_height_px: 150, fit_mode: fitMode, rotation: 0,
    };
    const resolved = imageGeometry.resolvePlacedImage(image);
    const xml = await scribus.blockFrames(imageSection(image));
    assert.match(xml, new RegExp(`LOCALSCX="${resolved.scaleX}" LOCALSCY="${resolved.scaleY}"`), `${fitMode}: LOCALSCX/Y must be the resolved transform's own scale`);
    assert.match(xml, new RegExp(`WIDTH="${scribus.mm(resolved.frame.width)}" HEIGHT="${scribus.mm(resolved.frame.height)}"`), `${fitMode}: the frame itself must be the placement's own size`);
  }
});

test('a quarter-turn rotation reaches the press frame as a real ROT, and swaps the frame\'s own local target the same way the browser does', async () => {
  const image = {
    url: '/uploads/zz-scribus-rot.jpg', x_px: 0, y_px: 0, width_px: 100, height_px: 200,
    source_width_px: 200, source_height_px: 100, fit_mode: 'contain', rotation: 90,
  };
  const resolved = imageGeometry.resolvePlacedImage(image);
  const xml = await scribus.blockFrames(imageSection(image));
  assert.match(xml, /ROT="90"/);
  assert.equal(resolved.localTarget.width, 200, 'a quarter turn swaps the local target axes - the same rule exclusion.js and paint already apply');
});

test('a transparent PNG is referenced, not re-encoded - the press box gets the same file, unaltered', async () => {
  const image = { url: '/uploads/zz-scribus-alpha.png', x_px: 0, y_px: 0, width_px: 100, height_px: 100, source_width_px: 100, source_height_px: 100 };
  const xml = await scribus.blockFrames(imageSection(image));
  assert.match(xml, /PFILE="\.\/uploads\/zz-scribus-alpha\.png"/, 'the exact same file is referenced - no derived raster, no format change');
});

test('italic copy is flagged for a desk to check before press - no Devanagari face ships a true italic style, so the press file slants the upright letterforms', async () => {
  const preflight = require('../src/services/preflight.service');
  const section = {
    id: 1, section_key: 'lead', x_px: 20, y_px: 20, width_px: 200, height_px: 200, margin_px: 12,
    headline: 'खबर', body: '<p>हा <i>तिरका</i> मजकूर आहे.</p>', images: [],
  };
  const page = { page_number: 3, prints_colour: true, sections: [section] };
  const newspaper = { publication_date: '2031-01-01' };
  const findings = await preflight.checkPage(page, newspaper, 4);
  const finding = findings.find((f) => f.check === 'synthetic-italic-print');
  assert.ok(finding, 'italic copy must be flagged');
  assert.equal(finding.level, 'warning', 'it does not block press - the text is correct, only the slant is synthetic');
  assert.match(finding.message, /italic/);
});

test('underlined copy raises no warning - FEATURES="underline" is a real, unambiguous Scribus CharStyle flag, not a font substitute', async () => {
  const preflight = require('../src/services/preflight.service');
  const section = {
    id: 1, section_key: 'lead', x_px: 20, y_px: 20, width_px: 200, height_px: 200, margin_px: 12,
    headline: 'खबर', body: '<p>हा <u>अधोरेखित</u> मजकूर आहे.</p>', images: [],
  };
  const page = { page_number: 3, prints_colour: true, sections: [section] };
  const newspaper = { publication_date: '2031-01-01' };
  const findings = await preflight.checkPage(page, newspaper, 4);
  assert.ok(!findings.some((f) => f.check === 'synthetic-italic-print'), 'underline alone raises no italic warning');

  const xml = await scribus.blockFrames(section);
  assert.match(xml, /CH="अधोरेखित"[^/]*FEATURES="underline"/, 'the underlined run must actually carry FEATURES="underline" in the press file');
});

test('italic copy carries FEATURES="italic" in the press file - a real, verified Scribus CharStyle flag, not a dropped attribute', async () => {
  const section = {
    id: 1, section_key: 'lead', x_px: 20, y_px: 20, width_px: 200, height_px: 200, margin_px: 12,
    headline: 'खबर', body: '<p>हा <i>तिरका</i> मजकूर आहे.</p>', images: [],
  };
  const xml = await scribus.blockFrames(section);
  assert.match(xml, /CH="तिरका"[^/]*FEATURES="italic"/, 'the italic run must carry FEATURES="italic" in the press file');
});

test('plain bold copy with no italic raises no synthetic-italic warning', async () => {
  const preflight = require('../src/services/preflight.service');
  const section = {
    id: 1, section_key: 'lead', x_px: 20, y_px: 20, width_px: 200, height_px: 200, margin_px: 12,
    headline: 'खबर', body: '<p>हा <strong>ठळक</strong> मजकूर आहे.</p>', images: [],
  };
  const page = { page_number: 3, prints_colour: true, sections: [section] };
  const newspaper = { publication_date: '2031-01-01' };
  const findings = await preflight.checkPage(page, newspaper, 4);
  assert.ok(!findings.some((f) => f.check === 'synthetic-italic-print'), 'bold alone is a verified, real font - no warning needed');
});

// -------------------------------------------------------------- footer ---

function footerFixture(pageNumber) {
  const newspaper = { publication_date: '2031-03-15', page_width_mm: 330, page_height_mm: 530, matter_width_mm: 310, matter_height_mm: 510 };
  const g = geometry.geometryOf(newspaper);
  const identity = identityModule.identityFor(newspaper.publication_date, 4);
  const page = { page_number: pageNumber, sections: [] };
  return { newspaper, g, identity, page };
}

test('every page carries a footer with exactly the paper, the date and the page number - no rule, no extra sentence', async () => {
  for (const pageNumber of [1, 3, 4]) {
    const { newspaper, page } = footerFixture(pageNumber);
    const xml = await scribus.buildDocument(newspaper, [page]);
    const pageLabel = identityModule.devanagari(pageNumber);
    assert.ok(xml.includes(`पृष्ठ ${pageLabel}`), `page ${pageNumber}: the page number must be on the page`);
    assert.ok(xml.includes(identityModule.identity.title), `page ${pageNumber}: the paper's own name must be on the page`);
    assert.ok(!xml.includes(identityModule.identity.printline), `page ${pageNumber}: the short printline must not be duplicated onto every page`);
  }
});

test('page two, and only page two, carries the legal imprint - never duplicated, never on every page', async () => {
  const { newspaper, page: page1 } = footerFixture(1);
  const { page: page2 } = footerFixture(2);
  const { page: page3 } = footerFixture(3);

  const xml = await scribus.buildDocument(newspaper, [page1, page2, page3]);
  const imprintOccurrences = (xml.match(/साहस वार्ता हे दैनिक प्रकाशक/g) || []).length;
  assert.equal(imprintOccurrences, 1, 'the imprint must appear exactly once across the whole edition');
});

test('the folio order matches the outer-edge rule: recto is title, date, page; verso is page, date, title', async () => {
  const { newspaper, page: recto } = footerFixture(3); // odd page = recto
  const { page: verso } = footerFixture(4); // even page = verso

  const rectoXml = await scribus.buildDocument(newspaper, [recto]);
  const versoXml = await scribus.buildDocument(newspaper, [verso]);

  const objectOf = (xml, needle) => {
    const at = xml.indexOf(`CH="${needle}"`);
    assert.ok(at >= 0, `"${needle}" not found`);
    const objStart = xml.lastIndexOf('<PAGEOBJECT', at);
    const objEnd = xml.indexOf('</PAGEOBJECT>', at);
    return xml.slice(objStart, objEnd);
  };
  const xOf = (xml, needle) => Number(/XPOS="([\d.]+)"/.exec(objectOf(xml, needle))[1]);

  const rectoTitleX = xOf(rectoXml, identityModule.identity.title);
  const rectoPageX = xOf(rectoXml, `पृष्ठ ${identityModule.devanagari(3)}`);
  assert.ok(rectoTitleX < rectoPageX, 'recto: the title must sit to the LEFT of the page number');

  const versoTitleX = xOf(versoXml, identityModule.identity.title);
  const versoPageX = xOf(versoXml, `पृष्ठ ${identityModule.devanagari(4)}`);
  assert.ok(versoPageX < versoTitleX, 'verso: the page number must sit to the LEFT of the title - the outer-edge rule');

  const date = identityModule.dateLine(newspaper.publication_date);
  const dateText = `${date.day} ${date.monthYear}`;
  assert.match(objectOf(rectoXml, identityModule.identity.title), /<para ALIGN="0"\/>/,
    'the recto title is aligned to the left ear');
  assert.match(objectOf(rectoXml, dateText), /<para ALIGN="1"\/>/,
    'the date is centred on the page, not left-aligned at the start of its third');
  assert.match(objectOf(rectoXml, `पृष्ठ ${identityModule.devanagari(3)}`), /<para ALIGN="2"\/>/,
    'the recto page number is aligned to the outer right edge');
  assert.match(objectOf(versoXml, `पृष्ठ ${identityModule.devanagari(4)}`), /<para ALIGN="0"\/>/,
    'the verso page number is aligned to the outer left edge');
  assert.match(objectOf(versoXml, dateText), /<para ALIGN="1"\/>/,
    'the verso date remains centred too');
  assert.match(objectOf(versoXml, identityModule.identity.title), /<para ALIGN="2"\/>/,
    'the verso title is aligned to the right ear');
});

// ---------------------------------------------------------- multi-page ---

test('every object carries the OwnPage of the REAL page it sits on, not a hardcoded 0', async () => {
  const newspaper = { publication_date: '2031-06-01', page_width_mm: 330, page_height_mm: 530, matter_width_mm: 310, matter_height_mm: 510 };
  const page1 = {
    page_number: 1,
    sections: [{ x_px: 40, y_px: 60, width_px: 200, height_px: 100, margin_px: 10, headline: 'पहिले पान', body: '', images: [] }],
  };
  const page2 = {
    page_number: 2,
    sections: [{ x_px: 40, y_px: 60, width_px: 200, height_px: 100, margin_px: 10, headline: 'दुसरे पान', body: '', images: [] }],
  };
  const xml = await scribus.buildDocument(newspaper, [page1, page2]);

  const objectFor = (needle) => {
    const at = xml.indexOf(`CH="${needle}"`);
    assert.ok(at >= 0, `"${needle}" not found`);
    const objStart = xml.lastIndexOf('<PAGEOBJECT', at);
    return xml.slice(objStart, at);
  };
  assert.match(objectFor('पहिले पान'), /OwnPage="0"/);
  assert.match(objectFor('दुसरे पान'), /OwnPage="1"/);
});

test('ANZPAGES, page geometry in millimetres, and well-formed XML still hold for a multi-page real document', async () => {
  const newspaper = { publication_date: '2031-06-01', page_width_mm: 330, page_height_mm: 530, matter_width_mm: 310, matter_height_mm: 510 };
  const pages = [1, 2, 3].map((n) => ({ page_number: n, sections: [] }));
  const xml = await scribus.buildDocument(newspaper, pages);
  assert.match(xml, /ANZPAGES="3"/);
  const opens = (xml.match(/<(DOCUMENT|SCRIBUSUTF8NEW|PAGEOBJECT)\b[^>]*[^/]>/g) || []).length;
  const closes = (xml.match(/<\/(DOCUMENT|SCRIBUSUTF8NEW|PAGEOBJECT)>/g) || []).length;
  assert.equal(opens, closes);
});
