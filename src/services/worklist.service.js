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

// The exact composition engine, from the one module that defines it - the
// same geometry the page canvas and the Block Editor measure against, real
// shaped Marathi advances and all. text-flow.js's character grid remains the
// fast, approximate planner (the editor's live-typing feedback still uses
// it), but a number the desk is TOLD - "this block holds N characters" - is a
// final-authority answer and has to come from the engine that actually knows,
// not the constant-based estimate that motivated building this one.
let composeModule = null;
async function compose() {
  if (!composeModule) composeModule = await import('../../public/editor/compose/section-adapter.js');
  return composeModule;
}
let metricsModule = null;
let shaperModule = null;
async function ensureComposeReady() {
  if (!metricsModule) metricsModule = await import('../../public/editor/compose/font-metrics.js');
  if (!shaperModule) shaperModule = await import('../../public/editor/compose/shaper.js');
  await Promise.all([metricsModule.ensureFontsLoaded(), shaperModule.ensureShaperReady()]);
  // The worklist quotes a capacity the desk writes to. A number from summed
  // hmtx advances because the shaper silently failed to load is not a
  // rougher version of the real number, it is a different one - loud
  // failure, not a quiet downgrade.
  shaperModule.requireShaperReady();
}

// What each kind of block is for, from the one module that defines it - the
// same words the editor now prints on the block itself. Never a second copy
// (see CLAUDE.md, and the template-key drift it describes).
let kindsModule = null;
async function blockKinds() {
  if (!kindsModule) kindsModule = await import('../../public/editor/layout/block-kinds.js');
  return kindsModule;
}

const has = (value) => Boolean(String(value ?? '').trim());

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

  await ensureComposeReady();
  const adapter = await compose();
  const kinds = await blockKinds();
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

    // How much copy the block holds, measured by the exact engine - real
    // shaped advances, the block's own headline/deck/photographs and all - so
    // the number quoted here is the number the block will actually enforce.
    //
    // Measured against the headline the block ALREADY has: a headline eats
    // lines out of the body's budget, so "how much copy fits" is only a real
    // answer once you know what is above it. `bodyCharRange.min` rather than
    // the practical figure: this is a number the desk is TOLD, and the safe
    // end of the range is the one that is never wrong (see compose.js).
    const composed = adapter.composeSection(
      { ...row, images: placements.get(row.id) || [] },
      {},
    );
    const capacity = composed.capacity.bodyCharRange.min;
    const written = (row.body || '').length;
    // Overset is asked of the engine directly rather than re-derived from the
    // character count: the range exists because a scalar comparison is only
    // ever approximate, but composing the block's REAL, already-written body
    // text is exact - it is the same geometry the page prints from.
    const trulyOverset = adapter.bodyOverset(composed);
    // Exact, not a subtraction against the safe-end estimate: the desk is
    // told precisely how many visible units have no room, the same count
    // diagnosticMarkup() shows on the canvas itself (render.js), because
    // "cut about N characters" only means something if N is real. Covers
    // both leftover text AND a single word too wide for the block (which
    // has no leftover at all - see bodyOversetChars()).
    const over = trulyOverset ? adapter.bodyOversetChars(composed) : 0;

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
        work: kinds.blockWork(row.block_type),
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
