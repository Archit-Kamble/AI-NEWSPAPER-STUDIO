// DOES THE THEME SURVIVE OTHER NEWS? A measured block is composed with short,
// typical and long replacement copy - never the reference's own words - and
// the result is reported the way a desk needs it: what oversets, what is left
// short, what a panel drops at its foot, and how the headline sets.
//
//   node scripts/reference-layout/fresh-copy.mjs <editionId> <page> <blockKey> [topic]
//
// Copy comes from scripts/fixture-copy-topics.js (invented, hand-written, no
// AI call). Nothing is written to the database: every variant is composed
// from the stored row with the copy laid over it as a view, exactly as the
// canvas composes a live draft. The frames cannot move - composition never
// moves a frame - so what this tests is whether the DESIGN holds: type sizes
// stay locked, and anything that does not fit is REPORTED for an editorial
// decision, never silently shrunk or rewritten.

import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const ROOT = new URL('../../', import.meta.url).pathname;
require(`${ROOT}node_modules/dotenv`).config({ path: `${ROOT}.env` });
require(`${ROOT}public/editor/layout/typefaces.js`);
const { panelsOf, panelLayout } = require(`${ROOT}public/editor/layout/inset-panels.js`);
const metrics = await import(`${ROOT}public/editor/compose/font-metrics.js`);
const shaper = await import(`${ROOT}public/editor/compose/shaper.js`);
await Promise.all([metrics.ensureFontsLoaded(), shaper.ensureShaperReady()]);
const adapter = await import(`${ROOT}public/editor/compose/section-adapter.js`);
const pageService = require(`${ROOT}src/services/page.service.js`);
const { TOPICS } = require(`${ROOT}scripts/fixture-copy-topics.js`);

const [ED, PAGE, KEY, TOPIC = 'world'] = process.argv.slice(2);
if (!ED || !PAGE || !KEY) {
  console.error('usage: fresh-copy.mjs <editionId> <page> <blockKey> [topic]');
  process.exit(2);
}
const pool = TOPICS[TOPIC];
const measure = (text, px, family, weight) => shaper.shapeWidthPx(text, px, family, weight) ?? metrics.measureWidth(text, px, family, weight);
const byLength = (list) => [...list].sort((a, b) => a.length - b.length);

// Sentences cycled from the pool until the copy reaches `chars`, paragraphed
// every three sentences, as a reporter files it.
function bodyOf(chars, offset = 0) {
  const out = [];
  let n = 0;
  for (let i = offset; n < chars; i += 1) {
    const s = pool.sentences[i % pool.sentences.length];
    out.push(s);
    n += s.length + 1;
  }
  const paragraphs = [];
  for (let i = 0; i < out.length; i += 3) paragraphs.push(out.slice(i, i + 3).join(' '));
  return paragraphs.join('\n\n');
}

const pages = await pageService.listPages(Number(ED));
const section = pages.find((p) => p.page_number === Number(PAGE)).sections.find((s) => s.section_key === KEY);
const referenceChars = String(section.body || '').length;
const heads = byLength(pool.headlines);
const decks = byLength(pool.decks);
const panels = panelsOf(section);

// A panel carrying COPY - a byline or a cell of a table is furniture and keeps
// its own words. Replacement copy keeps the panel's entry count, so a numbered
// sidebar still has as many numbered points.
const isCopy = (panel) => panel.kind !== 'ornament' && panel.lines.join(' ').length >= 40;
function replaced(panel, i, share) {
  return {
    ...panel,
    title: panel.title ? heads[(i * 3) % heads.length] : panel.title,
    lines: panel.lines.map((line, e) => bodyOf(line.length * share, i * 5 + e * 2).replace(/\n+/g, ' ')),
  };
}

// WHAT THE THEME ASKS OF ITS COPY, derived from the compositor rather than
// stated: the body's capacity (the most pool copy that sets without overset),
// the longest pool headline and deck that keep the lines this design gives
// them, and each panel's capacity at its own entry count.
function capacity() {
  const fits = (chars) => adapter.bodyOversetChars(adapter.composeSection(section, { body: bodyOf(chars) })) === 0;
  let lo = 0; let hi = referenceChars * 3;
  while (hi - lo > 20) { const mid = Math.round((lo + hi) / 2); if (fits(mid)) lo = mid; else hi = mid; }
  const designHeadLines = adapter.composeSection(section, {}).bands?.headline?.lines?.length || 0;
  const designDeckLines = adapter.composeSection(section, {}).bands?.deck?.lines?.length || 0;
  const headOk = heads.filter((h) => (adapter.composeSection(section, { headline: h }).bands?.headline?.lines?.length || 0) <= designHeadLines);
  const deckOk = decks.filter((d) => (adapter.composeSection(section, { subheading: d }).bands?.deck?.lines?.length || 0) <= designDeckLines);
  console.log(`CONTENT REQUIREMENTS (the design as measured):`);
  console.log(`  body: up to ~${lo} characters (the calibration copy is ${referenceChars})`);
  console.log(`  headline: ${designHeadLines} line(s) at its locked size - pool headlines up to ${Math.max(...headOk.map((h) => h.length), 0)} characters keep it`);
  console.log(`  deck: ${designDeckLines} line(s) - pool decks up to ${Math.max(...deckOk.map((d) => d.length), 0)} characters keep it`);
  panels.forEach((panel, i) => {
    if (!isCopy(panel)) return;
    let a = 0.2; let b = 3;
    const holds = (share) => {
      const p = replaced(panel, i, share);
      const solved = panelLayout(p, Number(section.body_font_px) || 6.4, measure);
      const want = [p.title, ...p.lines].filter(Boolean).join('').replace(/\s/g, '').length;
      return solved.lines.map((l) => l.text).join('').replace(/\s/g, '').length >= want;
    };
    while (b - a > 0.02) { const m = (a + b) / 2; if (holds(m)) a = m; else b = m; }
    const own = panel.lines.join(' ').length;
    console.log(`  panel ${panel.id}: ${panel.lines.length} entr${panel.lines.length === 1 ? 'y' : 'ies'}, up to ~${Math.round(own * a)} characters (calibration ${own})`);
  });
  console.log('');
}
capacity();

const VARIANTS = {
  short: { headline: heads[0], subheading: decks[0], body: bodyOf(referenceChars * 0.55), panelShare: 0.6 },
  typical: { headline: heads[Math.floor(heads.length / 2)], subheading: decks[Math.floor(decks.length / 2)], body: bodyOf(referenceChars, 3), panelShare: 1 },
  long: { headline: heads[heads.length - 1], subheading: decks[decks.length - 1], body: bodyOf(referenceChars * 1.35, 7), panelShare: 1.4 },
};

console.log(`${KEY}: reference body ${referenceChars} characters; ${panels.length} panels; topic ${TOPIC}\n`);
for (const [name, v] of Object.entries(VARIANTS)) {
  // Every text panel gets pool sentences of the same share of its own copy.
  const insetPanels = panels.map((panel, i) => (isCopy(panel) ? replaced(panel, i, v.panelShare) : panel));
  const view = { headline: v.headline, subheading: v.subheading, body: v.body, insetPanels };
  const c = adapter.composeSection(section, view);
  const fill = adapter.bodyFill(c);
  const over = adapter.bodyOversetChars(c);
  const head = c.bands?.headline;
  const lines = head?.lines?.length || 0;
  const px = head?.lines?.[0]?.fontPx;
  const warnings = [...(c.violations || []), ...(c.warnings || [])].map((w) => w.code).filter(Boolean);
  console.log(`[${name}] headline ${v.headline.length} ch -> ${lines} line(s) at ${px}px; deck ${v.subheading.length} ch -> ${c.bands?.deck?.lines?.length || 0} line(s)`);
  console.log(`  body ${v.body.length} ch: ${over > 0 ? `OVERSET by ${over} characters - for the desk: cut them, or carry the story over (never shrink the type)` : 'all set'}; ${Math.round((fill.fillRatio ?? fill.ratio ?? 0) * 100)}% of the body's lines set`);
  for (const p of insetPanels) {
    if (!isCopy(p)) continue;
    const solved = panelLayout(p, Number(section.body_font_px) || 6.4, measure);
    const want = [p.title, ...p.lines].filter(Boolean).join(' ').replace(/\s/g, '').length;
    const got = solved.lines.map((l) => l.text).join('').replace(/\s/g, '').length;
    const room = p.height - solved.usedHeight;
    console.log(`  panel ${p.id}: ${got < want ? `DROPS ${want - got} characters at its foot` : `holds its copy, ${room.toFixed(1)}px spare`}`);
  }
  if (warnings.length) console.log(`  engine: ${[...new Set(warnings)].join(', ')}`);
  console.log('');
}
process.exit(0);
