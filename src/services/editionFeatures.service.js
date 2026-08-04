// Filling an edition's standing features.
//
// One action, one pass over the edition, and - for everything a model writes -
// one call. The desk presses "Fill today's features" and the horoscope, the
// almanac box, दिनविशेष and the thought for the day are set for that edition's
// date, in the blocks the layout marked for them.
//
// What lands in the block is ordinary copy in the ordinary fields. That is the
// whole trick: a feature is measured by the same character grid, edited in the
// same editor, saved by the same endpoint and printed by the same renderer as a
// news story. Nothing downstream needs to know where the words came from.
//
// And it stays editable. VISION.md: AI assists, never owns. A sub-editor who
// does not like Tuesday's Scorpio can rewrite it, and nothing overwrites that
// unless they ask for the features to be filled again.

const pool = require('../config/db');
const features = require('../features');

// The character grid, loaded from the one module that defines it.
//
// It lives in public/editor/layout/text-flow.js because the browser needs it on
// every keystroke. The server needs the same numbers to brief the model, and a
// second copy here is precisely the drift CLAUDE.md records: two measurements
// of the same block that quietly disagree. Node imports the ES module directly
// - it has no imports of its own - so there is still exactly one.
let flowModule = null;
async function textFlow() {
  if (!flowModule) flowModule = await import('../../public/editor/layout/text-flow.js');
  return flowModule;
}

// A feature result becomes a headline and a body. Label-and-text items - the
// twelve signs, the almanac's five lines - are set one to a line, because that
// is how they are read: down a narrow box, not across a paragraph.
function toCopy(result) {
  const items = result.items || [];
  const lines = items.map((item) => {
    const head = item.label ? `${item.label} : ` : '';
    const tail = item.note ? ` (${item.note})` : '';
    return `${head}${item.text}${tail}`;
  });
  return {
    headline: result.title || '',
    subheading: result.subtitle || '',
    body: lines.join('\n'),
  };
}

/**
 * Fills every block on the edition that the layout marked as a feature.
 *
 * Returns what was filled and what was not, with the reason - a box that could
 * not be filled is reported, never quietly left looking finished.
 */
async function fillEdition(newspaperId, { tier } = {}) {
  const { rows: papers } = await pool.query(
    'SELECT id, publication_date FROM newspapers WHERE id = $1',
    [newspaperId],
  );
  const paper = papers[0];
  if (!paper) return null;

  const { rows: blocks } = await pool.query(
    `SELECT ps.*
       FROM page_sections ps
       JOIN pages p ON p.id = ps.page_id
      WHERE p.newspaper_id = $1 AND ps.feature_key IS NOT NULL
      ORDER BY p.page_number, ps.z_index`,
    [newspaperId],
  );

  if (!blocks.length) {
    return { filled: [], skipped: [], notes: ['No block on this edition is marked as a feature.'] };
  }

  // The horoscope's twelve entries have to fit the box they are going into, so
  // the block is measured BEFORE the model is asked - the brief carries the
  // character count, rather than the copy being trimmed after the fact.
  const horoscopeBlock = blocks.find((block) => block.feature_key === 'rashi');
  const charsPerSign = horoscopeBlock ? await perSignBudget(horoscopeBlock) : undefined;

  const built = await features.buildAll(paper.publication_date, { charsPerSign, tier });

  const filled = [];
  const skipped = [];

  for (const block of blocks) {
    const result = built.features[block.feature_key];
    if (!result) {
      // Say WHY on the item itself. A box that could not be filled has to
      // explain itself where the desk is looking at it, not only in a note at
      // the bottom of the response.
      const declared = features.list().find((entry) => entry.key === block.feature_key);
      skipped.push({
        sectionKey: block.section_key,
        feature: block.feature_key,
        reason: declared?.reason
          || (declared?.source === 'feed'
            ? `No source is connected for this box yet — it needs ${declared.needs || 'a live feed'}.`
            : 'This feature produced nothing for this date. Check that an AI key is configured.'),
      });
      continue;
    }
    const copy = toCopy(result);
    await pool.query(
      `UPDATE page_sections
          SET headline = $2, subheading = $3, body = $4,
              status = 'ready', ai_generated = TRUE, language = 'Marathi',
              updated_at = CURRENT_TIMESTAMP
        WHERE id = $1`,
      [block.id, copy.headline, copy.subheading, copy.body],
    );
    filled.push({ sectionKey: block.section_key, feature: block.feature_key, chars: copy.body.length });
  }

  return { date: built.date, filled, skipped, notes: built.notes, writtenBy: built.writtenBy || null };
}

// How many characters each of the twelve signs may run to, given the box the
// layout gave the horoscope. Twelve labels and twelve blank lines come off the
// top before the writing starts.
async function perSignBudget(block) {
  const { buildFlowMap } = await textFlow();
  const map = buildFlowMap(block, {
    marginPx: Number(block.margin_px) || 12,
    lineHeight: Number(block.line_height) || 1.25,
    headline: 'आजचे राशिभविष्य',
    headlineFontPx: Number(block.headline_font_px),
    subheading: '',
    subheadingFontPx: Number(block.subheading_font_px),
    body: '',
    bodyFontPx: Number(block.body_font_px),
  });
  // Each entry costs its label, the separator and the lucky-number note as
  // well as its sentence.
  const overheadPerSign = 34;
  const usable = Math.max(0, map.bodyCharBudget - overheadPerSign * 12);
  return Math.max(40, Math.min(160, Math.floor(usable / 12)));
}

module.exports = { fillEdition, toCopy, perSignBudget };
