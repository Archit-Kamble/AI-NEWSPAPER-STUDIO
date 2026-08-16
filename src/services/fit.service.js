// Making a story fit its block.
//
// Copy never arrives the right length. A sub-editor's whole craft is closing
// the gap between what was filed and what the hole holds, and there are exactly
// three moves: cut the copy, set it a notch tighter, or carry the rest onto
// another page. The third already exists (jump.service.js). This is the second,
// and it reports precisely enough for the first.
//
// The software already knows every number involved - it measures the block on
// every keystroke - and yet, when a story overset, all it said was "629
// characters more than this block holds". True, and useless: the desk then
// guesses at type sizes until the warning goes away.
//
// So: try the smallest typographic change that makes it fit, and refuse to go
// past what is legible in print. That floor is not a matter of taste. Newsprint
// at 6.5 pt is the bottom of what an ordinary reader can read, which at this
// system's 2 px per mm is about 4.6 px of body type; preflight already fails a
// page that goes under it. Type is stepped down half a pixel at a time, body
// first because a headline set smaller than its story reads as a mistake.
//
// If nothing legal makes it fit, that is the honest answer: this copy is too
// long for this hole. Cut this many characters, or carry it over.

const pool = require('../config/db');
const sectionImageRepository = require('../repositories/sectionImage.repository');

// MIN_BODY_PX is imported from compose.js (see ensureComposeReady() below),
// not redeclared here - it used to be, at the same 4.6 value, and compose.js
// separately hard-coded its OWN floor at a literal 6.5 (a units bug: 6.5 is
// the PT limit, not the logical-px one - see MIN_LEGIBLE_PX's own comment).
// Every composeAt() call below with a candidate size under 6.5 was therefore
// silently re-clamped UP to 6.5 inside compose.js, so this shrink loop's own
// "does 5.0px fit?" question was actually being answered by a block composed
// at 6.5px - a different question, and the reason this is imported now
// rather than merely kept equal by two people remembering to.
let MIN_BODY_PX = 4.6;
const MIN_HEADLINE_PX = 12;
const STEP_PX = 0.5;

// The exact composition engine - the same module composeSection() the page
// canvas, the Block Editor and preflight's own overset check all measure
// against (see preflight.service.js). "Would this fit?" and "does this fit?"
// have to be the same question asked twice, or a proposal fit approves can
// still fail preflight - which was possible while this measured through
// text-flow.js's approximate character grid and preflight measured through
// the same grid's OWN separate call, close enough in the common case to go
// unnoticed and exactly the kind of two-numbers-that-should-agree bug this
// engine exists to remove.
let composeModule = null;
let engineModule = null;
async function compose() {
  if (!composeModule) composeModule = await import('../../public/editor/compose/section-adapter.js');
  return composeModule;
}
let metricsModule = null;
let shaperModule = null;
async function ensureComposeReady() {
  if (!metricsModule) metricsModule = await import('../../public/editor/compose/font-metrics.js');
  if (!shaperModule) shaperModule = await import('../../public/editor/compose/shaper.js');
  if (!engineModule) engineModule = await import('../../public/editor/compose/compose.js');
  await Promise.all([metricsModule.ensureFontsLoaded(), shaperModule.ensureShaperReady()]);
  // Fit decides real type sizes for print. A block fitted against summed
  // hmtx advances because the shaper silently failed to load is a fit for a
  // page that will not print the way this said it does - loud failure here,
  // not a quiet downgrade.
  shaperModule.requireShaperReady();
  MIN_BODY_PX = engineModule.MIN_LEGIBLE_PX;
}

// Composes the block's REAL, already-written copy at a candidate type size
// and reports whether it actually fits - not an estimate compared against a
// character count, but the same pour that will print, run again at this size.
function composeAt(adapter, section, overrides = {}) {
  return adapter.composeSection(section, overrides);
}

/**
 * Work out what would make this block's copy fit, and optionally do it.
 *
 * `apply: false` answers the question without touching the block, which is what
 * the editor asks before offering the action - a desk should see what will
 * happen before it happens.
 */
async function fitSection(pageId, sectionKey, { apply = false } = {}) {
  const { rows } = await pool.query(
    `SELECT s.*, p.newspaper_id
       FROM page_sections s JOIN pages p ON p.id = s.page_id
      WHERE s.page_id = $1 AND s.section_key = $2`,
    [pageId, sectionKey],
  );
  const section = rows[0];
  if (!section) return null;

  // Through the repository, not a hand-written query: the pictures have to be
  // the same ones, joined the same way, that the editor and preflight measure
  // against - a block with a photograph in it holds far less copy.
  section.images = await sectionImageRepository.listBySection(section.id);

  await ensureComposeReady();
  const adapter = await compose();
  const written = String(section.body || '').length;

  const base = composeAt(adapter, section);
  if (!adapter.bodyOverset(base)) {
    // `budget` is deliberately the SAFE floor (bodyCharRange.min - see
    // compose.js), not a hard ceiling: this story's own real word shapes can
    // genuinely pack more than that and still fit, which the exact pour
    // above just confirmed. Saying "holds N" as if N were a limit this text
    // exceeded would read as a contradiction on the exact cases where the
    // safe estimate is at its most conservative.
    const budget = base.capacity.bodyCharRange.min;
    return {
      sectionKey, fits: true, applied: false, written, budget,
      message: `${written} characters are written and it fits. (This block's guaranteed-safe capacity is at least ${budget}.)`,
    };
  }

  const startBody = Number(section.body_font_px);
  const startHeadline = Number(section.headline_font_px);
  const round = (value) => Math.round(value * 10) / 10;

  // The body comes down first, on its own, half a pixel at a time. A headline
  // is the page's hierarchy - it says which story is the lead - and shrinking
  // it to buy room for the body inverts that: the first version of this took a
  // 34px lead headline down to 15px, which reads as a different story
  // altogether. So the headline is only touched if the body alone cannot do it,
  // and then by a quarter of its size at most.
  //
  // The grid is re-measured at each step rather than extrapolated: a block with
  // a picture in it does not trade type size for capacity in a straight line.
  const headlineFloor = Math.max(MIN_HEADLINE_PX, Math.floor(startHeadline * 0.75));

  for (const headlinePx of [startHeadline, ...(headlineFloor < startHeadline ? [headlineFloor] : [])]) {
    for (let bodyPx = startBody - STEP_PX; bodyPx >= MIN_BODY_PX; bodyPx -= STEP_PX) {
      // The real body text, poured at this candidate size - exact, not a
      // count compared against an estimate. A range-based capacity number
      // would have to guess whether THIS story's actual word shapes pack
      // efficiently or not; composing it removes the guess entirely.
      const attempt = composeAt(adapter, section, { bodyFontPx: bodyPx, headlineFontPx: headlinePx });
      if (adapter.bodyOverset(attempt)) continue;
      const candidate = attempt.capacity.bodyCharRange.min;

      if (apply) {
        await pool.query(
          `UPDATE page_sections
              SET body_font_px = $2, headline_font_px = $3, updated_at = CURRENT_TIMESTAMP
            WHERE id = $1`,
          [section.id, round(bodyPx), headlinePx],
        );
      }
      const headlineNote = headlinePx === startHeadline
        ? ''
        : ` and the headline from ${startHeadline}px to ${headlinePx}px`;
      return {
        sectionKey,
        fits: true,
        applied: apply,
        written,
        budget: candidate,
        from: { bodyFontPx: startBody, headlineFontPx: startHeadline },
        to: { bodyFontPx: round(bodyPx), headlineFontPx: headlinePx },
        message: apply
          ? `Set tighter — body ${startBody}px to ${round(bodyPx)}px${headlineNote} — and it fits.`
          : `Setting the body from ${startBody}px to ${round(bodyPx)}px${headlineNote} would make it fit.`,
      };
    }
  }

  // Nothing legal fits it. Say by how much, in the units a sub-editor cuts in -
  // the real leftover text at the smallest legal size, not a subtraction
  // against the safe-range estimate (which would either over- or
  // under-quote the cut depending on this story's own word shapes).
  const floor = composeAt(adapter, section, { bodyFontPx: MIN_BODY_PX, headlineFontPx: headlineFloor });
  const floorBudget = floor.capacity.bodyCharRange.min;
  const exact = adapter.bodyOversetChars(floor);
  const cut = exact > 0 ? exact : Math.max(0, written - floorBudget);
  return {
    sectionKey,
    fits: false,
    applied: false,
    written,
    budget: floorBudget,
    cut,
    message:
      `Even at the smallest type that will print on newsprint this block holds ${floorBudget} characters. ` +
      `Cut about ${cut}, or carry the rest over to another page.`,
  };
}

module.exports = { fitSection, MIN_BODY_PX };
