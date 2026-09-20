// FIRST DIVERGENCE: where a block's line breaks first part company with the
// reference's, and why.
//
//   node scripts/reference-layout/divergence.mjs <editionId> <page> <reference-lines.js>
//
// The reference-lines file is local calibration (it carries the reference
// paper's own words, so it is never committed). It exports, per block key:
//   { body: [[...lines of column 1], [...column 2]], panels: { <index>: [...lines] } }
// with every line as printed, title lines included for a panel.
//
// Our lines come from the real compositor (composeSection) and the real panel
// layout (panelLayout with the shaper), read off the stored rows exactly as
// the canvas composes them - never a re-implementation.
//
// At the first line that differs it prints the reference's line SHAPED in our
// face at our size against our measure, which tells the two causes apart:
//   ref line wider than our measure -> our face or size sets wider than theirs
//   ref line fits our measure       -> our breaker chose to break elsewhere
// Fix the earliest divergence first: one displaced word moves every line after.

import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const ROOT = new URL('../../', import.meta.url).pathname;
require(`${ROOT}node_modules/dotenv`).config({ path: `${ROOT}.env` });
require(`${ROOT}public/editor/layout/typefaces.js`);
const { panelsOf, panelLayout } = require(`${ROOT}public/editor/layout/inset-panels.js`);
const metrics = await import(`${ROOT}public/editor/compose/font-metrics.js`);
const shaper = await import(`${ROOT}public/editor/compose/shaper.js`);
await Promise.all([metrics.ensureFontsLoaded(), shaper.ensureShaperReady()]);
const { composeSection } = await import(`${ROOT}public/editor/compose/section-adapter.js`);
const pageService = require(`${ROOT}src/services/page.service.js`);

const [ED, PAGE, FILE] = process.argv.slice(2);
if (!ED || !PAGE || !FILE) {
  console.error('usage: divergence.mjs <editionId> <page> <reference-lines.js>');
  process.exit(2);
}
const reference = require(new URL(FILE, `file://${process.cwd()}/`).pathname);
const measure = (text, px, family, weight) => shaper.shapeWidthPx(text, px, family, weight) ?? metrics.measureWidth(text, px, family, weight);
const norm = (s) => String(s).replace(/\*/g, '').replace(/\s+/g, ' ').trim();

function report(label, refLines, ours) {
  const n = Math.max(refLines.length, ours.length);
  for (let i = 0; i < n; i += 1) {
    const r = refLines[i] === undefined ? undefined : norm(refLines[i]);
    const o = ours[i] ? norm(ours[i].text) : undefined;
    if (r === o) continue;
    console.log(`\n${label}: first divergence at line ${i + 1} of ${refLines.length} (ours sets ${ours.length})`);
    console.log(`  reference: ${r ?? '(none)'}`);
    console.log(`  ours     : ${o ?? '(none)'}`);
    const line = ours[i] || ours[ours.length - 1];
    if (r !== undefined && line) {
      const w = measure(r, line.fontPx, line.family, line.weight);
      const room = line.measure;
      console.log(`  reference line shaped in ours: ${w.toFixed(2)} px against our measure ${room.toFixed(2)} px (${line.family} ${line.weight} ${line.fontPx}px) -> ${
        w > room + 0.01 ? 'OUR FACE/SIZE SETS WIDER' : 'IT FITS: our breaker broke elsewhere'}`);
    }
    return;
  }
  console.log(`${label}: all ${refLines.length} lines agree`);
}

// THE MEASURE BRACKET. A reference set GREEDILY at measure M obeys, for every
// line that does not end its paragraph: the line fits M, and the line plus the
// next word does not. Each such pair brackets M; `scale` stands for setting our
// face that much larger or smaller. Swept over a small bounded range, the count
// of satisfied constraints says whether ANY single size reproduces the
// reference's breaks - and if none does, the faces' relative widths differ and
// the remaining divergence is the face, not a setting.
function bracket(label, refLines, paragraphs, style, roomOf) {
  const room = typeof roomOf === 'function' ? null : roomOf;
  const roomAt = (i, j) => (room === null ? roomOf(i, j) : room);
  const flat = (s) => norm(s).replace(/\s/g, '');
  const ends = new Set();
  const entryOf = [];
  let acc = '';
  let p = 0;
  refLines.forEach((line, i) => {
    acc += flat(line);
    entryOf[i] = p;
    if (p < paragraphs.length && acc === flat(paragraphs[p])) { ends.add(i); acc = ''; p += 1; }
  });
  style.entryOf = entryOf;
  const pairs = [];
  let j = 0; // the line's index within its own paragraph
  const weightAt = (i) => (style.weightOf ? style.weightOf(i) : style.weight);
  refLines.forEach((line, i) => {
    const w = measure(norm(line), style.fontPx, style.family, weightAt(i));
    const r = roomAt(i, j);
    j = ends.has(i) ? 0 : j + 1;
    if (ends.has(i) || i === refLines.length - 1) { pairs.push({ lo: w, hi: Infinity, r }); return; }
    const next = norm(refLines[i + 1]).split(' ')[0];
    const joined = norm(line).endsWith('-') ? `${norm(line)}${next}` : `${norm(line)} ${next}`;
    pairs.push({ lo: w, hi: measure(joined, style.fontPx, style.family, weightAt(i)), r });
  });
  let best = null;
  for (let s = 0.88; s <= 1.1201; s += 0.005) {
    const ok = pairs.filter(({ lo, hi, r }) => lo * s <= r && hi * s > r).length;
    if (!best || ok > best.ok) best = { ok, from: s, to: s };
    else if (ok === best.ok && Math.abs(s - best.to - 0.005) < 1e-9) best.to = s;
  }
  const atOne = pairs.filter(({ lo, hi, r }) => lo <= r && hi > r).length;
  console.log(`  bracket: at our size ${atOne}/${pairs.length} reference breaks are greedy-consistent; best ${best.ok}/${pairs.length} at scale ${best.from.toFixed(3)}-${best.to.toFixed(3)}`
    + (paragraphs.length && ends.size < paragraphs.length ? `  (matched ${ends.size}/${paragraphs.length} paragraph ends)` : ''));
}

const pages = await pageService.listPages(Number(ED));
const page = pages.find((p) => p.page_number === Number(PAGE));
for (const [key, ref] of Object.entries(reference)) {
  const section = page.sections.find((s) => s.section_key === key);
  if (!section) { console.log(`${key}: no such block`); continue; }
  if (ref.body) {
    const composition = composeSection(section, {});
    // Lines are grouped into columns by where they START, within half a
    // column: a paragraph's indented first line is still in its column.
    const byX = [...composition.bodyLines].sort((a, b) => a.x - b.x);
    const groups = [];
    for (const line of byX) {
      const last = groups[groups.length - 1];
      if (!last || line.x - last.x0 > line.measure / 2) groups.push({ x0: line.x, lines: [] });
      groups[groups.length - 1].lines.push({ text: line.text, fontPx: line.fontPx, family: line.family, weight: line.weight, measure: line.measure, y: line.y });
    }
    const ordered = groups.map((g) => g.lines.sort((a, b) => a.y - b.y));
    const paragraphs = composition.bodyPlainText
      ? composition.bodyPlainText.split(/\n+/)
      : String(section.body || '').split(/\n+/);
    ref.body.forEach((lines, c) => {
      const ours = ordered[c] || [];
      report(`${key} body column ${c + 1}`, lines, ours);
      if (ours[0]) bracket(key, lines, paragraphs, { fontPx: ours[0].fontPx, family: ours[0].family, weight: ours[0].weight }, ours[0].measure);
    });
  }
  if (ref.panels) {
    const panels = panelsOf(section);
    for (const [index, lines] of Object.entries(ref.panels)) {
      const panel = panels[Number(index)];
      if (!panel) { console.log(`${key} panel ${index}: none`); continue; }
      const solved = panelLayout(panel, Number(section.body_font_px) || 6.4, measure);
      const ours = solved.lines.map((l) => ({ text: l.text, fontPx: l.fontPx, family: l.family || panel.lineFamily || 'sans', weight: l.bold ? 700 : 400, measure: l.width }));
      report(`${key} panel ${index} (${panel.kind})`, lines, ours);
      // Title lines are a different face and size, so the bracket is taken over
      // the entries alone - the reference lines after the title's.
      const titleCount = solved.lines.filter((l) => l.role === 'title').length;
      const body = ours.find((l, i) => solved.lines[i].role !== 'title');
      if (body) {
        // Beside a numbered disc a line is set short of it: the disc is as deep
        // as the lines it stands beside, so line j of an entry is indented while
        // it starts inside the disc's depth.
        const full = panel.width - solved.inset * 2;
        const disc = solved.discs && solved.discs[0];
        const pitch = body.fontPx * solved.lineHeight;
        const roomOf = disc
          ? (i, j) => full - (j * pitch < disc.d - 0.5 ? disc.d + body.fontPx * 0.35 : 0)
          : full;
        const bold = new Set(panel.boldLines || []);
        const entries = panel.lines;
        const style = { fontPx: body.fontPx, family: body.family, weight: 400 };
        style.weightOf = (i) => (panel.lineBold || bold.has(style.entryOf?.[i]) ? 700 : 400);
        bracket(key, lines.slice(titleCount), entries, style, roomOf);
        // COPY THAT NEVER REACHED THE PAGE. The layout drops what its box cannot
        // hold, silently; a line count cannot see that, the text can.
        const want = [panel.title, ...entries].filter(Boolean).map(norm).join(' ').replace(/\s/g, '');
        const got = solved.lines.map((l) => norm(l.text)).join(' ').replace(/\s/g, '');
        if (got.length < want.length) console.log(`  DROPPED at the foot: "${norm([panel.title, ...entries].filter(Boolean).join(' ')).slice(-(want.length - got.length) - 6)}"`);
        if (process.env.FACES) {
          for (const face of process.env.FACES.split(',')) {
            const [family, weight] = face.split('/');
            const regIdx = lines.slice(titleCount).map((_, i) => i).filter((i) => !bold.has(style.entryOf[i]));
            const sub = regIdx.map((i) => lines.slice(titleCount)[i]);
            process.stdout.write(`    regular face ${face}:`);
            bracket(key, sub, entries.filter((_, e) => !bold.has(e)), { fontPx: body.fontPx, family, weight: Number(weight) },
              roomOf === full ? full : (i, j) => roomOf(i, j));
          }
        }
        if (process.env.FACES && bold.size) {
          // Which bold face reproduces the reference's bold breaks? Same
          // bracket, the bold entries only, one face at a time.
          for (const face of process.env.FACES.split(',')) {
            const [family, weight] = face.split('/');
            const boldIdx = lines.slice(titleCount).map((_, i) => i).filter((i) => bold.has(style.entryOf[i]));
            const sub = boldIdx.map((i) => lines.slice(titleCount)[i]);
            const fs = { fontPx: body.fontPx, family, weight: Number(weight) };
            process.stdout.write(`    bold face ${face}:`);
            bracket(key, sub, entries.filter((_, e) => bold.has(e)), fs, (i) => roomOf === full ? full : roomOf(0, 9));
          }
        }
      }
    }
  }
}
process.exit(0);
