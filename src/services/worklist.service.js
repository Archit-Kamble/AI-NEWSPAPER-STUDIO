// What this edition still needs.
//
// The one question a night desk asks over and over — "what is left?" — and the
// only way to answer it was to click through every block of every page. A
// four-page paper is forty-four blocks; an eight-page paper is close to a
// hundred. Nobody holds that in their head, so pages go to press with a box
// still empty and it is found on the plate.
//
// Everything needed to answer it is already known and nothing new has to be
// stored. Each block records what it is (article, advert, photo, feature), what
// is in it, and its exact size; the character grid turns that size into the
// number of characters it holds. So the worklist is a read: every block that is
// not finished, in page order, with the measurement a sub-editor would ask for
// before writing a word — "how long should this be?"
//
// That last number is the point. Copy was being written and only then measured,
// which is why three of the first forty blocks of a test edition ran over. The
// budget is knowable before the first keystroke, and this is where it is said.

const pool = require('../config/db');
const sectionImages = require('../repositories/sectionImage.repository');

// The character grid, from the one module that defines it - the same numbers
// the editor uses on every keystroke. Never a second copy (see CLAUDE.md).
let flowModule = null;
async function textFlow() {
  if (!flowModule) flowModule = await import('../../public/editor/layout/text-flow.js');
  return flowModule;
}

const has = (value) => Boolean(String(value ?? '').trim());

// What kind of work a block represents, in the words a desk uses. An advert
// slot is not "an unwritten story" - it is space the advertising side sells,
// and a night editor should not be looking at it as copy to write.
const WORK = {
  article: 'copy to write',
  briefs: 'briefs to gather',
  photo: 'a photograph to place',
  advert: 'advertising space',
  feature: 'a standing feature',
};

function stateOf(section) {
  const wantsPicture = section.block_type === 'photo';
  const hasPicture = has(section.image_url) || Number(section.image_count) > 0;
  const hasCopy = has(section.headline) || has(section.body);

  if (wantsPicture) {
    if (!hasPicture) return 'empty';
    return has(section.caption) ? 'done' : 'needs-caption';
  }
  if (!hasCopy) return 'empty';
  if (section.status === 'ready' || section.status === 'approved') return 'done';
  return 'started';
}

/**
 * The worklist for one edition.
 *
 * Returns the pages in order, each with its blocks that are not finished, and
 * a count the desk can read at a glance.
 */
async function forEdition(newspaperId) {
  const { rows: papers } = await pool.query(
    'SELECT id, name, publication_date FROM newspapers WHERE id = $1',
    [newspaperId],
  );
  if (!papers.length) return null;

  const { rows } = await pool.query(
    `SELECT p.id AS page_id, p.page_number, p.template_key, p.production_state,
            s.id, s.section_key, s.block_type, s.feature_key, s.status,
            s.headline, s.subheading, s.body, s.caption, s.image_url,
            s.width_px, s.height_px, s.margin_px, s.line_height,
            s.headline_font_px, s.subheading_font_px, s.body_font_px,
            (SELECT COUNT(*)::int FROM section_images si WHERE si.page_section_id = s.id) AS image_count
       FROM pages p
       JOIN page_sections s ON s.page_id = p.id
      WHERE p.newspaper_id = $1
      ORDER BY p.page_number, s.y_px, s.x_px`,
    [newspaperId],
  );

  // The pictures, because a block that carries a photograph does not hold as
  // many characters as its box suggests. This measured with no pictures at all
  // and quoted the whole box - so "what is left?" told the desk a block with a
  // half-page photograph on it had room for copy that could never be set there.
  // Every other measurement in this software (fit, jump, preflight, the AI
  // brief) already passes its pictures; this one did not.
  const placements = await sectionImages.placementsByEdition(newspaperId);

  const flow = await textFlow();
  const pages = new Map();
  const totals = { blocks: 0, done: 0, empty: 0, started: 0, needsCaption: 0, charactersWanted: 0 };

  for (const row of rows) {
    if (!pages.has(row.page_number)) {
      pages.set(row.page_number, {
        pageNumber: row.page_number,
        pageId: row.page_id,
        templateKey: row.template_key,
        productionState: row.production_state,
        blocks: [],
        remaining: 0,
      });
    }
    const page = pages.get(row.page_number);
    const state = stateOf(row);

    // How much copy the block holds, measured by the same character grid the
    // editor uses on every keystroke - so the number quoted here is the number
    // the block will actually enforce.
    //
    // Measured against the headline the block ALREADY has: a headline eats
    // lines out of the body's budget, so "how much copy fits" is only a real
    // answer once you know what is above it.
    const map = flow.buildFlowMap(
      { width_px: row.width_px, height_px: row.height_px },
      {
        marginPx: Number(row.margin_px) || 12,
        lineHeight: Number(row.line_height) || 1.25,
        headline: row.headline || '',
        headlineFontPx: Number(row.headline_font_px),
        subheading: row.subheading || '',
        subheadingFontPx: Number(row.subheading_font_px),
        body: row.body || '',
        bodyFontPx: Number(row.body_font_px),
      },
      (placements.get(row.id) || []).map(flow.flowImageFromRow),
    );
    const capacity = map.bodyCharBudget;
    const written = (row.body || '').length;
    const over = Math.max(0, written - capacity);

    totals.blocks += 1;
    if (state === 'done') totals.done += 1;
    if (state === 'empty') { totals.empty += 1; if (capacity) totals.charactersWanted += capacity; }
    if (state === 'started') totals.started += 1;
    if (state === 'needs-caption') totals.needsCaption += 1;
    if (over > 0) totals.overset = (totals.overset || 0) + 1;

    // A block that is otherwise finished but overset is still work: it will not
    // print as written. It belongs on the list.
    if (state !== 'done' || over > 0) {
      page.remaining += 1;
      page.blocks.push({
        pageId: row.page_id,
        pageNumber: row.page_number,
        sectionKey: row.section_key,
        blockType: row.block_type,
        featureKey: row.feature_key,
        work: WORK[row.block_type] || 'copy to write',
        state: over > 0 && state === 'done' ? 'overset' : state,
        headline: row.headline || '',
        widthPx: row.width_px,
        heightPx: row.height_px,
        capacity,
        written,
        over,
      });
    }
  }

  return {
    newspaper: papers[0],
    totals,
    pages: [...pages.values()].sort((a, b) => a.pageNumber - b.pageNumber),
  };
}

module.exports = { forEdition };
