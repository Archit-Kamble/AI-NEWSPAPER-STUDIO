const test = require('node:test');
const assert = require('node:assert/strict');

const panels = require('../public/editor/layout/inset-panels.js');
const printModel = require('../src/services/export/print-model');
const scribus = require('../src/services/scribus.service');

let inks;
let render;

test.before(async () => {
  [inks, render] = await Promise.all([
    import('../public/editor/layout/inks.js'),
    import('../public/editor/compose/render.js'),
  ]);
});

const composition = () => ({
  content: { left: 2, top: 2, right: 198, bottom: 190, measure: 196 },
  bands: {
    kicker: { top: 2, height: 10, lines: [{ text: 'सातारा', x: 2, y: 2, width: 38, measure: 196, height: 10, fontPx: 7, family: 'sans', weight: 700 }] },
    headline: { top: 14, height: 40, lines: [
      { text: 'शहरासाठी नवी', x: 2, y: 14, width: 176, measure: 196, height: 20, fontPx: 15, family: 'sans', weight: 700 },
      { text: 'योजना मंजूर', x: 2, y: 34, width: 112, measure: 196, height: 20, fontPx: 15, family: 'sans', weight: 700 },
    ] },
    deck: { top: 60, height: 10, lines: [{ text: 'काम पुढील महिन्यात सुरू', x: 2, y: 60, width: 150, measure: 196, height: 10, fontPx: 8, family: 'sans', weight: 400 }] },
  },
  bodyLines: [{ text: 'मजकूर', x: 2, y: 76, width: 35, measure: 196, height: 9, fontPx: 6.4, family: 'serif', weight: 400 }],
});

test('headline furniture is derived only from final composition rectangles', () => {
  const made = composition();
  const tab = inks.headlineFurniture('kicker-tab', made);
  assert.deepEqual(tab.map((item) => item.kind), ['fill', 'rule']);
  assert.ok(tab.every((item) => item.y >= made.bands.kicker.top));
  assert.ok(tab.every((item) => item.y + item.height <= made.bands.headline.top), 'the tab cannot paint under the headline');

  const ruled = inks.headlineFurniture('headline-rule', made);
  assert.equal(ruled.length, 1);
  assert.ok(ruled[0].y >= 54 && ruled[0].y + ruled[0].height <= 60, 'the rule sits in the real headline-to-deck gap');

  const display = inks.headlineFurniture('display-rule', made);
  assert.equal(display.length, 1);
  assert.ok(display[0].y >= 70 && display[0].y + display[0].height <= 76, 'the rule sits in the real display-to-body gap');

  const noBody = composition();
  noBody.bodyLines = [];
  const close = inks.headlineFurniture('display-rule', noBody)[0];
  assert.ok(close.y <= 72, 'a body-less story does not strand its display rule in the middle of empty paper');
});

test('stepped headline bands stay behind each line instead of striking Marathi descenders', () => {
  const made = composition();
  const pieces = inks.headlineFurniture('stepped-lines', made);
  const fills = pieces.filter((item) => item.kind === 'fill');
  const rails = pieces.filter((item) => item.kind === 'rule');
  assert.equal(fills.length, made.bands.headline.lines.length);
  assert.equal(rails.length, fills.length);
  fills.forEach((fill, index) => {
    const line = made.bands.headline.lines[index];
    assert.equal(fill.y, line.y);
    assert.equal(fill.height, line.height);
    assert.ok(fill.width <= line.measure);
  });
});

test('the canonical HTML renderer paints the new furniture but never recomposes a line', () => {
  const made = composition();
  const before = JSON.stringify(made);
  const html = render.composedMarkup(made, {
    headlineStyle: 'kicker-tab-rule', accentColor: '#c8102e',
    headlineInk: null, body: '', editorialPresentation: null,
  });
  assert.match(html, /section-headline-furniture/);
  assert.match(html, /is-fill/);
  assert.match(html, /is-rule/);
  assert.equal(JSON.stringify(made), before, 'rendering is paint-only');
});

const NEW_PANEL_KINDS = ['key-number', 'explainer', 'timeline', 'qa', 'reaction', 'related', 'follow-up'];

test('every structured insert has editable defaults, legal geometry and bounded type', () => {
  for (const kind of NEW_PANEL_KINDS) {
    const raw = panels.defaultPanelFor(kind, { width: 260, height: 320 }, 6.4);
    const panel = panels.panelOf(raw, { width: 260, height: 320 });
    assert.ok(panel, `${kind} was rejected`);
    assert.equal(panel.kind, kind);
    assert.ok(panel.x >= 0 && panel.y >= 0);
    assert.ok(panel.x + panel.width <= 260 && panel.y + panel.height <= 320);
    const solved = panels.panelLayout(panel, 6.4);
    assert.ok(solved.lines.length >= 2, `${kind} needs a title and content`);
    assert.ok(solved.lines.every((line) => line.y >= 0 && line.y + line.fontPx * solved.lineHeight <= panel.height));
  }
});

test('structured inserts carry newspaper semantics, not aliases for a fact box', () => {
  const solve = (kind) => {
    const panel = panels.panelOf(panels.defaultPanelFor(kind, { width: 260, height: 320 }, 6.4), { width: 260, height: 320 });
    return panels.panelLayout(panel, 6.4).lines;
  };
  assert.equal(solve('key-number')[0].role, 'figure');
  assert.ok(solve('key-number')[0].fontPx > solve('key-number')[1].fontPx * 2);
  assert.deepEqual(solve('qa').slice(1).map((line) => [line.role, line.family, line.bold]), [
    ['question', 'sans', true], ['answer', 'serif', false],
  ]);
  assert.match(solve('explainer')[1].text, /^१\./);
  assert.match(solve('timeline')[1].text, /^१—/);
  assert.match(solve('related')[1].text, /^▪/);
  assert.match(solve('follow-up')[1].text, /^काल :/);
  assert.match(solve('follow-up')[2].text, /^आज :/);
  assert.match(solve('follow-up')[3].text, /^पुढे :/);
  assert.equal(solve('reaction').at(-1).role, 'attribution');
});

test('all new panels reach the shared press model with their font, weight and accent', () => {
  const insetPanels = NEW_PANEL_KINDS.map((kind, index) => ({
    ...panels.defaultPanelFor(kind, { width: 700, height: 700 }, 6.4),
    id: `p-${index}`, x: index * 105, y: 20, width: 100, height: 150,
  }));
  const section = {
    x_px: 20, y_px: 30, width_px: 700, height_px: 700,
    body_font_px: 6.4, accent_color: '#176b68', inset_panels: insetPanels,
  };
  const items = printModel.blockDecorations(section, {});
  const text = items.filter((item) => item.kind === 'text');
  for (const raw of insetPanels) {
    assert.ok(text.some((item) => item.runs.some((run) => run.text === raw.title)), `${raw.kind} title absent from print model`);
  }
  const figure = text.find((item) => item.runs.some((run) => run.text === insetPanels[0].title));
  assert.equal(figure.runs[0].family, 'sans');
  assert.equal(figure.runs[0].bold, true);
  assert.equal(figure.runs[0].ink, '#176b68');
  assert.ok(items.some((item) => item.kind === 'rule'), 'panel rules reach the plate');
  assert.ok(items.some((item) => item.kind === 'fill'), 'panel grounds reach the plate');
});

test('chart and table panel chrome is explicitly neutral in the shared catalogue', () => {
  for (const kind of ['chart', 'table']) {
    assert.deepEqual(panels.panelStyle(kind).edges, []);
    assert.equal(panels.panelStyle(kind).ground, false);
  }
});

test('Scribus receives the new headline furniture and structured panel ink', async () => {
  const panel = {
    ...panels.defaultPanelFor('key-number', { width: 500, height: 500 }, 6.4),
    id: 'key-figure', x: 330, y: 180, width: 150, height: 130,
  };
  const section = {
    section_key: 'lead', block_type: 'article', x_px: 40, y_px: 60, width_px: 500, height_px: 500,
    margin_px: 1, kicker: 'विशेष', headline: 'साताऱ्यासाठी नवी योजना', subheading: 'काम सुरू होणार', body: '',
    headline_font_px: 24, subheading_font_px: 13, body_font_px: 6.4, line_height: 1.45,
    text_align: 'justify', font_family: 'serif', font_weight: 400,
    background_color: null, border_style: 'none', headline_style: 'kicker-tab-rule',
    accent_color: '#0f6d78', headline_ink: '#0f6d78', images: [], inset_panels: [panel],
  };
  const newspaper = {
    id: 1, publication_date: '2026-09-05', page_width_px: 660, page_height_px: 1060,
    margin_x_px: 20, margin_y_px: 20, matter_width_px: 620, matter_height_px: 1020,
  };
  const xml = await scribus.buildDocument(newspaper, [{ id: 1, page_number: 1, sections: [section] }]);
  assert.match(xml, /CH="१\.२५ कोटी"[^>]+FONT="Noto Sans Devanagari Bold"[^>]+TXTFILL="SahasTeal"/);
  assert.match(xml, /CH="विशेष"[^>]+TXTFILL="SahasTeal"/);
  assert.ok((xml.match(/PCOLOR="SahasTeal"/g) || []).length >= 2, 'tab rail and display rule are real press frames');
});
