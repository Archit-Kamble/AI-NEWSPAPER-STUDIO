const pool = require('../config/db');

// Pictures placed inside one editorial block.
//
// A block can hold several - a cut-out of a person over the copy, a supporting
// photograph below it - each at its own position, size and shape. Where each
// one sits is what the character grid is computed from, so this is layout data,
// not just an attachment list.

async function listBySection(sectionId, { tx } = {}) {
  const db = tx || pool; const { rows } = await db.query(
    `SELECT si.*, ma.url, ma.original_filename, ma.background_status
       FROM section_images si
       JOIN media_assets ma ON ma.id = si.media_asset_id
      WHERE si.page_section_id = $1
      ORDER BY si.z_index, si.id`,
    [sectionId],
  );
  return rows;
}

// An uploaded file becomes a reusable asset, so the same photograph can be
// placed in more than one block without being uploaded twice.
async function findOrCreateAsset({ url, filename, mimeType, ownerId }, { tx } = {}) {
  const db = tx || pool; const { rows: existing } = await db.query('SELECT * FROM media_assets WHERE url = $1', [url]);
  if (existing[0]) return existing[0];

  const { rows } = await db.query(
    `INSERT INTO media_assets (original_filename, storage_path, mime_type, owner_id, url)
     VALUES ($1, $2, $3, $4, $5) RETURNING *`,
    [filename || url.split('/').pop(), url, mimeType || 'image/jpeg', ownerId || null, url],
  );
  return rows[0];
}

async function place(sectionId, assetId, placement, { tx } = {}) {
  const db = tx || pool; const { rows: z } = await db.query(
    'SELECT COALESCE(MAX(z_index), 0) + 1 AS z FROM section_images WHERE page_section_id = $1',
    [sectionId],
  );
  const { rows } = await db.query(
    `INSERT INTO section_images
       (page_section_id, media_asset_id, x_px, y_px, width_px, height_px, shape, stand_off_px, z_index, caption, source_news_item_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
     ON CONFLICT (page_section_id, media_asset_id)
     DO UPDATE SET x_px = EXCLUDED.x_px, y_px = EXCLUDED.y_px,
                   width_px = EXCLUDED.width_px, height_px = EXCLUDED.height_px,
                   caption = COALESCE(EXCLUDED.caption, section_images.caption),
                   source_news_item_id = COALESCE(EXCLUDED.source_news_item_id, section_images.source_news_item_id)
     RETURNING *`,
    [sectionId, assetId, placement.x, placement.y, placement.width, placement.height,
     placement.shape || 'rect', placement.standOffPx ?? 6, z[0].z, placement.caption || null,
     placement.sourceNewsItemId || null],
  );
  return rows[0];
}

async function placePrepared(intent, { tx } = {}) {
  const image = intent.image; const asset = await findOrCreateAsset({ url: image.url, filename: image.filename, mimeType: image.mimeType, ownerId: null }, { tx });
  return place(intent.destinationSectionId, asset.id, { ...intent.placement, caption: intent.placement.caption || image.caption || null, sourceNewsItemId: intent.sourceNewsItemId || null }, { tx });
}

async function linkSectionSource(sectionId, sourceNewsItemId, { tx } = {}) {
  const db = tx || pool;
  const { rows } = await db.query('UPDATE page_sections SET news_item_id = $2 WHERE id = $1 RETURNING *', [sectionId, sourceNewsItemId]);
  return rows[0] || null;
}

async function update(imageId, patch) {
  const { rows } = await pool.query(
    `UPDATE section_images
        SET x_px = COALESCE($2, x_px), y_px = COALESCE($3, y_px),
            width_px = COALESCE($4, width_px), height_px = COALESCE($5, height_px),
            rotation = COALESCE($6, rotation), flip_h = COALESCE($7, flip_h),
            flip_v = COALESCE($8, flip_v), shape = COALESCE($9, shape),
            stand_off_px = COALESCE($10, stand_off_px), caption = COALESCE($11, caption),
            crop_x_px = COALESCE($12, crop_x_px), crop_y_px = COALESCE($13, crop_y_px),
            crop_width_px = COALESCE($14, crop_width_px), crop_height_px = COALESCE($15, crop_height_px),
            mask = COALESCE($16, mask), z_index = COALESCE($17, z_index)
      WHERE id = $1 RETURNING *`,
    [imageId, patch.x, patch.y, patch.width, patch.height, patch.rotation,
     patch.flipH, patch.flipV, patch.shape, patch.standOffPx, patch.caption,
     patch.cropX, patch.cropY, patch.cropWidth, patch.cropHeight,
     patch.mask ? JSON.stringify(patch.mask) : null, patch.zIndex],
  );
  return rows[0] || null;
}

// Swaps which picture a placement points at, keeping its position and shape.
// Used when a cut-out replaces the original photograph.
async function replaceAsset(imageId, assetId) {
  const { rows } = await pool.query(
    'UPDATE section_images SET media_asset_id = $2 WHERE id = $1 RETURNING *',
    [imageId, assetId],
  );
  return rows[0] || null;
}

async function remove(imageId) {
  const { rowCount } = await pool.query('DELETE FROM section_images WHERE id = $1', [imageId]);
  return rowCount > 0;
}

/**
 * Every placement in one edition, grouped by the block it sits on.
 *
 * The worklist measures every block of a paper in one pass, and asking for each
 * block's pictures one block at a time would be a query per block. The media
 * asset is not joined: this answers "what is placed and where", which is what
 * the character grid needs.
 */
async function placementsByEdition(newspaperId) {
  const { rows } = await pool.query(
    `SELECT si.page_section_id, si.x_px, si.y_px, si.width_px, si.height_px,
            si.rotation, si.shape, si.stand_off_px, si.mask
       FROM section_images si
       JOIN page_sections s ON s.id = si.page_section_id
       JOIN pages p ON p.id = s.page_id
      WHERE p.newspaper_id = $1
      ORDER BY si.z_index, si.id`,
    [newspaperId],
  );

  const bySection = new Map();
  for (const row of rows) {
    if (!bySection.has(row.page_section_id)) bySection.set(row.page_section_id, []);
    bySection.get(row.page_section_id).push(row);
  }
  return bySection;
}

module.exports = { listBySection, placementsByEdition, findOrCreateAsset, place, placePrepared, linkSectionSource, update, remove, replaceAsset };
