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

let flowModule = null;
async function textFlow() {
  if (!flowModule) flowModule = await import('../../public/editor/layout/text-flow.js');
  return flowModule;
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
 * Measured on the one character grid, so the picture lands on the same rows the
 * grid will later say it occupies.
 */
async function copyStartsAt(section) {
  const { buildFlowMap } = await textFlow();
  const padding = Number(section.margin_px) || 12;
  const map = buildFlowMap(section, {
    headline: section.headline || '',
    subheading: section.subheading || '',
    body: '',
    marginPx: padding,
    columnCount: Number(section.column_count) || 1,
    lineHeight: Number(section.line_height) || 1.45,
    headlineFontPx: Number(section.headline_font_px) || 24,
    subheadingFontPx: Number(section.subheading_font_px) || 14,
    bodyFontPx: Number(section.body_font_px) || 10,
  }, []);
  return Math.round(padding + (map.headlineRows + map.subheadingRows) * map.cellHeight);
}

function clampToBlock(section, placement) {
  const maxW = Number(section.width_px);
  const maxH = Number(section.height_px);
  const width = Math.max(20, Math.min(Number(placement.width) || 120, maxW));
  const height = Math.max(20, Math.min(Number(placement.height) || 90, maxH));
  return {
    ...placement,
    width,
    height,
    x: Math.max(0, Math.min(Math.round(Number(placement.x) || 0), maxW - width)),
    y: Math.max(0, Math.min(Math.round(Number(placement.y) || 0), maxH - height)),
  };
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
  const placement = clampToBlock(section, {
    x: 0,
    y: await copyStartsAt(section),
    width: Math.round(Number(section.width_px) / 2),
    height: Math.round(Number(section.height_px) / 3),
  });
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
  });

  // A new picture defaults to half the block's width, at the left of the copy -
  // clear of the headline, and inside the text, so the runaround is real from
  // the moment it lands. It is still immediately visible and draggable.
  const placement = clampToBlock(section, {
    x: body.x ?? 0,
    y: body.y ?? (await copyStartsAt(section)),
    width: body.width ?? Math.round(Number(section.width_px) / 2),
    height: body.height ?? Math.round(Number(section.height_px) / 3),
    shape: body.shape,
    standOffPx: body.standOffPx,
  });

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

    Object.assign(patch, clampToBlock(section, {
      x: body.x ?? Number(current.x_px),
      y: body.y ?? Number(current.y_px),
      width: body.width ?? Number(current.width_px),
      height: body.height ?? Number(current.height_px),
    }));
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
