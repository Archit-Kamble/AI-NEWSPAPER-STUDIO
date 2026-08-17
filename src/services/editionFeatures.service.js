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
const reviewInvalidation = require('./reviewInvalidation.service');

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
//
// The body text is always built, even when `card` is present - everything
// that MEASURES a block reads body text (the character grid, the worklist,
// preflight, the fit action; smart-cards.js's own comment on smartCardText()
// says so directly), so the flattened copy has to exist regardless of whether
// a card renders on top of it.
//
// `maxBodyChars`, when given, is enforced HERE, not merely requested of the
// model. राशिभविष्य/सुविचार are AI-written (written.js), and the brief already
// asks for a per-sign character ceiling - but a brief is a request, not a
// guarantee, exactly as CLAUDE.md documents at length for storyWriter.service.js
// (the sibling problem for ordinary story blocks, solved there with a measured
// reservation and a resize retry). Confirmed live, not assumed: re-running
// "Fill features" against the same real block landed the rashi card 126
// characters over its own budget on one run in five - a real, if occasional,
// production overset with no safety net at all before this. Rather than a
// second paid AI call (which every other resize path in this codebase treats
// as a real cost to avoid), whole ENTRIES are dropped from the tail until the
// body fits - never a mid-sentence cut, and dropped entries are reported so
// the gap is visible on the response, not silently absorbed.
function toCopy(result, maxBodyChars) {
  const items = result.items || [];
  const lines = items.map((item) => {
    const head = item.label ? `${item.label} : ` : '';
    const tail = item.note ? ` (${item.note})` : '';
    return `${head}${item.text}${tail}`;
  });

  let kept = lines;
  let entriesDropped = 0;
  if (maxBodyChars) {
    while (kept.length && kept.join('\n').length > maxBodyChars) {
      kept = kept.slice(0, -1);
      entriesDropped += 1;
    }
  }

  return {
    headline: result.title || '',
    subheading: result.subtitle || '',
    body: kept.join('\n'),
    entriesDropped,
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
  const trimNotes = [];

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
    const budget = await bodyBudgetFor(block, result.title || '', result.subtitle || '');
    const copy = toCopy(result, budget);
    if (copy.entriesDropped) {
      trimNotes.push(
        `${block.section_key}: ${copy.entriesDropped} entr${copy.entriesDropped === 1 ? 'y' : 'ies'} did not fit ` +
        'this block and were left out rather than cut mid-sentence. The block was still filled with the rest.',
      );
      // The trim protects the flattened body - the canonical text every
      // measuring tool reads (worklist/preflight/character grid), and what a
      // reader would see if the card were ever removed. It does not also trim
      // `result.card`'s own entries, so a card that is CURRENTLY rendering
      // still shows all twelve signs; only the text underneath it, which is
      // what is actually oversized, is protected. That is fine, and not a gap
      // to close here: the flattened body trim is a writer-budget/fallback
      // safety mechanism, and the structured Smart Card's own final printable
      // fit is decided by layoutSmartCard()/preflight (SMART_CARD_OVERSET),
      // never by CSS clipping.
    }
    // `result.card` is the structured payload every feature builder produces
    // (src/features/{sudoku,written,panchang,dinvishesh}.js) beside its
    // flattened `items` - and this UPDATE used to discard it, writing only the
    // flattened copy. So "Fill features", the one bulk action a desk actually
    // presses every morning, never once produced a real Smart Card: the
    // rashi/panchang/dinvishesh/suvichar/sudoku blocks it fills all fell
    // through to feature-table.js's fallback, silently, every single edition.
    // Overwritten unconditionally, exactly like headline/subheading/body
    // already are above - pressing "Fill features" is a deliberate refill,
    // same as it always has been for the copy.
    const declared = features.list().find((entry) => entry.key === block.feature_key);
    const reviewStatus = declared?.source === 'written' ? 'needs_review' : 'ready';
    await pool.query(
      `UPDATE page_sections
          SET headline = $2, subheading = $3, body = $4,
              smart_card_key = $5, smart_card_data = $6,
              status = $7, ai_generated = TRUE, language = 'Marathi',
              updated_at = CURRENT_TIMESTAMP
        WHERE id = $1`,
      [block.id, copy.headline, copy.subheading, copy.body,
        result.card ? block.feature_key : null, result.card ? JSON.stringify(result.card) : null, reviewStatus],
    );
    await reviewInvalidation.invalidatePage(block.page_id);
    filled.push({ sectionKey: block.section_key, feature: block.feature_key, chars: copy.body.length, status: reviewStatus });
  }

  return { date: built.date, filled, skipped, notes: [...built.notes, ...trimNotes], writtenBy: built.writtenBy || null };
}

// The real character budget for THIS block, with the headline/subheading it
// is actually about to receive - not an estimate. `toCopy()`'s trim is only as
// good as this number: measured too generously, an oversized body still gets
// written; too strictly, entries are dropped that would have fit.
async function bodyBudgetFor(block, headline, subheading) {
  const { buildFlowMap } = await textFlow();
  const map = buildFlowMap(block, {
    marginPx: Number(block.margin_px) || 12,
    lineHeight: Number(block.line_height) || 1.25,
    headline,
    headlineFontPx: Number(block.headline_font_px),
    subheading,
    subheadingFontPx: Number(block.subheading_font_px),
    body: '',
    bodyFontPx: Number(block.body_font_px),
  });
  return map.bodyCharBudget;
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

module.exports = { fillEdition, toCopy, perSignBudget, bodyBudgetFor };
