// Jump lines: carrying a story that will not fit onto another page.
//
// This is the oldest move in newspaper production and every paper on the stand
// uses it - a story runs on page one to the foot of its block and continues
// inside, with "(उर्वरित पान ४ वर)" at the break and "(पान १ वरून)" where it
// picks up.
//
// The software is already most of the way there: the character grid knows
// exactly how much of a story a block can hold. Up to now it only warned that
// copy was overset. This turns that measurement into the action a sub-editor
// actually wants - put what fits here, put the rest there, and set both lines.
//
// Two things this is careful about:
//
//   * The jump line costs characters. It is written into the first part, so it
//     has to come out of that part's budget before the split point is chosen,
//     or the very act of adding it oversets the block again.
//
//   * The break falls at a sentence if there is one within reach, and at a word
//     otherwise. A story never breaks mid-word across a page turn.

const pool = require('../config/db');
const { devanagari } = require('../layout/identity');

// The two lines. Marathi papers word them like this.
//
// They exist because a reader has to TURN A PAGE. A story continuing into a
// second leg on the same page needs neither - the reader's eye simply carries
// on, and every printed page runs stories across two or three legs without
// saying so. So a same-page continuation sets no lines at all, and its second
// leg carries no headline either: a repeated headline halfway down a page
// reads as a second story, not as the same one.
const carryLine = (pageNumber) => `(उर्वरित पान ${devanagari(pageNumber)} वर)`;
const pickUpLine = (pageNumber) => `(पान ${devanagari(pageNumber)} वरून)`;

let flowModule = null;
async function textFlow() {
  if (!flowModule) flowModule = await import('../../public/editor/layout/text-flow.js');
  return flowModule;
}

async function sectionWithPage(pageId, sectionKey) {
  const { rows } = await pool.query(
    `SELECT ps.*, p.page_number, p.newspaper_id
       FROM page_sections ps JOIN pages p ON p.id = ps.page_id
      WHERE ps.page_id = $1 AND ps.section_key = $2`,
    [pageId, sectionKey],
  );
  return rows[0] || null;
}

// How much body a block can hold, given the pictures already placed in it.
async function budgetFor(section) {
  const { buildFlowMap, flowImageFromRow } = await textFlow();
  const { rows: images } = await pool.query(
    'SELECT * FROM section_images WHERE page_section_id = $1',
    [section.id],
  );
  const map = buildFlowMap(section, {
    marginPx: Number(section.margin_px) || 12,
    lineHeight: Number(section.line_height) || 1.25,
    headline: section.headline || '',
    headlineFontPx: Number(section.headline_font_px),
    subheading: section.subheading || '',
    subheadingFontPx: Number(section.subheading_font_px),
    body: '',
    bodyFontPx: Number(section.body_font_px),
  }, images.map(flowImageFromRow));
  return map.bodyCharBudget;
}

// Break at the last sentence end that fits; if the nearest sentence end is a
// long way back, break at a word instead rather than throw away a third of the
// space.
function splitAt(text, limit) {
  if (text.length <= limit) return { head: text, tail: '' };

  const window = text.slice(0, limit);
  const sentence = Math.max(window.lastIndexOf('. '), window.lastIndexOf('.\n'), window.lastIndexOf('? '));
  if (sentence > limit * 0.55) {
    return { head: text.slice(0, sentence + 1).trim(), tail: text.slice(sentence + 1).trim() };
  }
  const word = window.lastIndexOf(' ');
  if (word <= 0) return { head: window.trim(), tail: text.slice(window.length).trim() };
  return { head: text.slice(0, word).trim(), tail: text.slice(word).trim() };
}

/**
 * Finds where the rest of a story could go: the first block on a later page
 * with nothing in it. Returning null is a real answer - it means the edition
 * has no room and the desk has to make some.
 */
async function findLanding(newspaperId, fromPageNumber) {
  const { rows } = await pool.query(
    `SELECT ps.*, p.page_number
       FROM page_sections ps JOIN pages p ON p.id = ps.page_id
      WHERE p.newspaper_id = $1
        AND p.page_number > $2
        AND ps.news_item_id IS NULL
        AND ps.feature_key IS NULL
        AND ps.block_type NOT IN ('advert', 'feature')
        AND COALESCE(ps.headline, '') = ''
        AND COALESCE(ps.body, '') = ''
        AND COALESCE(ps.image_url, '') = ''
      ORDER BY p.page_number, ps.width_px * ps.height_px DESC
      LIMIT 1`,
    [newspaperId, fromPageNumber],
  );
  return rows[0] || null;
}

/**
 * Carries the part of a story that does not fit onto another page.
 *
 * With no target given it finds the first empty block on a later page, which is
 * what a sub-editor wants: one press, and it says where the story went.
 */
async function carryOver(pageId, sectionKey, { toPageId, toSectionKey } = {}) {
  const source = await sectionWithPage(pageId, sectionKey);
  if (!source) return { error: 'No such block.' };
  if (!source.body) return { error: 'There is nothing in this block to carry over.' };

  const target = toPageId && toSectionKey
    ? await sectionWithPage(toPageId, toSectionKey)
    : await findLanding(source.newspaper_id, source.page_number);

  if (!target) {
    return { error: 'There is no empty block on a later page to carry this into.' };
  }
  if (target.id === source.id) return { error: 'A story cannot continue into itself.' };

  const budget = await budgetFor(source);
  // A continuation on the SAME page is not a jump: see carryLine() above.
  const samePage = Number(target.page_id) === Number(source.page_id);
  const carry = samePage ? '' : carryLine(target.page_number);
  const pickUp = samePage ? '' : pickUpLine(source.page_number);

  // The jump line is printed, so it is paid for out of the first part's budget.
  const room = budget - carry.length - 1;
  if (room < 40) {
    return { error: 'This block is too small to hold a first part and a jump line.' };
  }

  const { head, tail } = splitAt(source.body.trim(), room);
  if (!tail) return { error: 'All of this story already fits — there is nothing to carry.' };

  // The landing block gets no say in how much text arrives - `room` above is
  // sized against the SOURCE's own capacity alone, so a short story leaving a
  // long tail behind can silently overset whatever empty block findLanding()
  // happened to pick, especially a narrow column far smaller than the block
  // the story started in. Found live: a lead's continuation landed 560
  // characters over budget in a four-column block. Checked here, before
  // anything is written, rather than left for preflight to catch after the
  // fact - "never truncate, never silently overflow" applies to a jump line
  // exactly as it does to a first draft.
  // The second leg of a same-page story carries no headline of its own, so it
  // is measured without one - measuring it with the first leg's headline would
  // reserve rows nothing is ever set in and refuse continuations that fit.
  const targetBudget = await budgetFor({
    ...target,
    headline: samePage ? '' : source.headline,
    subheading: target.subheading || '',
  });
  const targetRoom = targetBudget - pickUp.length - 1;
  if (`${pickUp} ${tail}`.trim().length > targetBudget) {
    return {
      error: targetRoom < 40
        ? 'The block this would land on is too small to hold a continuation and its pick-up line.'
        : `The remaining ${tail.length} characters are more than the landing block can hold (room for about ${Math.max(0, targetRoom)}). Choose a bigger block, or cut the story first.`,
    };
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      `UPDATE page_sections SET body = $2, updated_at = CURRENT_TIMESTAMP WHERE id = $1`,
      [source.id, carry ? `${head}\n\n${carry}` : head],
    );
    // The continuation carries the story's own headline so a reader turning the
    // page knows what they are picking up, and records where it came from.
    await client.query(
      `UPDATE page_sections
          SET headline = $2, body = $3, category = $4, location = $5, reporter_name = $6,
              language = $7, status = 'ready', continued_from_section_id = $8,
              updated_at = CURRENT_TIMESTAMP
        WHERE id = $1`,
      [target.id, samePage ? '' : (source.headline || ''), `${pickUp} ${tail}`.trim(),
       source.category, source.location,
       source.reporter_name, source.language || 'Marathi', source.id],
    );
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }

  return {
    ok: true,
    samePage,
    from: { pageNumber: source.page_number, sectionKey: source.section_key, chars: head.length },
    to: { pageId: target.page_id, pageNumber: target.page_number, sectionKey: target.section_key, chars: tail.length },
    carryLine: carry,
  };
}

/**
 * Undoes a jump: the continuation is emptied and its copy goes back onto the
 * end of the first part.
 */
async function reunite(pageId, sectionKey) {
  const source = await sectionWithPage(pageId, sectionKey);
  if (!source) return { error: 'No such block.' };

  const { rows: parts } = await pool.query(
    'SELECT * FROM page_sections WHERE continued_from_section_id = $1',
    [source.id],
  );
  if (!parts.length) return { error: 'This story does not continue anywhere.' };

  // A same-page second leg has no pick-up line to strip; one that jumped a page
  // does. Stripping an absent line is a no-op, so one expression covers both.
  const tail = parts
    .map((part) => String(part.body || '').replace(/^\(पान [^)]*\)\s*/, ''))
    .join('\n\n');
  const head = String(source.body || '').replace(/\n*\(उर्वरित पान [^)]*\)\s*$/, '');

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('UPDATE page_sections SET body = $2 WHERE id = $1', [source.id, `${head}\n\n${tail}`.trim()]);
    for (const part of parts) {
      await client.query(
        `UPDATE page_sections
            SET headline = NULL, body = NULL, status = 'empty', continued_from_section_id = NULL,
                updated_at = CURRENT_TIMESTAMP
          WHERE id = $1`,
        [part.id],
      );
    }
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
  return { ok: true, reunited: parts.length };
}

module.exports = { carryOver, reunite, splitAt, carryLine, pickUpLine, findLanding };
