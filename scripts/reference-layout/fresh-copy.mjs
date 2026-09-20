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
  // ESTIMATES, and they have to be labelled as such. The body figure is found
  // by bisection over copy assembled in whole SENTENCES, so its resolution is
  // one sentence, not one character; and a character count is the wrong unit
  // for Marathi anyway - the same block holds 30-46% more or fewer characters
  // depending only on how conjunct-heavy the words are (CLAUDE.md, "The
  // character budget is a range"). Use them to size a brief, never as a
  // promise: what decides is the compositor, after the words exist.
  console.log(`CONTENT REQUIREMENTS - ESTIMATES, to about one sentence:`);
  console.log(`  body: about ${lo} characters (the calibration copy is ${referenceChars})`);
  console.log(`  headline: ${designHeadLines} line(s) at its locked size - pool headlines up to about ${Math.max(...headOk.map((h) => h.length), 0)} characters kept it`);
  console.log(`  deck: ${designDeckLines} line(s) - pool decks up to about ${Math.max(...deckOk.map((d) => d.length), 0)} characters kept it`);
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
    console.log(`  panel ${panel.id}: ${panel.lines.length} entr${panel.lines.length === 1 ? 'y' : 'ies'}, about ${Math.round(own * a)} characters (calibration ${own})`);
  });
  console.log('');
}
capacity();

// EVERY COMBINATION SEPARATELY, because a package fails in combinations. A
// long headline with a short body and a short headline with a long deck put
// pressure on different parts of the design, and a package that holds
// "typical" copy can still break on either - the display band and the body
// share one block, so what one takes the other loses.
//
// `expect` says what the variant is FOR, because the two are different
// questions. A variant of ordinary length must fit completely - if it does
// not, the design has no room for anything but the words it was measured
// from. A deliberately over-long one must OVERSET and say so: overflow is the
// correct answer there, and the fault would be absorbing it silently by
// re-fitting locked type. Marking them all "must fit" would condemn a design
// for doing the right thing; marking them all "must report" would let a
// design that fits nothing at all pass.
const mid = (list) => list[Math.floor(list.length / 2)];
const VARIANTS = {
  short: { expect: 'fits', headline: heads[0], subheading: decks[0], body: bodyOf(referenceChars * 0.55), panelShare: 0.6 },
  typical: { expect: 'fits', headline: mid(heads), subheading: mid(decks), body: bodyOf(referenceChars, 3), panelShare: 1 },
  long: { expect: 'reports', headline: heads[heads.length - 1], subheading: decks[decks.length - 1], body: bodyOf(referenceChars * 1.35, 7), panelShare: 1.4 },
  'long head, short body': { expect: 'fits', headline: heads[heads.length - 1], subheading: mid(decks), body: bodyOf(referenceChars * 0.5, 11), panelShare: 1 },
  'short head, long deck': { expect: 'fits', headline: heads[0], subheading: decks[decks.length - 1], body: bodyOf(referenceChars, 13), panelShare: 1 },
  'no deck': { expect: 'fits', headline: mid(heads), subheading: '', body: bodyOf(referenceChars, 17), panelShare: 1 },
  'long sidebar': { expect: 'reports', headline: mid(heads), subheading: mid(decks), body: bodyOf(referenceChars, 19), panelShare: 1.8 },
};

// WHAT "IT HOLDS" MEANS, and it is not a line count. A clipped headline can
// set an acceptable number of lines, so counting them proves nothing; and a
// design that survives by having its locked type quietly re-fitted is not the
// design that was measured. Five conditions, each one failable on its own:
//
//   1. every character given to the block is SET - body, display and panels;
//   2. nothing display oversets;
//   3. a locked size is still the size it was locked at;
//   4. every panel is inside the block and clear of its neighbours;
//   5. the body does not overset.
//
// Anything that fails is REPORTED for an editorial decision - cut it, carry it
// over, choose another picture - and never repaired by shrinking the type.
const LOCKED = {
  headline: { locked: section.headline_locked, px: Number(section.headline_font_px) || 0, band: 'headline' },
  deck: { locked: section.subheading_locked, px: Number(section.subheading_font_px) || 0, band: 'deck' },
};

function displayOverset(composition) {
  const leftover = composition?.overset || {};
  if (String(leftover.headline || '') || String(leftover.deck || '') || String(leftover.kicker || '')) return true;
  return (composition?.violations || []).some((v) => /^(HEADLINE|DECK|KICKER)_/.test(v.code || ''));
}

function lockedSizeFaults(composition) {
  return Object.entries(LOCKED).flatMap(([role, { locked, px, band }]) => {
    if (!locked || !px) return [];
    const set = composition?.bands?.[band]?.lines?.[0]?.fontPx;
    if (set === undefined || Math.abs(set - px) < 0.05) return [];
    return [`the ${role} is locked at ${px}px and set at ${set}px`];
  });
}

// A panel must be where it was put: inside the block, and not over another
// panel. panelOf() clamps a panel into its frame, so a rectangle that comes
// back changed is one the design could not honour at this size.
function placementFaults(placed, notes) {
  const faults = [];
  const width = Number(section.width_px) || 0;
  const height = Number(section.height_px) || 0;
  placed.forEach((panel, i) => {
    if (panel.x < -0.01 || panel.y < -0.01 || panel.x + panel.width > width + 0.01 || panel.y + panel.height > height + 0.01) {
      faults.push(`${panel.id || `panel ${i}`} is outside the block`);
    }
    placed.slice(i + 1).forEach((other) => {
      const clear = panel.x + panel.width <= other.x + 0.01 || other.x + other.width <= panel.x + 0.01
        || panel.y + panel.height <= other.y + 0.01 || other.y + other.height <= panel.y + 0.01;
      if (clear) return;
      // TWO BOXES OF WORDS ON TOP OF EACH OTHER is always wrong. An overlap
      // with an ORNAMENT is not the same thing: a separator is a rule with air
      // round it, its band is furniture rather than copy, and the measured
      // page's foot rule shares two pixels with the sidebars above it because
      // the two rectangles were read off the scan independently. Reported, so
      // it can be looked at, but it does not condemn the design.
      const furniture = panel.kind === 'ornament' || other.kind === 'ornament';
      const note = `${panel.id || `panel ${i}`} overlaps ${other.id || 'another panel'}`;
      if (furniture) notes.push(`${note} (a separator's band, not copy)`);
      else faults.push(note);
    });
  });
  return faults;
}

console.log(`${KEY}: reference body ${referenceChars} characters; ${panels.length} panels; topic ${TOPIC}`);
console.log('A variant PASSES only when every character is set, nothing oversets,');
console.log('every locked size is untouched and every panel is legally placed.\n');

let failed = 0;
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

  const faults = [];
  const notes = [];
  const reported = [];
  if (over > 0) (v.expect === 'reports' ? reported : faults).push(`the body oversets by ${over} characters`);
  if (displayOverset(c)) (v.expect === 'reports' ? reported : faults).push('display type oversets');
  // Never conditional: a locked size that moved, or a panel outside its block,
  // is a fault whatever the copy was doing.
  faults.push(...lockedSizeFaults(c));
  faults.push(...placementFaults(insetPanels, notes));

  console.log(`[${name}] headline ${v.headline.length} ch -> ${lines} line(s) at ${px}px; deck ${v.subheading.length} ch -> ${c.bands?.deck?.lines?.length || 0} line(s)`);
  console.log(`  body ${v.body.length} ch: ${over > 0 ? `OVERSET by ${over} characters - for the desk: cut them, or carry the story over (never shrink the type)` : 'all set'}; ${Math.round((fill.fillRatio ?? fill.ratio ?? 0) * 100)}% of the body's lines set`);
  for (const p of insetPanels) {
    if (!isCopy(p)) continue;
    // The panel compositor's own report, not a character count taken from
    // outside it: it names what it dropped and from which entry.
    const solved = panelLayout(p, Number(section.body_font_px) || 6.4, measure);
    const room = p.height - solved.usedHeight;
    if (solved.overflow) {
      (v.expect === 'reports' ? reported : faults).push(`${p.id || 'a panel'} drops ${solved.overflow.chars} characters`);
      console.log(`  panel ${p.id}: DROPS ${solved.overflow.chars} characters at its foot - "${solved.overflow.text.slice(0, 50)}"`);
    } else {
      console.log(`  panel ${p.id}: holds its copy, ${room.toFixed(1)}px spare`);
    }
  }
  if (warnings.length) console.log(`  engine: ${[...new Set(warnings)].join(', ')}`);
  for (const note of notes) console.log(`  note: ${note}`);
  if (faults.length) {
    failed += 1;
    console.log(`  FAILS: ${faults.join('; ')}`);
  } else if (v.expect === 'reports') {
    console.log(reported.length
      ? `  PASSES: too long on purpose, and REPORTED rather than absorbed - ${reported.join('; ')}`
      : '  PASSES: it all fitted, which is a bonus - locked sizes held, panels legal');
  } else {
    console.log('  PASSES: every character set, nothing overset, locked sizes held, panels legal');
  }
  console.log('');
}

console.log(failed
  ? `${failed} of ${Object.keys(VARIANTS).length} variants fail. The design does not yet hold other news - see each FAILS line.`
  : `All ${Object.keys(VARIANTS).length} variants hold. The design is reusable with other news.`);
process.exit(failed ? 1 : 0);
