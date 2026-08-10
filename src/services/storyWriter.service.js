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
 *
 * `headline` and `subheading` override what the block currently carries. That
 * matters more than it sounds: writing from a seed starts on an EMPTY block, so
 * measuring what is there measures a block with no headline at all - and a
 * headline takes whole rows off the top. The budget quoted to the model was
 * therefore always for a block with no headline on it, and the model's own
 * headline then ate the room its body had been promised. Planning reserves the
 * headline it is about to be asked for.
 */
async function measure(section, images, over = {}) {
  const { buildFlowMap, flowImageFromRow } = await textFlow();
  const view = {
    headline: over.headline ?? (section.headline || ''),
    subheading: over.subheading ?? (section.subheading || ''),
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

// How long a headline may be, in characters, for a block this wide. A headline
// is set across the measure at headline size, so it is roughly one line of body
// characters less the larger type.
function headlineLimit(cols) {
  return Math.max(24, Math.min(90, Math.round(cols * 0.9)));
}

// A deck is one line. Never longer than the measure, never a paragraph.
function subheadingLimit(cols) {
  return Math.max(40, Math.min(140, cols * 2));
}

/**
 * The budget with room kept for the headline and deck the model has not
 * written yet.
 *
 * Stand-ins of the right LENGTH are enough: the grid turns a string into rows
 * from its length and its type size, so a placeholder of the limit reserves
 * exactly the rows a headline of the limit will take.
 */
async function planningFit(section, images) {
  const room = await measure(section, images);
  const cols = room.cols || 1;
  const placeholder = (length) => 'क'.repeat(Math.max(0, length));
  return measure(section, images, {
    headline: placeholder(headlineLimit(cols)),
    subheading: placeholder(Math.round(subheadingLimit(cols) * 0.7)),
  });
}

/**
 * The brief.
 *
 * Written as instructions to a sub-editor rather than as a template, because
 * that is what produces newspaper copy instead of an essay.
 */
function briefFor({ seed, notes, fit, section, language, isLead }) {
  const languageName = LANGUAGE_NAMES[language] || LANGUAGE_NAMES.Marathi;
  const headlineChars = headlineLimit(fit.cols);
  const deckChars = subheadingLimit(fit.cols);
  // A floor, not just a ceiling. Copy that fills three quarters of a block
  // leaves a white hole on the page that somebody has to fill at 11pm.
  const floor = Math.round(fit.bodyCharBudget * 0.92);

  return [
    `You are a sub-editor on a Marathi daily newspaper. Write one news item in ${languageName}.`,
    '',
    `WHAT IT IS ABOUT: ${seed}`,
    notes ? `THE DESK ALSO ASKS: ${notes}` : '',
    '',
    'FIT — this is the part that matters most:',
    `  * The body must be between ${floor} and ${fit.bodyCharBudget} characters.`,
    `    That is the exact space left on the block${fit.hasPictures ? ' after its pictures are placed' : ''},`,
    '    with room already kept for the headline and the subheading below.',
    `    Shorter than ${floor} leaves a white hole on the page. Longer than`,
    `    ${fit.bodyCharBudget} does not fit and will be cut. Count as you write, and`,
    '    keep adding detail about the subject until you are inside that range.',
    `  * The headline must be at most ${headlineChars} characters.`,
    `  * The subheading is REQUIRED: one line of ${Math.round(deckChars * 0.5)} to ${deckChars}`,
    '    characters that carries the story forward rather than repeating the headline.',
    '    It is a deck, not a label, and it is never empty.',
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

const BODY_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['body'],
  properties: { body: { type: 'string', description: 'The story, resized to fit.' } },
};

/**
 * The second pass: the same story, cut or carried on until it fills the hole.
 *
 * Deliberately not "write it again" - a rewrite loses the copy the desk may
 * already have read. This asks for the same story at a different length, and
 * says which way to go.
 */
function resizeBriefFor({ proposal, used, budget, language }) {
  const languageName = LANGUAGE_NAMES[language] || LANGUAGE_NAMES.Marathi;
  const short = used < budget;

  return [
    `You are a sub-editor on a Marathi daily newspaper, working in ${languageName}.`,
    '',
    'This copy is the right story but the wrong length for the space it has to fill.',
    `It is ${used} characters. The block holds ${budget}.`,
    short
      ? `Carry it on to between ${Math.round(budget * 0.95)} and ${budget} characters: keep every sentence`
        + ' that is there, in the same order, and add further paragraphs of context and background'
        + ' about the same subject.'
      : `Cut it to at most ${budget} characters: take out the least important sentences and tighten`
        + ' the rest. Keep the opening.',
    '',
    'The same rules as before: no invented casualty figures, rupee amounts, dates, times,',
    'crowd sizes, named officials or quotations. Where you do not know a specific, write',
    'the sentence generally. Plain newspaper prose, short paragraphs separated by a blank',
    'line, no markdown.',
    '',
    'THE COPY:',
    proposal.body,
  ].join('\n');
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

  // Planned with the headline and deck reserved, so the body is asked for the
  // room it will actually have rather than the room an empty block has.
  const fit = await planningFit(section, images);
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
  const proposal = {
    headline: String(result.data.headline || '').trim(),
    subheading: String(result.data.subheading || '').trim(),
    body: String(result.data.body || '').trim(),
  };

  // Now measure against the headline and deck it actually wrote - the real
  // hole, not the planned one - and if the copy misses it, say so once and let
  // it fix its own work. A model asked for 500 characters returns 360 often
  // enough that accepting the first answer is what leaves blocks three quarters
  // full.
  const real = await measure(section, images, {
    headline: proposal.headline,
    subheading: proposal.subheading,
  });
  let used = (await plainText(proposal.body)).length;

  if (real.bodyCharBudget && (used < real.bodyCharBudget * 0.9 || used > real.bodyCharBudget)) {
    const repaired = await ai.askForJson(
      resizeBriefFor({ proposal, used, budget: real.bodyCharBudget, language: language || section.language }),
      BODY_SCHEMA,
      { tier },
    );
    if (!repaired.error && repaired.data?.body) {
      const next = String(repaired.data.body).trim();
      const nextUsed = (await plainText(next)).length;
      // Only if it is genuinely closer. A second attempt is allowed to fail.
      if (Math.abs(nextUsed - real.bodyCharBudget) < Math.abs(used - real.bodyCharBudget)) {
        proposal.body = next;
        used = nextUsed;
      }
    }
  }

  return {
    proposal,
    // Measured, not promised. A model asked for 800 characters routinely
    // returns 950, and the desk should be told before it accepts.
    fit: {
      bodyCharBudget: real.bodyCharBudget,
      charsUsed: used,
      charsRemaining: real.bodyCharBudget - used,
      overflowing: used > real.bodyCharBudget,
    },
    provider: result.provider,
    tier: result.tier,
    fellBackTo: result.fellBackTo,
  };
}

/**
 * The brief for filling the space a block has LEFT.
 *
 * Deliberately not "write this block again". The desk has copy it has already
 * read - possibly a reporter's - and the request is to carry it on into the
 * white space underneath, keeping every sentence that is there. A rewrite
 * would throw away work somebody has already checked.
 */
function fillBriefFor({ view, notes, room, language, section }) {
  const languageName = LANGUAGE_NAMES[language] || LANGUAGE_NAMES.Marathi;

  return [
    `You are a sub-editor on a Marathi daily newspaper, working in ${languageName}.`,
    '',
    'This block is not full. Carry the copy on so that it fills the space, and do it',
    'without changing a word of what is already there.',
    '',
    `HEADLINE: ${view.headline || '(none yet)'}`,
    view.subheading ? `SUBHEADING: ${view.subheading}` : '',
    notes ? `THE DESK ALSO ASKS: ${notes}` : '',
    '',
    'FIT:',
    `  * Return the WHOLE body: what is below, unchanged and in the same order,`,
    `    followed by the new paragraphs.`,
    `  * The whole thing must be between ${Math.round(room.budget * 0.95)} and ${room.budget} characters.`,
    `    It is ${room.used} now, so you are adding roughly ${room.remaining} characters.`,
    '  * Short paragraphs, separated by a blank line. Plain newspaper prose, no markdown.',
    '',
    'WHAT YOU MUST NOT DO — read this twice:',
    '  * Do NOT invent facts. No casualty figures, no rupee amounts, no dates, no times,',
    '    no crowd sizes, no named officials, and no direct quotations that are not already',
    '    in the copy below.',
    '  * You are filling space, and filling space is exactly when a model starts making',
    '    things up. Where you do not know a specific, write generally: background, context,',
    '    what happens next, what has been said publicly. A block three quarters full is a',
    '    problem the desk can fix. An invented figure in print is not.',
    '  * Do not repeat sentences to reach the length.',
    '',
    `Block: ${section.width_px} × ${section.height_px} px, ${room.cols} characters across.`,
    '',
    'THE COPY SO FAR:',
    view.body || '(the block is empty — write it from the headline above)',
  ].filter((line) => line !== '').join('\n');
}

/**
 * Fills the room a block has left, and returns a proposal.
 *
 * Never writes. The desk accepts it into the same editable draft as typed copy,
 * and the block is marked `needs_review` - see VISION.md: AI assists, it never
 * owns. A reporter's story is not overwritten by this; it is continued, and the
 * original is still in the draft until the desk accepts.
 */
async function fillRemaining(pageId, sectionKey, { notes, tier, language } = {}) {
  if (!ai.isConfigured()) {
    const status = ai.status();
    return { error: status.hint || 'No AI provider is configured. Add a key to .env.', unconfigured: true };
  }

  const loaded = await loadBlock(pageId, sectionKey);
  if (!loaded) return { error: 'That block no longer exists.' };
  const { section, images } = loaded;

  if (section.smart_card_key) {
    return { error: 'This block holds a Smart Card. Remove the card first, or write in another block.' };
  }

  // Measured against the headline and deck the block ACTUALLY has - the real
  // hole, not the one an empty block would have.
  const room = await measure(section, images, {});
  const { plainText } = require('../layout/plain-text');
  const used = (await plainText(section.body || '')).length;
  const remaining = room.bodyCharBudget - used;

  if (!room.bodyCharBudget) {
    return { error: 'This block has no room for copy — it is filled by its pictures, or it is too small.' };
  }
  if (remaining <= 0) {
    return {
      error: used > room.bodyCharBudget
        ? `This block is already ${used - room.bodyCharBudget} characters over. Cut it, set it tighter, or carry it over.`
        : 'This block is already full.',
    };
  }

  const view = {
    headline: section.headline || '',
    subheading: section.subheading || '',
    body: section.body || '',
  };

  const result = await ai.askForJson(
    fillBriefFor({
      view,
      notes: String(notes || section.ai_notes || '').trim(),
      room: { budget: room.bodyCharBudget, used, remaining, cols: room.cols },
      language: language || section.language,
      section,
    }),
    BODY_SCHEMA,
    { tier },
  );
  if (result.error) return { error: result.error, unconfigured: result.unconfigured, outputExhausted: result.outputExhausted };

  const body = String(result.data.body || '').trim();
  if (!body) return { error: 'The AI returned nothing to add.' };

  const nowUsed = (await plainText(body)).length;
  return {
    // Only the body changes. The headline and the deck the desk wrote stay
    // exactly as they are - this action fills space, it does not re-edit a
    // story that has already been read.
    proposal: { body },
    fit: {
      bodyCharBudget: room.bodyCharBudget,
      charsUsed: nowUsed,
      charsRemaining: room.bodyCharBudget - nowUsed,
      charsBefore: used,
      overflowing: nowUsed > room.bodyCharBudget,
    },
    provider: result.provider,
    tier: result.tier,
    fellBackTo: result.fellBackTo,
    retriedAt: result.retriedAt,
  };
}

module.exports = {
  write, fillRemaining, measure, planningFit,
  briefFor, resizeBriefFor, fillBriefFor,
  STORY_SCHEMA, BODY_SCHEMA,
};
