const pool = require('../config/db');
const repo = require('../repositories/sectionImage.repository');
const backgroundRemoval = require('./backgroundRemoval.service');
const reviewInvalidation = require('./reviewInvalidation.service');

// Placements are clamped to the block they belong to. A picture that hangs
// outside its block would be off the page in print, and the character grid
// would count cells that do not exist.
async function sectionRow(pageId, sectionKey) {
  const { rows } = await pool.query(
    'SELECT * FROM page_sections WHERE page_id = $1 AND section_key = $2',
    [parseInt(pageId, 10), sectionKey],
  );
  return rows[0] || null;
}

// The exact composition engine - the SAME module composeSection() the page
// canvas, the Block Editor, fit and preflight all measure against (see
// fit.service.js's own comment on why: "would this fit" and "does this fit"
// have to be the same question asked twice). This used to be measured on
// text-flow.js's approximate character grid, a second geometry truth that
// could - and did - disagree with what the block actually composes to.
let adapterModule = null;
let metricsModule = null;
let shaperModule = null;
let snapModule = null;
let kindsModule = null;
let intervalsModule = null;
async function ensureComposeReady() {
  if (!adapterModule) adapterModule = await import('../../public/editor/compose/section-adapter.js');
  if (!metricsModule) metricsModule = await import('../../public/editor/compose/font-metrics.js');
  if (!shaperModule) shaperModule = await import('../../public/editor/compose/shaper.js');
  await Promise.all([metricsModule.ensureFontsLoaded(), shaperModule.ensureShaperReady()]);
  // A picture's landing spot decides real page geometry. Placing it against
  // summed hmtx advances because the shaper silently failed to load would
  // land it somewhere a real composition never puts the body - loud failure
  // here, not a quiet downgrade.
  shaperModule.requireShaperReady();
  return adapterModule;
}

/**
 * Where the copy starts on this block, in block pixels.
 *
 * A picture used to land at the block's own top-left corner, which is where the
 * HEADLINE is set - so it covered the headline, and it took no room away from
 * the body at all: dropping a picture on a block changed the character budget
 * by nothing, which is the opposite of what this editor promises. Landing it at
 * the top of the body puts it in the copy, where a photograph on a news block
 * actually sits, and the budget moves the moment it lands.
 *
 * Composed with NO images and no body text - exactly the question "where
 * would the body start if nothing had been placed yet", which is what
 * deciding where to place the FIRST picture actually needs to know.
 */
async function copyStartsAt(section) {
  const adapter = await ensureComposeReady();
  const result = adapter.composeSection({ ...section, images: [] }, { ...section, body: '' });
  return Math.round(result.bodyTop);
}

function clampToBlock(section, placement) {
  const maxW = Number(section.width_px);
  const maxH = Number(section.height_px);
  // Rounded here, not left to the caller: section_images.width_px/height_px
  // are INTEGER columns, and the aspect-ratio lock above divides to derive
  // one dimension from the other - a plain fraction (e.g. 100 / (611/213))
  // reaches Postgres as "invalid input syntax for type integer" instead of a
  // resized picture. x/y were already rounded here; width/height never had
  // to be, because every existing caller already sent whole pixels.
  const width = Math.max(20, Math.min(Math.round(Number(placement.width)) || 120, maxW));
  const height = Math.max(20, Math.min(Math.round(Number(placement.height)) || 90, maxH));
  return {
    ...placement,
    width,
    height,
    x: Math.max(0, Math.min(Math.round(Number(placement.x) || 0), maxW - width)),
    y: Math.max(0, Math.min(Math.round(Number(placement.y) || 0), maxH - height)),
  };
}

/**
 * The nearest placement that leaves a column of type worth setting.
 *
 * A picture defaults to HALF the block's width at its left edge, and on a
 * narrow block in large type that is already the fault: 190px wide, 16px
 * type, a 95px picture, and the 81px strip left beside it is under the 96px
 * one word needs - so the block keeps its depth, keeps its copy, and sets not
 * one line of it. That is how the two NO_LEGAL_MEASURE blocks in this
 * database got there; nobody dragged them into it.
 *
 * Enforced here as well as in the editor's own drag (block-frame.js, via the
 * same corridor-snap.js), so a direct API caller cannot recreate the layout
 * the UI now refuses to make. See corridor-snap.js for the rule.
 */
async function snapPlacement(section, placement, images = []) {
  const adapter = await ensureComposeReady();
  if (!snapModule) snapModule = await import('../../public/editor/layout/corridor-snap.js');
  if (!kindsModule) kindsModule = await import('../../public/editor/layout/block-kinds.js');
  if (!intervalsModule) intervalsModule = await import('../../public/editor/compose/intervals.js');

  // Composed WITH the placement about to be made, and snapped only if the
  // engine says the block can then set nothing at all. A dead corridor on one
  // side of a picture is not a fault when the other side is a whole column -
  // that is an ordinary page - so the trigger is the block that is unprintable,
  // never a placement that is merely unusual.
  const proposed = [...images, {
    x_px: placement.x, y_px: placement.y, width_px: placement.width, height_px: placement.height,
    shape: placement.shape || 'rect', rotation: 0, stand_off_px: placement.standOffPx ?? 0,
  }];
  const withPicture = adapter.composeSection({ ...section, images: proposed }, {});
  if (!snapModule.leavesNoLegalColumn(withPicture)) return placement;

  // The frame the repair is measured against is the composition being
  // REPAIRED - the one that has this picture in it - not a second composition
  // of the same block without it. Those two do not always describe the same
  // frame: where the copy starts moves with the display type, and the display
  // type moves with the picture (a picture standing in the headline's bands
  // pushes it down, and a headline set larger to fill its measure yields that
  // size again the moment the copy oversets - compose.js). Snapping against
  // the picture-free frame put a full-measure picture at a `bodyTop` 12 px
  // lower than the block really had, which left it under one line of copy at
  // the foot and none at the top: a repair that did not repair, arrived at by
  // measuring the wrong block.
  if (!withPicture.content) return placement;
  const snapped = snapModule.snapPictureToLegalCorridor(
    { x: placement.x, y: placement.y, width: placement.width, height: placement.height },
    {
      contentLeft: withPicture.content.left,
      contentRight: withPicture.content.right,
      standOffPx: Number(placement.standOffPx ?? section.stand_off_px) || 0,
      minCorridorPx: intervalsModule.MIN_CORRIDOR_EM * (withPicture.typography?.bodyPx || 0),
      columnCount: withPicture.columns?.length || 1,
      bodyTop: withPicture.bodyTop,
      bodyBottom: withPicture.content.bottom,
      bandHeightPx: (withPicture.typography?.bodyPx || 0) * (withPicture.typography?.lineHeight || 0),
      expectsCopy: kindsModule.blockExpectsCopy(section.block_type),
    },
  );
  if (!snapped.snapped) return placement;
  return clampToBlock(section, { ...placement, x: snapped.x, y: snapped.y, width: snapped.width, height: snapped.height });
}

async function list(pageId, sectionKey) {
  const section = await sectionRow(pageId, sectionKey);
  if (!section) return null;
  return repo.listBySection(section.id);
}

// A reporter's auto-filled photo (page_sections.image_url - "Take from
// Reporter" sets it from story.image_urls[0], section-model.js) and a desk's
// own placed pictures (section_images, this table) are two independent
// fields. The moment section_images gains its first row, sectionInnerHtml()
// switches the block over to the flowed/canvas renderer entirely and
// image_url is never drawn again - the reporter's photo silently vanishes
// from the page, with no warning, while the block still shows its "linked to
// reporter" flag. Found live against a real block, not assumed (see
// PROJECT_STATUS.md, PROJECT A audit). Converting it into the first
// section_images row here, at the one moment that would otherwise orphan it,
// loses nothing - it becomes an ordinary placed picture, still visible, now
// draggable exactly like one the desk added directly.
async function carryForwardAutoFilledImage(section, ownerId) {
  if (!section.image_url) return;
  const existing = await repo.listBySection(section.id);
  if (existing.length) return;

  const asset = await repo.findOrCreateAsset({ url: section.image_url, filename: null, mimeType: null, ownerId });
  const placement = await snapPlacement(section, clampToBlock(section, {
    x: 0,
    y: await copyStartsAt(section),
    width: Math.round(Number(section.width_px) / 2),
    height: Math.round(Number(section.height_px) / 3),
  }));
  await repo.place(section.id, asset.id, placement);
  await pool.query('UPDATE page_sections SET image_url = NULL WHERE id = $1', [section.id]);
}

async function add(pageId, sectionKey, body, ownerId) {
  const section = await sectionRow(pageId, sectionKey);
  if (!section || !body.url) return null;

  await carryForwardAutoFilledImage(section, ownerId);

  const asset = await repo.findOrCreateAsset({
    url: body.url,
    filename: body.filename,
    mimeType: body.mimeType,
    ownerId,
    // The browser already measured the file it just uploaded
    // (naturalWidth/naturalHeight) - kept on media_assets, the source's own
    // record, never on section_images, which is the placement frame.
    width: body.sourceWidth,
    height: body.sourceHeight,
  });

  // A new picture defaults to half the block's width, at the left of the copy -
  // clear of the headline, and inside the text, so the runaround is real from
  // the moment it lands. It is still immediately visible and draggable.
  const placement = await snapPlacement(section, clampToBlock(section, {
    x: body.x ?? 0,
    y: body.y ?? (await copyStartsAt(section)),
    width: body.width ?? Math.round(Number(section.width_px) / 2),
    height: body.height ?? Math.round(Number(section.height_px) / 3),
    shape: body.shape,
    standOffPx: body.standOffPx,
    fitMode: body.fitMode,
  }));

  // A photograph arrives with its caption; it should not need a second call to
  // keep it.
  await repo.place(section.id, asset.id, { ...placement, caption: body.caption });
  await reviewInvalidation.revokeSection(section.id);
  return repo.listBySection(section.id);
}

async function move(pageId, sectionKey, imageId, body) {
  const section = await sectionRow(pageId, sectionKey);
  if (!section) return null;

  const patch = { ...body };
  if (['x', 'y', 'width', 'height'].some((key) => body[key] !== undefined)) {
    // Against what the picture IS, not against zero. A patch that only changes
    // the size - which is what "Bigger" and "Smaller" send - used to fall back
    // to x: 0, y: 0, so making a picture slightly larger also threw it into the
    // top-left corner of the block, away from the copy it had been placed in.
    const current = (await repo.listBySection(section.id))
      .find((image) => image.id === parseInt(imageId, 10));
    if (!current) return null;

    let width = body.width ?? Number(current.width_px);
    let height = body.height ?? Number(current.height_px);

    // A cut-out is trimmed to one exact silhouette - stretching it just
    // strands its own resize handles away from the visible person and
    // leaves dead frame around them (found live, this exact way: a manual
    // resize call widened a cut-out's frame without its height, and the
    // handles ended up a third of the frame's width from anything visible).
    // Enforced here, not only in the editor's own drag handler
    // (block-frame.js), so a direct API caller cannot recreate the same bug
    // the UI now refuses to.
    //
    // The ratio is read from the SOURCE photograph's own natural dimensions
    // (media_assets.width_px/height_px, joined in as source_width_px/
    // source_height_px - see sectionImage.repository.js's own note on why
    // that pair, never the placement frame's, is the source's real shape),
    // not from the current frame - a frame already stretched crooked (by an
    // earlier call, before this guarantee existed) would otherwise just lock
    // in its own wrong ratio forever, unable to self-correct.
    if (current.shape === 'cutout') {
      const sourceWidth = Number(current.source_width_px) || Number(current.width_px) || 1;
      const sourceHeight = Number(current.source_height_px) || Number(current.height_px) || 1;
      const ratio = sourceHeight / sourceWidth;
      if (body.width !== undefined && body.height === undefined) height = width * ratio;
      else if (body.height !== undefined && body.width === undefined) width = height / ratio;
      else if (body.width !== undefined && body.height !== undefined) height = width * ratio;
    }

    // Snapped against the block WITHOUT this picture in it, so the rule is
    // measured against the measure the copy would have, not against the
    // corridor the picture being moved is itself creating.
    const others = (await repo.listBySection(section.id)).filter((image) => image.id !== parseInt(imageId, 10));
    Object.assign(patch, await snapPlacement(section, clampToBlock(section, {
      x: body.x ?? Number(current.x_px),
      y: body.y ?? Number(current.y_px),
      width,
      height,
    }), others));
  }

  const updated = await repo.update(parseInt(imageId, 10), patch);
  if (!updated) return null;
  await reviewInvalidation.revokeSection(section.id);
  return repo.listBySection(section.id);
}

async function remove(pageId, sectionKey, imageId) {
  const section = await sectionRow(pageId, sectionKey);
  if (!section) return null;
  const removed = await repo.remove(parseInt(imageId, 10));
  if (!removed) return null;
  await reviewInvalidation.revokeSection(section.id);
  return repo.listBySection(section.id);
}

async function cutout(pageId, sectionKey, imageId, origin) {
  const section = await sectionRow(pageId, sectionKey);
  if (!section) return { error: 'Not found', status: 404 };

  const result = await backgroundRemoval.removeBackground(section.id, imageId, origin);
  if (result.error) return { error: result.error, status: 503 };
  await reviewInvalidation.revokeSection(section.id);
  return { images: await repo.listBySection(section.id) };
}

module.exports = { list, add, move, remove, cutout };
