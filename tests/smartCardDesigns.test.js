const test = require('node:test');
const assert = require('node:assert/strict');
const { smartCardLines } = require('../src/services/export/smart-card-lines');

let layout, cards, designs, panel;
test.before(async () => {
  layout = await import('../public/editor/smart-cards/layout.js');
  cards = await import('../public/editor/smart-cards/smart-cards.js');
  designs = await import('../public/editor/smart-cards/designs.js');
  panel = await import('../public/editor/external-editor/smart-card-panel.js');
  const metrics = await import('../public/editor/compose/font-metrics.js');
  const shaper = await import('../public/editor/compose/shaper.js');
  await Promise.all([metrics.ensureFontsLoaded(), shaper.ensureShaperReady()]);
});

const frame = { width: 260, height: 320, padding: 1 };
const market = {
  title: 'शेअर / सोने बाजार', asOf: 'बंद भाव · ६ सप्टेंबर', source: 'चाचणी नमुना',
  items: [
    { label: 'सेन्सेक्स', value: '८१,२००', change: '+०.५%', direction: 'up', group: 'index' },
    { label: 'निफ्टी', value: '२४,८००', change: '−०.२%', direction: 'down', group: 'index' },
    { label: 'सोने', value: '७२,४००', change: '+०.३%', direction: 'up', group: 'bullion' },
    { label: 'चांदी', value: '९१,६००', change: '−०.१%', direction: 'down', group: 'bullion' },
  ],
  trend: { values: [79820, 80340, 80110, 80660, 81200], from: '२ सप्टेंबर', to: '६ सप्टेंबर' },
};

function clone(value) { return JSON.parse(JSON.stringify(value)); }
function withoutDesign(html) { return html.replace(/\sdata-design="[^"]*"/, ''); }
function primitives(entries) {
  return entries.map((entry) => ({ kind: entry.kind || 'text', text: entry.text || '', x: entry.x, y: entry.y,
    width: entry.width, height: entry.height, points: entry.points, ink: entry.ink, bold: entry.bold }));
}

test('market compositions alter solved geometry and both output surfaces without losing source data', () => {
  const original = clone(market);
  const classicPayload = { ...clone(market), design: 'classic' };
  const classic = layout.layoutSmartCard('market', classicPayload, frame);
  const classicMarkup = withoutDesign(cards.smartCardMarkup('market', classicPayload, frame));
  const classicPrint = primitives(smartCardLines('market', classicPayload, frame, layout));
  const classicText = cards.smartCardText('market', classicPayload);
  const offered = designs.designsForCard('market');

  assert.deepEqual(offered.map(({ key }) => key), ['classic', 'lead-index', 'chart-led']);
  for (const { key: design } of offered) {
    const payload = { ...clone(market), design };
    const solved = layout.layoutSmartCard('market', payload, frame);
    const exported = smartCardLines('market', payload, frame, layout);
    const markup = cards.smartCardMarkup('market', payload, frame);

    assert.deepEqual(market, original, 'composition must never mutate saved input');
    assert.deepEqual(payload.items, market.items, 'composition must not drop or reorder rate rows');
    assert.equal(cards.smartCardText('market', payload), classicText, 'the editable card copy stays identical');
    assert.ok(markup.includes(`data-design="${design}"`));
    assert.ok(exported.length, 'every shown layout has a press representation');

    if (design !== 'classic') {
      assert.notEqual(withoutDesign(markup), classicMarkup,
        'an alternate is a composition, not a changed data attribute or border');
      assert.notDeepEqual(primitives(exported), classicPrint,
        'the press receives alternate primitives, not classic geometry');
      assert.notDeepEqual(solved.geometry, classic.geometry,
        'the layout solver, rather than CSS, owns the changed geometry');
    }
  }
});

test('classic remains the exact legacy market answer, including old skin values', () => {
  const legacy = layout.layoutSmartCard('market', clone(market), frame);
  const explicit = layout.layoutSmartCard('market', { ...clone(market), design: 'classic' }, frame);
  const oldSkin = layout.layoutSmartCard('market', { ...clone(market), design: 'heritage' }, frame);
  assert.deepEqual({ ...explicit, design: undefined, composition: undefined }, { ...legacy, design: undefined, composition: undefined });
  assert.deepEqual({ ...oldSkin, design: undefined, composition: undefined }, { ...legacy, design: undefined, composition: undefined });
  assert.equal(designs.cardDesign('market', '<script>'), 'classic');
  assert.equal(designs.cardDesign('advert', 'chart-led'), 'classic');
});

test('picker is an accessible, interactive market composition chooser', () => {
  const html = panel.cardDesignPicker({ smartCardKey: 'market', smartCardData: { ...market, design: 'chart-led' } }, frame);
  assert.equal((html.match(/data-card-design=/g) || []).length, 3);
  assert.equal((html.match(/aria-pressed="true"/g) || []).length, 1);
  assert.ok(html.includes('data-card-design="chart-led" aria-pressed="true"'));
  assert.ok(html.includes('Use this layout'));
  assert.ok(html.includes('Fits this block') || html.includes('Needs more space'));
  assert.equal(panel.cardDesignPicker({ smartCardKey: 'tender', smartCardData: {} }, frame), '');
});

test('Rashi ledger is a distinct, complete print-safe horoscope column', () => {
  const allSigns = [
    ['mesh', 'मेष', 'आज कामात यश मिळेल. आत्मविश्वासाने पुढे जा.', 9, 'लाल'],
    ['vrishabh', 'वृषभ', 'आर्थिक निर्णयात विचारपूर्वक पाऊल टाका.', 6, 'पांढरा'],
    ['mithun', 'मिथुन', 'संवादातून नवे मार्ग सापडतील.', 5, 'हिरवा'],
    ['kark', 'कर्क', 'घरातील वातावरण आनंदी राहील.', 2, 'चंदेरी'],
    ['sinh', 'सिंह', 'नवीन संधीचा योग्य लाभ घ्या.', 1, 'सोनेरी'],
    ['kanya', 'कन्या', 'कामाचे नियोजन तुम्हाला लाभदायक ठरेल.', 3, 'हिरवा'],
    ['tula', 'तुळ', 'भागीदारीत समतोल ठेवा.', 7, 'निळा'],
    ['vrishchik', 'वृश्चिक', 'सावध संवादाने प्रश्न सुटतील.', 4, 'लाल'],
    ['dhanu', 'धनु', 'प्रवासाचा योग अनुकूल आहे.', 8, 'पिवळा'],
    ['makar', 'मकर', 'शिस्तीत केलेले प्रयत्न यश देतील.', 5, 'करडा'],
    ['kumbh', 'कुंभ', 'नव्या कल्पनांना आकार द्या.', 6, 'निळा'],
    ['meen', 'मीन', 'मन प्रसन्न ठेवणारी बातमी मिळेल.', 9, 'पांढरा'],
  ].map(([key, name, text, luckyNumber, luckyColour]) => ({ key, name, text, luckyNumber, luckyColour }));

  assert.deepEqual(designs.designsForCard('rashi').map(({ key }) => key),
    ['classic', 'zodiac-capsules', 'zodiac-ledger']);

  const rashiPicker = panel.cardDesignPicker({
    smartCardKey: 'rashi', smartCardData: { signs: clone(allSigns.slice(0, 3)), design: 'zodiac-ledger' },
  }, { width: 260, height: 300, padding: 1 });
  assert.equal((rashiPicker.match(/data-card-design=/g) || []).length, 3, 'the desk can choose all three Rashi compositions');
  assert.ok(rashiPicker.includes('data-card-design="zodiac-ledger" aria-pressed="true"'));

  const classicSource = { signs: clone(allSigns.slice(0, 1)) };
  const classicFrame = { width: 260, height: 300, padding: 1 };
  assert.deepEqual(
    layout.layoutSmartCard('rashi', classicSource, classicFrame),
    layout.layoutSmartCard('rashi', { ...classicSource, design: 'classic' }, classicFrame),
    'existing Rashi cards keep their exact classic result',
  );
  assert.deepEqual(
    layout.layoutSmartCard('rashi', classicSource, classicFrame),
    layout.layoutSmartCard('rashi', { ...classicSource, design: 'not-a-design' }, classicFrame),
    'an invalid saved design safely falls back to classic',
  );

  for (const count of [1, 3, 12]) {
    const source = { signs: clone(allSigns.slice(0, count)) };
    const rashiFrame = count === 12 ? { width: 307, height: 620, padding: 1 } : { width: 260, height: 300, padding: 1 };
    const ledger = layout.layoutSmartCard('rashi', { ...clone(source), design: 'zodiac-ledger' }, rashiFrame);
    const capsules = layout.layoutSmartCard('rashi', { ...clone(source), design: 'zodiac-capsules' }, rashiFrame);
    const press = smartCardLines('rashi', { ...clone(source), design: 'zodiac-ledger' }, rashiFrame, layout);

    assert.deepEqual(source.signs, allSigns.slice(0, count), 'the card never mutates sign data');
    assert.equal(ledger.fitState, 'FITS', `${count} ordinary readings fit their intended ledger frame`);
    assert.equal(ledger.design, 'zodiac-ledger');
    assert.match(ledger.geometry.composition, /horoscope-ledger/);
    assert.notDeepEqual(semanticGeometry(ledger.primitives), semanticGeometry(capsules.primitives),
      'ledger is a horizontal reading column, not another capsule grid');
    assert.equal(ledger.primitives.filter((item) => item.kind === 'image').length, count,
      'each selected sign keeps its downloaded artwork');

    for (const sign of source.signs) {
      const signName = ledger.primitives.find((item) => item.kind === 'text' && item.text.includes(sign.name));
      assert.ok(signName, sign.name);
      assert.equal(signName.align, 1, `${sign.name} is centred in its own facts column`);
      const signFacts = ledger.primitives.find((item) => item.kind === 'text'
        && item.text.join(' ').includes(`शुभ अंक ${sign.luckyNumber}`));
      assert.ok(signFacts, `${sign.name} lucky details are present`);
      assert.equal(signFacts.align, 1, `${sign.name} lucky details are centred in their own facts column`);
      assert.ok(ledger.primitives.some((item) => item.kind === 'text' && item.text.join(' ') === sign.text), sign.text);
      assert.ok(ledger.primitives.some((item) => item.kind === 'text' && item.text.join(' ').includes(String(sign.luckyNumber))), 'lucky number retained');
      assert.ok(ledger.primitives.some((item) => item.kind === 'text' && item.text.join(' ').includes(sign.luckyColour)), 'lucky colour retained');
    }

    for (const primitive of ledger.primitives) {
      assert.ok(primitive.x >= 0 && primitive.y >= 0);
      assert.ok(primitive.x + primitive.width <= rashiFrame.width + 0.1);
      assert.ok(primitive.y + primitive.height <= rashiFrame.height + 0.1);
    }
    assert.ok(press.length > 0, 'the resolved ledger has a press representation');
  }
});

test('Rashi ledger reflows from the real card frame and centres every zodiac emblem in its rail', () => {
  const keys = ['mesh', 'vrishabh', 'mithun', 'kark', 'sinh', 'kanya', 'tula', 'vrishchik', 'dhanu', 'makar', 'kumbh', 'meen'];
  const signs = keys.map((key, index) => ({
    key, name: `राशी ${index + 1}`,
    text: 'आज कामात यश मिळेल. आत्मविश्वासाने पुढे जा.',
    luckyNumber: index + 1, luckyColour: 'लाल',
  }));
  const payload = { design: 'zodiac-ledger', signs };
  const standard = layout.layoutSmartCard('rashi', clone(payload), { width: 307, height: 620, padding: 1 });
  const tall = layout.layoutSmartCard('rashi', clone(payload), { width: 307, height: 920, padding: 1 });
  const wideAndShort = layout.layoutSmartCard('rashi', clone(payload), { width: 520, height: 360, padding: 1 });

  assert.equal(standard.fitState, 'FITS');
  assert.equal(tall.fitState, 'FITS');
  assert.equal(wideAndShort.fitState, 'FITS');
  assert.equal(standard.geometry.columns, 2, 'the everyday block uses two readable ledger columns');
  assert.equal(tall.geometry.columns, 1, 'extra height gives each forecast its full-width reading measure');
  assert.equal(wideAndShort.geometry.columns, 3, 'a wide but short block reflows into more rows, rather than clipping');

  const bodyFont = (result) => result.primitives.find((item) => item.kind === 'text' && item.text.join(' ').includes('आज कामात'))?.fontPx;
  assert.ok(bodyFont(tall) > bodyFont(standard), 'the taller frame earns larger actual reading type');

  for (const result of [standard, tall, wideAndShort]) {
    const images = result.primitives.filter((item) => item.kind === 'image');
    const rails = result.geometry.imageRails;
    assert.equal(images.length, signs.length);
    assert.equal(rails.length, signs.length);
    rails.forEach((rail, index) => {
      const image = images[index];
      assert.ok(Math.abs((image.x + image.width / 2) - (rail.x + rail.width / 2)) < 0.01,
        `zodiac image ${index + 1} is centred in its own image rail`);
      assert.equal(image.x, rail.imageX);
      assert.equal(image.width, rail.imageWidth);
    });
  }
});

const standingSamples = {
  suvichar: { text: 'प्रयत्न हीच यशाची किल्ली आहे; प्रत्येक दिवस नवी संधी घेऊन येतो.', attribution: 'संपादकीय' },
  panchang: { items: [{ label: 'सूर्योदय', text: '०६:२१' }, { label: 'सूर्यास्त', text: '१८:४२' }, { label: 'दिनमान', text: '१२ तास २१ मिनिटे' }, { label: 'राहुकाळ', text: '१०:३० ते १२:००' }, { label: 'तिथी', text: 'शुक्ल पक्ष पंचमी' }, { label: 'शके', text: '१९४८' }] },
  dinvishesh: { entries: [{ text: 'आजचा ऐतिहासिक दिनविशेष' }, { text: 'स्थानिक सार्वजनिक सुट्टी' }] },
  rashi: { signs: [{ key: 'mesh', name: 'मेष', text: 'आज कामात यश मिळेल.', luckyNumber: 9 }, { key: 'vrishabh', name: 'वृषभ', text: 'संवादातून नवे मार्ग सापडतील.', luckyNumber: 6 }] },
  havaman: { cities: [{ name: 'सातारा', max: 29, min: 21, rain: 2, condition: 'ढगाळ' }, { name: 'कराड', max: 30, min: 22, rain: 1, condition: 'हलका पाऊस' }] },
  sudoku: { grid: Array.from({ length: 9 }, (_, row) => Array.from({ length: 9 }, (_, col) => (row === col ? row + 1 : 0))) },
};

test('every standing-card design is a retained-data, shared browser/press composition', () => {
  for (const [key, data] of Object.entries({ market, ...standingSamples })) {
    const supplied = clone(data);
    const classicPayload = { ...clone(data), design: 'classic' };
    const classic = layout.layoutSmartCard(key, classicPayload, frame);
    const classicMarkup = withoutDesign(cards.smartCardMarkup(key, classicPayload, frame));
    const classicPrint = primitives(smartCardLines(key, classicPayload, frame, layout));
    const classicText = cards.smartCardText(key, classicPayload);
    const choices = designs.designsForCard(key);
    const alternateGeometries = [];
    assert.ok(choices.length >= 2, `${key} offers a real alternate composition`);

    for (const { key: design } of choices) {
      const payload = { ...clone(data), design };
      const solved = layout.layoutSmartCard(key, payload, frame);
      const markup = cards.smartCardMarkup(key, payload, frame);
      const printed = smartCardLines(key, payload, frame, layout);
      assert.deepEqual(data, supplied, `${key}/${design} never mutates its source`);
      assert.equal(cards.smartCardText(key, payload), classicText, `${key}/${design} preserves editable source copy`);
      assert.equal(solved.design, design, `${key}/${design} is normalized by the solver`);
      assert.ok(markup.includes(`data-design="${design}"`));
      for (const mark of solved.designMarks || []) {
        assert.ok(printed.some((entry) => entry.kind === 'bar' && Object.keys(mark).every((field) => entry[field] === mark[field])),
          `${key}/${design} structural primitive reaches the press unchanged`);
      }
      if (design !== 'classic') {
        assert.ok(solved.primitives?.length, `${key}/${design} must be expressed as shared positioned primitives`);
        assert.ok(semanticGeometry(solved.primitives).length, `${key}/${design} must move readable content, not only add background bars`);
        for (const primitive of solved.primitives) {
          const expected = primitive.kind === 'text'
            ? (primitive.text || []).map((text, index) => ({ kind: undefined, text, x: primitive.x,
              y: primitive.y + index * primitive.lineHeightPx, width: primitive.width, height: primitive.lineHeightPx,
              fontPx: primitive.fontPx, align: primitive.align || 0, bold: Boolean(primitive.bold), ink: primitive.ink,
              family: primitive.family || 'serif' }))
            : [primitive];
          for (const item of expected) {
            assert.ok(printed.some((entry) => Object.entries(item).every(([field, value]) =>
              Array.isArray(value) ? JSON.stringify(entry[field]) === JSON.stringify(value) : entry[field] === value)),
              `${key}/${design} ${primitive.kind} primitive reaches print with its exact solved geometry`);
          }
        }
        assert.notEqual(withoutDesign(markup), classicMarkup, `${key}/${design} changes actual browser composition`);
        assert.notDeepEqual(primitives(printed), classicPrint, `${key}/${design} changes actual press primitives`);
        assert.notDeepEqual(solved, classic, `${key}/${design} is not a classic layout with a different label`);
        assert.notDeepEqual(semanticGeometry(solved.primitives), semanticGeometry(classic.primitives),
          `${key}/${design} changes text/image hierarchy, not only furniture`);
        alternateGeometries.push({ design, geometry: semanticGeometry(solved.primitives) });
      }
    }
    for (let index = 1; index < alternateGeometries.length; index++) {
      assert.notDeepEqual(alternateGeometries[index].geometry, alternateGeometries[index - 1].geometry,
        `${key} alternatives ${alternateGeometries[index - 1].design} and ${alternateGeometries[index].design} have distinct content hierarchy`);
    }
  }
});

function printedText(key, payload) {
  return smartCardLines(key, payload, frame, layout).filter((entry) => !entry.kind).map((entry) => entry.text).join('\n');
}

function semanticGeometry(primitives = []) {
  return primitives.filter((item) => item.kind === 'text' || item.kind === 'image').map((item) => ({
    kind: item.kind, text: item.text, file: item.file, x: item.x, y: item.y, width: item.width, height: item.height,
    fontPx: item.fontPx, align: item.align,
  }));
}

test('alternate primitives retain all editorial and factual fields, never only a visual subset', () => {
  const marketData = { ...clone(market), asOf: 'बंद भाव · ६ सप्टेंबर', note: 'महिन्याचा कल स्थिर', source: 'स्रोत : चाचणी बाजार',
    items: [{ label: 'सेन्सेक्स', unit: 'गुण', value: '८१,२००', change: '+०.५%', direction: 'up' }], trend: { values: [79820, 81200] } };
  const marketText = printedText('market', { ...marketData, design: 'lead-index' });
  for (const value of [marketData.title, marketData.asOf, marketData.items[0].label, marketData.items[0].unit,
    marketData.items[0].value, marketData.items[0].change, marketData.note, marketData.source]) {
    assert.ok(marketText.includes(value), `market alternate must print ${value}`);
  }

  const rashiData = { signs: [{ key: 'mesh', name: 'मेष', text: 'आज कामात यश मिळेल.', luckyNumber: 9, luckyColour: 'निळा' }] };
  assert.ok(printedText('rashi', { ...rashiData, design: 'zodiac-capsules' }).includes('निळा'), 'rashi alternate retains lucky colour');

  const weatherData = { cities: [{ key: 'satara', name: 'सातारा', maxC: 29, minC: 21, rainMm: 2, rainChance: 40, condition: 'ढगाळ' }], source: 'Open-Meteo · ६ सप्टेंबर' };
  const weatherText = printedText('havaman', { ...weatherData, design: 'weather-desk' });
  for (const value of ['सातारा', '29°', '21°', '2 मिमी', '40%', 'ढगाळ', weatherData.source]) {
    assert.ok(weatherText.includes(value), `weather alternate must print canonical field ${value}`);
  }

  const solutionOnly = { solution: Array.from({ length: 9 }, () => Array(9).fill(9)), design: 'puzzle-folio' };
  const sudokuLines = smartCardLines('sudoku', solutionOnly, frame, layout).filter((entry) => !entry.kind);
  assert.equal(sudokuLines.filter((entry) => entry.text === '9').length, 0, 'a solution-only payload must never publish its answers as the puzzle');
});
