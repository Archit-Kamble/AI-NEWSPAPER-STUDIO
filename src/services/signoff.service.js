// Passing a page for press.
//
// A newspaper is not finished when the last block is filled; it is finished
// when a named person says so, at a known time, and it goes to plate. Until now
// an edition had a status of "draft" and nothing else - there was no way to say
// "page three is done", no record of who said it, and nothing standing between
// a half-made page and the press.
//
// Three things this adds, all of which a real desk already has on paper:
//
//   * a state for each page (being made up → subbed → passed for press)
//   * a check that preflight is clean before a page can be passed - the whole
//     point of preflight is that it runs before the plate, not after
//   * an audit trail, in edition_history, of who did what and when. On the day
//     something goes wrong in print, the first question is always "who passed
//     it", and the answer has to exist.

const pool = require('../config/db');
const preflight = require('./preflight.service');

// The states a page moves through, in order. Moving backwards is allowed - a
// page can be pulled back off the stone - but only one step at a time is
// sensible, and it is always recorded.
const STATES = ['making_up', 'subbed', 'passed'];
const LABELS = {
  making_up: 'Being made up',
  subbed: 'Subbed',
  passed: 'Passed for press',
};

async function record(newspaperId, actorId, action) {
  await pool.query(
    'INSERT INTO edition_history (newspaper_id, actor_id, action) VALUES ($1, $2, $3)',
    [newspaperId, actorId || null, action],
  );
}

/**
 * Moves a page to a new state.
 *
 * Passing for press is the one transition that is checked: preflight has to be
 * clean. Everything else is the desk's own judgement, and is simply recorded.
 */
async function setPageState(pageId, state, actor) {
  if (!STATES.includes(state)) return { error: `Not a state a page can be in: ${state}` };

  const { rows } = await pool.query(
    `SELECT p.*, n.id AS newspaper_id FROM pages p JOIN newspapers n ON n.id = p.newspaper_id WHERE p.id = $1`,
    [pageId],
  );
  const page = rows[0];
  if (!page) return null;

  if (state === 'passed') {
    const report = await preflight.checkEdition(page.newspaper_id);
    const onThisPage = report.findings.filter(
      (finding) => finding.pageNumber === page.page_number && finding.level === 'error',
    );
    if (onThisPage.length) {
      return {
        error: `Page ${page.page_number} cannot go to press with ${onThisPage.length} error${onThisPage.length === 1 ? '' : 's'} on it.`,
        findings: onThisPage,
      };
    }
  }

  const { rows: updated } = await pool.query(
    `UPDATE pages SET production_state = $2, state_changed_at = CURRENT_TIMESTAMP,
                      state_changed_by = $3, updated_at = CURRENT_TIMESTAMP
      WHERE id = $1 RETURNING *`,
    [pageId, state, actor?.id || null],
  );

  await record(page.newspaper_id, actor?.id, `page ${page.page_number}: ${LABELS[state]}`);
  return { ok: true, page: updated[0] };
}

/**
 * Where the edition stands: every page's state, and whether the whole paper can
 * go. An edition is ready when every page has been passed and preflight is
 * clean across all of them.
 */
async function editionStatus(newspaperId) {
  const { rows: papers } = await pool.query('SELECT * FROM newspapers WHERE id = $1', [newspaperId]);
  if (!papers[0]) return null;

  const { rows: pages } = await pool.query(
    `SELECT p.id, p.page_number, p.production_state, p.state_changed_at, u.name AS passed_by
       FROM pages p LEFT JOIN users u ON u.id = p.state_changed_by
      WHERE p.newspaper_id = $1 ORDER BY p.page_number`,
    [newspaperId],
  );

  const report = await preflight.checkEdition(newspaperId);
  const outstanding = pages.filter((page) => page.production_state !== 'passed');

  return {
    editionId: Number(newspaperId),
    pages: pages.map((page) => ({
      ...page,
      label: LABELS[page.production_state] || LABELS.making_up,
      errors: report.findings.filter((f) => f.pageNumber === page.page_number && f.level === 'error').length,
    })),
    preflight: { passed: report.passed, counts: report.counts },
    readyForPress: outstanding.length === 0 && report.passed,
    waitingOn: outstanding.map((page) => page.page_number),
  };
}

async function history(newspaperId, limit = 50) {
  const { rows } = await pool.query(
    `SELECT h.action, h.created_at, u.name AS actor
       FROM edition_history h LEFT JOIN users u ON u.id = h.actor_id
      WHERE h.newspaper_id = $1 ORDER BY h.created_at DESC LIMIT $2`,
    [newspaperId, limit],
  );
  return rows;
}

module.exports = { setPageState, editionStatus, history, record, STATES, LABELS };
