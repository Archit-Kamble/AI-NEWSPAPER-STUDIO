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

// 6.5 pt on newsprint, in editor px. Below this the block would fail preflight,
// so offering it would be offering a page that cannot go to press.
const MIN_BODY_PX = 4.6;
const MIN_HEADLINE_PX = 12;
const STEP_PX = 0.5;

let flowModule = null;
async function textFlow() {
  if (!flowModule) flowModule = await import('../../public/editor/layout/text-flow.js');
  return flowModule;
}

function budgetFor(flow, section, overrides = {}) {
  const map = flow.buildFlowMap(
    { width_px: section.width_px, height_px: section.height_px },
    {
      marginPx: Number(section.margin_px) || 12,
      lineHeight: Number(section.line_height) || 1.25,
      headline: section.headline || '',
      headlineFontPx: overrides.headlineFontPx ?? Number(section.headline_font_px),
      subheading: section.subheading || '',
      subheadingFontPx: overrides.subheadingFontPx ?? Number(section.subheading_font_px),
      body: section.body || '',
      bodyFontPx: overrides.bodyFontPx ?? Number(section.body_font_px),
    },
    (section.images || []).map(flow.flowImageFromRow),
  );
  return map.bodyCharBudget;
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

  const flow = await textFlow();
  const written = String(section.body || '').length;
  const budget = budgetFor(flow, section);

  if (written <= budget) {
    return {
      sectionKey, fits: true, applied: false, written, budget,
      message: `This block holds ${budget} characters and ${written} are written. It fits.`,
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
      const candidate = budgetFor(flow, section, { bodyFontPx: bodyPx, headlineFontPx: headlinePx });
      if (written > candidate) continue;

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

  // Nothing legal fits it. Say by how much, in the units a sub-editor cuts in.
  const floorBudget = budgetFor(flow, section, {
    bodyFontPx: MIN_BODY_PX,
    headlineFontPx: headlineFloor,
  });
  const cut = written - floorBudget;
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
