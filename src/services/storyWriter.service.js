// Write a story into a block, to the size of the hole it has to fill.
//
// A sub-editor types a line - "जंतरमंतर आंदोलन", "Jantar Mantar protest" - and
// this turns it into a headline, a subheading and body copy that FITS. The
// interesting part is the second half of that sentence.
//
// The AI is not asked for "about 400 words". It is handed the block as the
// character grid already understands it: the exact number of characters of body
// copy that will fit, after the pictures on the block have taken their cells and
// the copy has been run around them. That number comes from
// public/editor/layout/text-flow.js - the same module the browser draws with,
// the same one the worklist, the fit action, the jump and preflight all measure
// with. There is one grid in this software and this is it.
//
// Two rules this obeys, both from VISION.md and both non-negotiable:
//
//   AI assists, it never owns.  Nothing here writes to the database. It returns
//   a PROPOSAL. The desk reads it and accepts it, and the block it lands in is
//   marked `needs_review` so it cannot reach a page unread.
//
//   Never invent a fact.  A seed of four words does not contain a death toll,
//   a date or a quotation, and a model asked to fill 800 characters from four
//   words will produce them. The brief forbids it explicitly and asks for the
//   copy to stay general where it does not know.

const pool = require('../config/db');
const ai = require('./ai');
const sectionImages = require('../repositories/sectionImage.repository');

let flowModule = null;
async function textFlow() {
  if (!flowModule) flowModule = await import('../../public/editor/layout/text-flow.js');
  return flowModule;
}

// What the model must return, and nothing else. `strict` keeps the providers
// that support schema-constrained decoding from wandering.
const STORY_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['headline', 'subheading', 'body'],
  properties: {
    headline: { type: 'string', description: 'The headline, as it will print.' },
    subheading: { type: 'string', description: 'One line under the headline. May be empty.' },
    body: { type: 'string', description: 'The story itself, in paragraphs separated by blank lines.' },
  },
};

/** The block, its pictures, and the page it is on. */
async function loadBlock(pageId, sectionKey) {
  const { rows } = await pool.query(
    `SELECT s.*, p.page_number, n.publication_date, n.id AS newspaper_id
       FROM page_sections s
       JOIN pages p ON p.id = s.page_id
       JOIN newspapers n ON n.id = p.newspaper_id
      WHERE s.page_id = $1 AND s.section_key = $2`,
    [pageId, sectionKey],
  );
  if (!rows[0]) return null;

  // Through the repository, not a second copy of the SQL: the pictures a block
  // holds are joined to their media assets and ordered by z-index, and getting
  // that subtly wrong here would brief the AI on a different block from the one
  // the editor is drawing.
  const images = await sectionImages.listBySection(rows[0].id);
  return { section: rows[0], images };
}

/**
 * How much copy this block can hold, measured on the real grid.
 *
 * Measured with the body EMPTY: the question is "how much room is there", not
 * "how much room is left after what is already written".
 */
async function measure(section, images) {
  const { buildFlowMap, flowImageFromRow } = await textFlow();
  const view = {
    headline: section.headline || '',
    subheading: section.subheading || '',
    body: '',
    marginPx: Number(section.margin_px) || 12,
    columnCount: Number(section.column_count) || 1,
    lineHeight: Number(section.line_height) || 1.45,
    headlineFontPx: Number(section.headline_font_px) || 24,
    subheadingFontPx: Number(section.subheading_font_px) || 14,
    bodyFontPx: Number(section.body_font_px) || 10,
  };
  const map = buildFlowMap(section, view, (images || []).map(flowImageFromRow));
  return {
    bodyCharBudget: map.bodyCharBudget,
    bodyWordBudget: map.bodyWordBudget,
    cols: map.cols,
    rows: map.rows,
    hasPictures: (images || []).length > 0,
  };
}

const LANGUAGE_NAMES = { Marathi: 'Marathi (मराठी)', Hindi: 'Hindi (हिंदी)', English: 'English' };

/**
 * The brief.
 *
 * Written as instructions to a sub-editor rather than as a template, because
 * that is what produces newspaper copy instead of an essay.
 */
function briefFor({ seed, notes, fit, section, language, isLead }) {
  const languageName = LANGUAGE_NAMES[language] || LANGUAGE_NAMES.Marathi;
  const headlineChars = Math.max(24, Math.min(90, Math.round(fit.cols * 0.9)));

  return [
    `You are a sub-editor on a Marathi daily newspaper. Write one news item in ${languageName}.`,
    '',
    `WHAT IT IS ABOUT: ${seed}`,
    notes ? `THE DESK ALSO ASKS: ${notes}` : '',
    '',
    'FIT — this is the part that matters most:',
    `  * The body must be between ${Math.round(fit.bodyCharBudget * 0.85)} and ${fit.bodyCharBudget} characters.`,
    `    That is the exact space left on the block${fit.hasPictures ? ' after its pictures are placed' : ''}.`,
    `    Copy longer than ${fit.bodyCharBudget} characters does not fit on the page and will be cut.`,
    `  * The headline must be at most ${headlineChars} characters.`,
    '  * The subheading is one line, at most 140 characters. Leave it empty if the story does not need one.',
    '',
    'HOW TO WRITE IT:',
    `  * ${isLead ? 'This is a lead story: open with the most important fact.' : 'Open with the most important fact.'}`,
    '  * Short paragraphs, separated by a blank line. Plain newspaper prose.',
    '  * No markdown, no headings inside the body, no bullet characters, no quotation marks around the whole thing.',
    '',
    'WHAT YOU MUST NOT DO — read this twice:',
    '  * Do NOT invent facts. No casualty figures, no rupee amounts, no dates, no',
    '    times, no crowd sizes, no named officials, and no direct quotations unless',
    '    they were given to you above.',
    '  * Where you do not know a specific, write the sentence generally instead of',
    '    filling the gap with a plausible-sounding number or name.',
    '  * A desk will read this before it is printed. An invented figure that reaches',
    '    a printed newspaper is the worst thing this software can do.',
    '',
    `Block: ${section.width_px} × ${section.height_px} px (${Math.round(section.width_px / 2)} × ${Math.round(section.height_px / 2)} mm), ${fit.cols} characters across.`,
  ].filter((line) => line !== '').join('\n');
}

/**
 * Writes a proposal for one block from a short seed.
 *
 * Returns `{ proposal, fit, provider, tier }` or `{ error }`. Never writes.
 */
async function write(pageId, sectionKey, { seed, notes, tier, language } = {}) {
  const clean = String(seed || '').trim();
  if (!clean) return { error: 'Say what the story is about first — a few words is enough.' };
  if (!ai.isConfigured()) {
    const status = ai.status();
    return { error: status.hint || 'No AI provider is configured. Add a key to .env.', unconfigured: true };
  }

  const loaded = await loadBlock(pageId, sectionKey);
  if (!loaded) return { error: 'That block no longer exists.' };
  const { section, images } = loaded;

  const fit = await measure(section, images);
  if (!fit.bodyCharBudget) {
    return { error: 'This block has no room for copy — it is filled by its pictures, or it is too small.' };
  }

  const result = await ai.askForJson(
    briefFor({
      seed: clean,
      notes: String(notes || '').trim(),
      fit,
      section,
      language: language || section.language,
      isLead: /lead/i.test(sectionKey),
    }),
    STORY_SCHEMA,
    { tier },
  );
  if (result.error) return { error: result.error, unconfigured: result.unconfigured };

  const { plainText } = await textFlow().then(() => require('../layout/plain-text'));
  const body = String(result.data.body || '').trim();
  const used = (await plainText(body)).length;

  return {
    proposal: {
      headline: String(result.data.headline || '').trim(),
      subheading: String(result.data.subheading || '').trim(),
      body,
    },
    // Measured, not promised. A model asked for 800 characters routinely
    // returns 950, and the desk should be told before it accepts.
    fit: {
      bodyCharBudget: fit.bodyCharBudget,
      charsUsed: used,
      charsRemaining: fit.bodyCharBudget - used,
      overflowing: used > fit.bodyCharBudget,
    },
    provider: result.provider,
    tier: result.tier,
    fellBackTo: result.fellBackTo,
  };
}

module.exports = { write, measure, briefFor, STORY_SCHEMA };
