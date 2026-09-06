const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

let designs;
let inks;
let properties;

test.before(async () => {
  const root = path.resolve(__dirname, '..');
  designs = await import(pathToFileURL(path.join(root, 'public/editor/layout/block-design-presets.js')));
  inks = await import(pathToFileURL(path.join(root, 'public/editor/layout/inks.js')));
  properties = await import(pathToFileURL(path.join(root, 'public/editor/external-editor/properties-panel.js')));
});

const section = (overrides = {}) => ({
  section_key: 'lead', block_type: 'article', width_px: 240, height_px: 220,
  ...overrides,
});

const view = (overrides = {}) => ({
  blockType: 'article', storyType: 'STANDARD', editorialPriority: 3,
  smartCardKey: null,
  ...overrides,
});

test('the library offers a broad original newspaper vocabulary with unique names', () => {
  assert.ok(designs.BLOCK_DESIGN_PRESETS.length >= 61);
  const keys = designs.BLOCK_DESIGN_PRESETS.map((entry) => entry.key);
  assert.equal(new Set(keys).size, keys.length);
  assert.ok(designs.BLOCK_DESIGN_CATEGORIES.length >= 5);
  assert.ok(designs.BLOCK_DESIGN_CATEGORIES.includes('International newsroom'));
  assert.ok(designs.BLOCK_DESIGN_CATEGORIES.includes('Accountability'));
  assert.ok(designs.BLOCK_DESIGN_PRESETS.every((entry) => entry.label && entry.marathi && entry.description));
  assert.ok(designs.BLOCK_DESIGN_PRESETS.some((entry) => entry.surface.frameShape), 'the preset library should expose shaped feature treatments');
});

test('every choice is a materially distinct printable surface', () => {
  const surfaces = designs.BLOCK_DESIGN_PRESETS.map((entry) => JSON.stringify(entry.surface));
  assert.equal(new Set(surfaces).size, surfaces.length);
});

test('a block design can only write appearance fields - never sacred geometry or copy', () => {
  const forbidden = new Set([
    'x', 'y', 'width', 'height', 'xPx', 'yPx', 'widthPx', 'heightPx',
    'headline', 'subheading', 'body', 'caption', 'imageUrl', 'images',
    'headlineFontPx', 'subheadingFontPx', 'bodyFontPx', 'marginPx',
    'columnCount', 'lineHeight', 'paragraphSpacingPx',
  ]);
  for (const entry of designs.BLOCK_DESIGN_PRESETS) {
    assert.deepEqual(Object.keys(entry.surface).sort(), [...designs.BLOCK_DESIGN_FIELDS].sort());
    assert.equal(Object.keys(entry.surface).some((key) => forbidden.has(key)), false, entry.key);
  }
});

test('every preset uses the closed print palette and existing renderer treatments', () => {
  const legalInks = new Set(inks.INKS.map((entry) => entry.hex ?? null));
  const legalTints = new Set(inks.TINTS.map((entry) => entry.hex ?? null));
  const legalHeads = new Set(inks.HEADLINE_STYLE_KEYS);
  for (const entry of designs.BLOCK_DESIGN_PRESETS) {
    assert.ok(legalInks.has(entry.surface.borderInk), `${entry.key} rule ink`);
    assert.ok(legalInks.has(entry.surface.headlineInk), `${entry.key} headline ink`);
    assert.ok(legalInks.has(entry.surface.accentColor), `${entry.key} accent ink`);
    assert.ok(legalTints.has(entry.surface.backgroundColor), `${entry.key} ground`);
    assert.ok(legalHeads.has(entry.surface.headlineStyle), `${entry.key} headline treatment`);
    assert.ok(entry.surface.headlineStyle.length <= 20, `${entry.key} headline style exceeds the database column`);
    assert.ok(entry.surface.borderStyle.length <= 20, `${entry.key} border style exceeds the database column`);
  }
});

test('applying a preset is deterministic and returns a fresh patch', () => {
  const first = designs.blockDesignPatch('analysis-navy');
  const second = designs.blockDesignPatch('analysis-navy');
  assert.deepEqual(first, second);
  assert.notEqual(first, second);
  first.borderStyle = 'none';
  assert.notEqual(first.borderStyle, designs.blockDesignPatch('analysis-navy').borderStyle);
  assert.equal(designs.blockDesignPatch('not-a-design'), null);
});

test('old blocks are unchanged until a person explicitly asks for a patch', () => {
  const before = view({ headline: 'मथळा', borderStyle: 'rule', backgroundColor: null });
  designs.availableBlockDesigns(section(), before);
  designs.recommendedBlockDesigns(section(), before);
  assert.deepEqual(before, view({ headline: 'मथळा', borderStyle: 'rule', backgroundColor: null }));
});

test('advertisements and Smart Cards keep ownership of their complete treatment', () => {
  assert.deepEqual(designs.availableBlockDesigns(section({ block_type: 'advert' }), view({ blockType: 'advert' })), []);
  assert.deepEqual(designs.availableBlockDesigns(section({ block_type: 'advertisement' }), view({ blockType: 'advertisement' })), []);
  assert.deepEqual(designs.availableBlockDesigns(section(), view({ smartCardKey: 'panchang' })), []);
});

test('small blocks never receive designs whose declared minimum cannot fit', () => {
  const tiny = designs.availableBlockDesigns(section({ width_px: 100, height_px: 70 }), view());
  assert.ok(tiny.length > 0, 'quiet edge-rule treatments remain available');
  assert.ok(tiny.every((entry) => entry.minWidth <= 100 && entry.minHeight <= 70));
  assert.equal(tiny.some((entry) => entry.key === 'lead-reversed'), false);
});

test('recommendations follow editorial meaning instead of choosing decoration randomly', () => {
  assert.equal(designs.recommendedBlockDesigns(section(), view({ storyType: 'ANALYSIS' }))[0], 'stepped-commentary');
  assert.equal(designs.recommendedBlockDesigns(section(), view({ storyType: 'OPINION' }))[0], 'opinion-cream');
  assert.equal(designs.recommendedBlockDesigns(section(), view({ editorialPriority: 5 }))[0], 'ruled-splash');
  assert.equal(designs.recommendedBlockDesigns(section(), view({ storyType: 'DATA' }))[0], 'data-headline-rule');
  assert.equal(designs.recommendedBlockDesigns(section(), view({ storyType: 'PHOTO_FEATURE' }))[0], 'photo-display-rule');
  assert.equal(designs.recommendedBlockDesigns(section({ block_type: 'briefs' }), view({ blockType: 'briefs', storyType: 'BRIEF' }))[0], 'city-desk-tab');
});

test('accountability designs advise evidence structures but never apply one', () => {
  const investigation = designs.blockDesignPreset('investigation-file');
  assert.deepEqual(investigation.companionPanels, ['document', 'timeline']);
  assert.deepEqual(Object.keys(designs.blockDesignPatch(investigation.key)).sort(), [...designs.BLOCK_DESIGN_FIELDS].sort());
  assert.equal('insetPanels' in designs.blockDesignPatch(investigation.key), false);
});

test('matching a design compares the complete appearance, not a single colour', () => {
  const patch = designs.blockDesignPatch('sports-forest');
  assert.equal(designs.matchingBlockDesign(patch)?.key, 'sports-forest');
  assert.equal(designs.matchingBlockDesign({ ...patch, headlineStyle: 'plain' }), null);
});

test('preview markup contains only resolved catalogue values', () => {
  const entry = designs.blockDesignPreset('urgent-update');
  const html = designs.blockDesignPreviewMarkup(entry);
  assert.match(html, /block-design-preview/);
  assert.match(html, /has-top/);
  assert.match(html, /has-accent-word/);
  assert.doesNotMatch(html, /urgent-update/);
  assert.doesNotMatch(html, /undefined|null/);

  const shaped = designs.blockDesignPreviewMarkup(designs.blockDesignPreset('profile-bevel'));
  assert.match(shaped, /block-design-preview-shape/);
  assert.match(shaped, /<polygon/);
  assert.match(shaped, /clip-path:polygon/);
});

test('the real Properties panel exposes recommendations and a deliberate Apply action', () => {
  const row = section({
    headline: 'पाणी योजनेला मंजुरी', subheading: 'काम पुढील महिन्यात सुरू होणार',
    body: 'सातारा शहरातील पाणीपुरवठा योजनेच्या कामाला प्रशासनाने मंजुरी दिली आहे.',
    margin_px: 1, body_font_px: 6.4, headline_font_px: 24, subheading_font_px: 10,
  });
  const draft = view({
    ...designs.blockDesignPatch('clean-news'),
    headline: row.headline, subheading: row.subheading, body: row.body,
    marginPx: 1, bodyFontPx: 6.4, headlineFontPx: 24, subheadingFontPx: 10,
    lineHeight: 1.45, paragraphSpacingPx: 0, textAlign: 'justify',
  });
  const html = properties.propertiesPanelMarkup(row, draft, null, 'block', { id: 9, template_key: 'front' });
  assert.match(html, /Block design/);
  assert.match(html, /data-prop-design-apply/);
  assert.match(html, /स्वच्छ बातमी/);
  assert.match(html, /nothing changes until Apply/);
});

test('the inspector explains the evidence insert that completes an accountability design', () => {
  const row = section({
    headline: 'अहवालातील निष्कर्ष', body: 'अधिकृत अहवालात निष्कर्ष नोंदवण्यात आला.',
    margin_px: 1, body_font_px: 6.4, headline_font_px: 24, subheading_font_px: 10,
  });
  const draft = view({ ...designs.blockDesignPatch('investigation-file'), headline: row.headline, body: row.body, bodyFontPx: 6.4 });
  const html = properties.propertiesPanelMarkup(row, draft, null, 'block', null);
  assert.match(html, /Works with:/);
  assert.match(html, /Document excerpt/);
  assert.match(html, /Timeline/);
});

test('the Properties panel offers no foreign skin over a Smart Card', () => {
  const row = section({ smart_card_key: 'panchang' });
  const html = properties.propertiesPanelMarkup(row, view({ smartCardKey: 'panchang' }), null, 'block', null);
  assert.match(html, /Design presets stay off advertisements and Smart Cards/);
  assert.doesNotMatch(html, /data-prop-design-apply/);
});

test('every new treatment and editorial insert is reachable from the real Properties panel', () => {
  const row = section({ headline: 'मथळा', body: 'बातमी', body_font_px: 6.4 });
  const draft = view({ headline: row.headline, body: row.body, bodyFontPx: 6.4 });
  const html = properties.propertiesPanelMarkup(row, draft, null, 'block', null);
  for (const key of ['headline-rule', 'accent-rule', 'display-rule', 'kicker-tab', 'kicker-tab-rule', 'stepped-lines',
    'headline-rule-short', 'headline-rule-center', 'headline-rule-heavy', 'display-rule-double', 'kicker-rail']) {
    assert.match(html, new RegExp(`data-headline-style="${key}"`), `${key} is not reachable`);
  }
  for (const key of ['key-number', 'explainer', 'timeline', 'qa', 'reaction', 'related', 'follow-up', 'comparison', 'document']) {
    assert.match(html, new RegExp(`data-panel-add="${key}"`), `${key} is not reachable`);
  }
  for (const key of ['frame-open-bottom', 'frame-open-top', 'frame-open-right', 'frame-open-left',
    'corner-top-left', 'corner-top-right', 'corner-bottom-left', 'corner-bottom-right',
    'rule-triple', 'rule-above-triple', 'box-triple']) {
    assert.match(html, new RegExp(`data-border="${key}"`), `${key} is not reachable`);
  }
  for (const key of ['bevel-top', 'bevel-bottom', 'bevel-left', 'bevel-right']) {
    assert.match(html, new RegExp(`data-shape="${key}"`), `${key} is not reachable`);
  }
  assert.doesNotMatch(html, /data-panel-add="(?:chart|table)"/, 'structured card editors remain the only way to make chart/table data');
});
