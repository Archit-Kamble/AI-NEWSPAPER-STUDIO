// A panel measured off a printed page may state its own faces, alignment,
// leading, rules and numbered discs - and a panel that states none of them
// must lay out exactly as it always did.
const test = require('node:test');
const assert = require('node:assert/strict');
const { panelOf, panelLayout, panelEdges } = require('../public/editor/layout/inset-panels');

const measure = (text, px) => String(text).length * px * 0.5;
const frame = { width: 300, height: 300 };

test('a panel that states no typography lays out as before', () => {
  const panel = panelOf({ id: 'p', kind: 'note', x: 0, y: 0, width: 120, height: 120, title: 'शीर्षक', lines: ['एक दोन तीन', 'चार'] }, frame);
  const solved = panelLayout(panel, 6.4, measure);
  assert.equal(solved.lineHeight, 1.45);
  assert.deepEqual(solved.discs, []);
  assert.ok(solved.lines.every((line) => line.align === 0));
  assert.deepEqual(panelEdges(panel), ['top', 'right', 'bottom', 'left']);
});

test('stated faces, alignment, leading and rules are kept and used', () => {
  const panel = panelOf({
    kind: 'sidebar', x: 0, y: 0, width: 120, height: 120, title: 'शीर्षक', lines: ['ओळ'],
    titleFamily: 'rajdhani', lineFamily: 'mukta', titleAlign: 'center', lineHeight: 1.3,
    rules: ['bottom', 'nonsense'], boldLines: [0], titleGapPx: 3,
  }, frame);
  const solved = panelLayout(panel, 6.4, measure);
  const [title, line] = solved.lines;
  assert.equal(title.family, 'rajdhani');
  assert.equal(title.align, 1);
  assert.equal(line.family, 'mukta');
  assert.equal(line.bold, true);
  assert.equal(line.lineHeight, 1.3);
  assert.deepEqual(panelEdges(panel), ['bottom']);
});

test('a numbered disc stands beside its entry, and the next entry starts below it', () => {
  const panel = panelOf({ kind: 'sidebar', x: 0, y: 0, width: 100, height: 200, marker: 'circle', lines: ['क ख', 'ग'] }, frame);
  const solved = panelLayout(panel, 6.4, measure);
  assert.equal(solved.discs.length, 2);
  const [first, second] = solved.discs;
  assert.equal(first.text, '१');
  assert.ok(solved.lines[0].x > first.x + first.d - 0.01, 'the first line is set clear of its disc');
  assert.ok(second.y >= first.y + first.d, 'discs never overlap');
});

test('a face key or edge of the wrong shape is dropped', () => {
  const panel = panelOf({ kind: 'sidebar', x: 0, y: 0, width: 80, height: 80, title: 'x', titleFamily: "a;}</style>", lineInk: 'red', lineHeight: 9 }, frame);
  assert.equal(panel.titleFamily, undefined);
  assert.equal(panel.lineInk, undefined);
  assert.equal(panel.lineHeight, undefined);
});

test('a *starred* run inside an entry is set bold, and measured bold', () => {
  const panel = panelOf({ kind: 'sidebar', x: 0, y: 0, width: 300, height: 100, lines: ['*वडीगोद्री :* मराठा आरक्षणाच्या'] }, frame);
  const [line] = panelLayout(panel, 6.4, measure).lines;
  assert.equal(line.text, 'वडीगोद्री : मराठा आरक्षणाच्या');
  assert.deepEqual(line.runs, [{ text: 'वडीगोद्री :', bold: true }, { text: ' मराठा आरक्षणाच्या', bold: false }]);
  const plain = panelOf({ kind: 'sidebar', x: 0, y: 0, width: 300, height: 100, lines: ['साधी ओळ'] }, frame);
  assert.equal(panelLayout(plain, 6.4, measure).lines[0].runs, undefined);
});
