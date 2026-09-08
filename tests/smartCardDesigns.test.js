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
