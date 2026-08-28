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
const { publicationDateFrom, todayWhereWePrint } = require('./publicationDate');
const pageRepository = require('../repositories/page.repository');
const editionFeatures = require('./editionFeatures.service');
const { ladderFor, isSupportedEditionPageCount } = require('../layout/ladder');
const { identity } = require('../layout/identity');

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
  // The date is checked before anything else, for the same reason the page
  // count is: it decides which edition this is, and an unreal one used to
  // reach PostgreSQL and come back to the desk as a 500.
  const { date, error: dateError } = publicationDateFrom(body);
  if (dateError) return { error: dateError, created: false };

  const pageCount = Number(body.pageCount || 4);
  if (!isSupportedEditionPageCount(pageCount)) return { error: 'INVALID_EDITION_PAGE_COUNT', created: false };
  const carryForward = body.carryForward !== false;
  const fillFeatures = body.fillFeatures !== false;

  // ONE PAPER PER DATE IS A PROMISE, AND A READ FOLLOWED BY A WRITE CANNOT
  // KEEP IT.
  //
  // This is a check-then-act: `findByDate` says nothing exists, and only then
  // does `create` run. Two editors pressing "Start edition" in the same moment
  // - or one editor double-clicking a button that takes a second to answer -
  // both read nothing and both create one. The database then holds two papers
  // for one day and, as this project has already lived through, the desk
  // cannot find the one holding its work. Measured directly, eight overlapping
  // callers made EIGHT editions for one date; claimDate makes one. (Ten
  // concurrent HTTP requests did not trigger it - request setup staggers them
  // by more than the window. The window is narrow, not absent.)
  //
  // A transaction alone does not fix it: there is no row to lock when the
  // answer is "nothing exists". An advisory lock on the DATE gives the two
  // callers something to queue on, so the second one arrives after the first
  // has committed and takes the `existing` branch, which is the branch that
  // makes pressing the button twice harmless in the first place.
  //
  // Deliberately not a unique index: `POST /api/newspapers` is a separate,
  // non-idempotent create that this newsroom's tests and district editions
  // rely on, and a constraint would change what that route does. The lock
  // guards the promise the START route makes without altering anyone else's.
  const claim = await newspaperRepository.claimDate({
    name: body.name || identity.title,
    publicationDate: date,
    createdBy: sessionUser?.id || null,
  });
  const existing = claim.created ? null : claim.newspaper;

  if (existing) {
    const pages = await pageRepository.findByNewspaper(existing.id);

    // AN EDITION WITH NO PAGES IS NOT AN EDITION, AND OPENING ONE IS WORSE
    // THAN MAKING ONE.
    //
    // "Open the one that exists" is right when there is something to open.
    // A row can exist with no pages at all - an interrupted start, a create
    // through `POST /api/newspapers` (which makes the row and no ladder), a
    // page delete that took the last one - and the desk was then handed a
    // paper with no front page and nothing to write on. Verified live: on a
    // date carrying such a row, pressing Start answered
    // `created: false, pageCount: 0, ladder: 0 pages`.
    //
    // Falling through builds the ladder into the row that is already there,
    // so the date keeps its one edition and the desk gets a paper. It is the
    // repair the button already implies: a desk pressing "Start edition" is
    // asking for an edition it can work on.
    if (pages.length > 0) {
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
  }

  const newspaper = claim.newspaper;

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

  return {
    newspaper,
    created: claim.created,
    // A row that already existed but had no pages has been given them. The
    // desk is told which happened rather than being told a new paper was
    // made when the date's own edition was repaired.
    repaired: !claim.created,
    pageCount,
    ladder,
    carriedAdverts,
    features,
  };
}

module.exports = { startEdition, carryForwardAdverts, todayWhereWePrint };
