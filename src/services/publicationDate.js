// THE DATE ON PAGE ONE, CHECKED ONCE.
//
// A publication date is the edition's identity: the archive is indexed by it,
// `POST /api/newspapers/start` is idempotent per it, and the masthead prints
// it. It arrives from a browser, so it has to be checked - and it was not.
//
// `isoDate` was `String(value || '').slice(0, 10)`, which TRUNCATES and never
// validates. So every one of these went straight to PostgreSQL:
//
//   "not-a-date"   -> ten characters, passed through verbatim
//   "2099-13-45"   -> month 13, day 45
//   {}             -> "[object Ob"
//
// each answering `invalid input syntax for type date`, which the catch-all
// correctly reports as a 500 - the desk told "something went wrong on the
// server" for a date it typed. Swept across the two create routes that was
// the last 80 of 888 malformed requests answering 5xx.
//
// Rejecting is the right answer rather than falling back to today: a desk that
// asked for a particular day and silently got a different one would find the
// edition filed under a date nobody chose, which for an archive indexed by
// date is worse than being told the date was wrong.

const { identity } = require('../layout/identity');

/** Today where this paper is printed, not where the server happens to be. */
function todayWhereWePrint() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: identity.timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

/**
 * Whether this is a real calendar day, written the one way this paper writes
 * one.
 *
 * The round trip through `Date` is what catches 2099-13-45 and 2026-02-30:
 * the shape can be right while the day does not exist, and `Date` normalises a
 * non-existent day to a different one rather than refusing, so the only way to
 * know is to format it back and see whether it changed.
 */
function isCalendarDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const at = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(at.getTime())) return false;
  return at.toISOString().slice(0, 10) === value;
}

/**
 * The date an edition should carry, or why it cannot have one.
 *
 * Nothing supplied means today, which is what a desk starting the day's paper
 * means. Anything supplied has to be a real day.
 */
function publicationDateFrom(body = {}) {
  const requested = body.publicationDate ?? body.date;
  if (requested === undefined || requested === null || requested === '') {
    return { date: todayWhereWePrint() };
  }
  // A date-time is accepted and reduced to its day, because that is what
  // several callers already send and the column is a DATE.
  const asDay = typeof requested === 'string' ? requested.slice(0, 10) : requested;
  if (!isCalendarDate(asDay)) return { error: 'INVALID_PUBLICATION_DATE' };
  return { date: asDay };
}

module.exports = { todayWhereWePrint, isCalendarDate, publicationDateFrom };
