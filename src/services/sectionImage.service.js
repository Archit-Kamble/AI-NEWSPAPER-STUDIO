const pool = require('../config/db');
const repo = require('../repositories/sectionImage.repository');
const backgroundRemoval = require('./backgroundRemoval.service');

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

async function add(pageId, sectionKey, body, ownerId) {
  const section = await sectionRow(pageId, sectionKey);
  if (!section || !body.url) return null;

  const asset = await repo.findOrCreateAsset({
    url: body.url,
    filename: body.filename,
    mimeType: body.mimeType,
    ownerId,
  });

  // A new picture defaults to half the block's width, placed top-left, so it is
  // immediately visible and immediately draggable.
  const placement = clampToBlock(section, {
    x: body.x ?? 0,
    y: body.y ?? 0,
    width: body.width ?? Math.round(Number(section.width_px) / 2),
    height: body.height ?? Math.round(Number(section.height_px) / 3),
    shape: body.shape,
    standOffPx: body.standOffPx,
  });

  // A photograph arrives with its caption; it should not need a second call to
  // keep it.
  await repo.place(section.id, asset.id, { ...placement, caption: body.caption });
  return repo.listBySection(section.id);
}

async function move(pageId, sectionKey, imageId, body) {
  const section = await sectionRow(pageId, sectionKey);
  if (!section) return null;

  const patch = { ...body };
  if (body.x !== undefined || body.width !== undefined) {
    Object.assign(patch, clampToBlock(section, {
      x: body.x ?? 0,
      y: body.y ?? 0,
      width: body.width,
      height: body.height,
    }));
  }

  const updated = await repo.update(parseInt(imageId, 10), patch);
  if (!updated) return null;
  return repo.listBySection(section.id);
}

async function remove(pageId, sectionKey, imageId) {
  const section = await sectionRow(pageId, sectionKey);
  if (!section) return null;
  const removed = await repo.remove(parseInt(imageId, 10));
  if (!removed) return null;
  return repo.listBySection(section.id);
}

async function cutout(pageId, sectionKey, imageId, origin) {
  const section = await sectionRow(pageId, sectionKey);
  if (!section) return { error: 'Not found', status: 404 };

  const result = await backgroundRemoval.removeBackground(section.id, imageId, origin);
  if (result.error) return { error: result.error, status: 503 };
  return { images: await repo.listBySection(section.id) };
}

module.exports = { list, add, move, remove, cutout };
