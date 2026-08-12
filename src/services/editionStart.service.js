// Starting an edition.
//
// This is the one action a desk performs every single day, and it was the
// action the software helped with least. "Create Today's Edition" made a brand
// new empty newspaper every time it was pressed - so pressing it twice gave you
// two papers for the same day, and the work was in whichever one you happened
// to have open. That is how the database reached 116 editions, most of them
// empty, and why an editor looking for yesterday's work could not find it.
//
// Three things are true of a daily paper, and all three can be derived rather
// than asked:
//
//   1. There is ONE paper per date. Starting today's edition when today's
//      edition exists means opening it, not making a second one.
//   2. The page ladder follows from the page count. See src/layout/ladder.js -
//      page one is the front, page two is city news, the last page is the back
//      page, and the features page is where a reader expects it.
//   3. Most of what is already on a page repeats. The advertisements booked for
//      a run appear in the same slot tomorrow; the standing features are the
//      same boxes filled for a new date. Only the news is new.
//
// So starting an edition is: find or make the paper for the date, build the
// ladder, carry forward what genuinely repeats, and fill the features for the
// date. What is left on screen is the day's actual work - the news - rather
// than a stack of empty pages to be configured first.

const pool = require('../config/db');
const newspaperRepository = require('../repositories/newspaper.repository');
const pageRepository = require('../repositories/page.repository');
const editionFeatures = require('./editionFeatures.service');
const { ladderFor, isSupportedEditionPageCount } = require('../layout/ladder');
const { identity } = require('../layout/identity');

/** Today, in the timezone the paper is printed in - never the server's, never UTC. */
function todayWhereWePrint() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: identity.timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

const isoDate = (value) => String(value || '').slice(0, 10);

/**
 * Everything that repeats from one edition to the next, copied into the new one.
 *
 * What carries:
 *   advertisement blocks   an advert is booked for a run of days. Yesterday's
 *                          advert in the same slot is far more likely to be
 *                          today's advert than an empty box is.
 * What does not:
 *   news                   obviously. A story carried into tomorrow's paper by
 *                          the software is how a paper reprints yesterday's
 *                          news, which is the one mistake nobody forgives.
 *   features               they are refilled for the new date instead, which is
 *                          the whole point of a date-derived feature.
 *
 * Only blocks whose slot exists on the new page in the same layout are copied,
 * and only into blocks that are still empty - so this can never overwrite work.
 */
async function carryForwardAdverts(fromNewspaperId, toNewspaperId) {
  const { rows } = await pool.query(
    `UPDATE page_sections AS target
        SET headline   = source.headline,
            subheading = source.subheading,
            body       = source.body,
            image_url  = source.image_url,
            caption    = source.caption,
            carried_from_section_id = source.id,
            updated_at = CURRENT_TIMESTAMP
       FROM page_sections AS source
       JOIN pages AS source_page ON source_page.id = source.page_id
       JOIN pages AS target_page ON target_page.newspaper_id = $2
                                AND target_page.page_number = source_page.page_number
                                AND target_page.template_key = source_page.template_key
      WHERE source_page.newspaper_id = $1
        AND target.page_id = target_page.id
        AND target.section_key = source.section_key
        AND source.block_type = 'advert'
        AND (COALESCE(source.headline, '') <> '' OR COALESCE(source.body, '') <> ''
             OR COALESCE(source.image_url, '') <> '')
        AND COALESCE(target.headline, '') = ''
        AND COALESCE(target.body, '') = ''
        AND COALESCE(target.image_url, '') = ''
      RETURNING target.id`,
    [fromNewspaperId, toNewspaperId],
  );
  return rows.length;
}

/**
 * Open the edition for a date, or start it.
 *
 * Returns { newspaper, created, ladder, carriedAdverts, features }. `created`
 * is false when the edition already existed - the caller opens it either way,
 * which is what makes pressing the button twice harmless.
 */
async function startEdition(body = {}, sessionUser = null) {
  const date = isoDate(body.publicationDate || body.date) || todayWhereWePrint();
  const pageCount = Number(body.pageCount || 4);
  if (!isSupportedEditionPageCount(pageCount)) return { error: 'INVALID_EDITION_PAGE_COUNT', created: false };
  const carryForward = body.carryForward !== false;
  const fillFeatures = body.fillFeatures !== false;

  const existing = await newspaperRepository.findByDate(date);
  if (existing) {
    const pages = await pageRepository.findByNewspaper(existing.id);

    return {
      newspaper: existing,
      created: false,
      existing: true,
      pageCount: pages.length,
      ladder: pages.map((page) => ({ pageNumber: page.page_number, templateKey: page.template_key })),
      carriedAdverts: 0,
      features: null,
    };
  }

  const newspaper = await newspaperRepository.create({
    name: body.name || identity.title,
    publicationDate: date,
    createdBy: sessionUser?.id || null,
  });

  // The ladder, not four front pages.
  const ladder = ladderFor(pageCount);
  for (const rung of ladder) {
    await pageRepository.create(newspaper.id, rung.pageNumber, rung.templateKey);
  }

  let carriedAdverts = 0;
  if (carryForward) {
    const previous = await newspaperRepository.findPrevious(date);
    if (previous) carriedAdverts = await carryForwardAdverts(previous.id, newspaper.id);
  }

  // The standing features, for this edition's own date. Failing to fill them is
  // not a failure to start the edition - an unconfigured model provider must
  // not stop a paper being made up - so the outcome is reported, not thrown.
  let features = null;
  if (fillFeatures) {
    try {
      features = await editionFeatures.fillEdition(newspaper.id);
    } catch (error) {
      features = { error: error.message };
    }
  }

  return { newspaper, created: true, pageCount, ladder, carriedAdverts, features };
}

module.exports = { startEdition, carryForwardAdverts, todayWhereWePrint };
