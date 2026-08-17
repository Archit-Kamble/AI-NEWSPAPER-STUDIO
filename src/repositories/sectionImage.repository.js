const pool = require('../config/db');

// Pictures placed inside one editorial block.
//
// A block can hold several - a cut-out of a person over the copy, a supporting
// photograph below it - each at its own position, size and shape. Where each
// one sits is what the character grid is computed from, so this is layout data,
// not just an attachment list.

async function listBySection(sectionId, { tx } = {}) {
  const db = tx || pool; const { rows } = await db.query(
    // `si.width_px/height_px` is the PLACEMENT frame; `ma.width_px/height_px`
    // (aliased, never sharing the bare name) is the SOURCE photograph's own
    // natural size - image-geometry.js needs both, and never the same one
    // twice under one name, or a caller reading `.width_px` off this row
    // cannot tell which one it got.
    `SELECT si.*, ma.url, ma.original_filename, ma.background_status,
            ma.width_px AS source_width_px, ma.height_px AS source_height_px
       FROM section_images si
       JOIN media_assets ma ON ma.id = si.media_asset_id
      WHERE si.page_section_id = $1
      ORDER BY si.z_index, si.id`,
    [sectionId],
  );
  return rows;
}

// An uploaded file becomes a reusable asset, so the same photograph can be
// placed in more than one block without being uploaded twice. `width`/
// `height` are the source's own natural pixels (the browser's naturalWidth/
// naturalHeight on upload, a composition intent's already-known dimensions,
// or a cutout's own written PNG size) - never the placement frame, which is
// section_images' concern, not media_assets'.
async function findOrCreateAsset({ url, filename, mimeType, ownerId, width, height }, { tx } = {}) {
  const db = tx || pool; const { rows: existing } = await db.query('SELECT * FROM media_assets WHERE url = $1', [url]);
  if (existing[0]) {
    // Backfill only what is genuinely missing - an asset already carrying
    // real dimensions is never overwritten by a caller that does not
    // happen to know them (findOrCreateAsset is called from several paths,
    // not all of which measure the source).
    if ((!existing[0].width_px || !existing[0].height_px) && Number(width) > 0 && Number(height) > 0) {
      return updateAssetDimensions(existing[0].id, Number(width), Number(height), { tx });
    }
    return existing[0];
  }

  const { rows } = await db.query(
    `INSERT INTO media_assets (original_filename, storage_path, mime_type, owner_id, url, width_px, height_px)
     VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
    [filename || url.split('/').pop(), url, mimeType || 'image/jpeg', ownerId || null, url,
     Number(width) > 0 ? Number(width) : null, Number(height) > 0 ? Number(height) : null],
  );
  return rows[0];
}

async function updateAssetDimensions(assetId, width, height, { tx } = {}) {
  const db = tx || pool;
  const { rows } = await db.query(
    'UPDATE media_assets SET width_px = $2, height_px = $3 WHERE id = $1 RETURNING *',
    [assetId, width, height],
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
       (page_section_id, media_asset_id, x_px, y_px, width_px, height_px, shape, stand_off_px, z_index, caption, source_news_item_id, fit_mode)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, COALESCE($12, 'contain'))
     ON CONFLICT (page_section_id, media_asset_id)
     DO UPDATE SET x_px = EXCLUDED.x_px, y_px = EXCLUDED.y_px,
                   width_px = EXCLUDED.width_px, height_px = EXCLUDED.height_px,
                   caption = COALESCE(EXCLUDED.caption, section_images.caption),
                   source_news_item_id = COALESCE(EXCLUDED.source_news_item_id, section_images.source_news_item_id),
                   -- $12 (the raw, possibly-null argument), not EXCLUDED.fit_mode:
                   -- EXCLUDED.fit_mode is already the INSERT's own
                   -- COALESCE(..., 'contain') and would silently reset an
                   -- existing row's real fit_mode back to 'contain' on
                   -- every re-place that does not explicitly ask to change it.
                   fit_mode = CASE WHEN $12 IS NOT NULL THEN $12 ELSE section_images.fit_mode END
     RETURNING *`,
    [sectionId, assetId, placement.x, placement.y, placement.width, placement.height,
     placement.shape || 'rect', placement.standOffPx ?? 6, z[0].z, placement.caption || null,
     placement.sourceNewsItemId || null, placement.fitMode || null],
  );
  return rows[0];
}

async function placePrepared(intent, { tx } = {}) {
  const image = intent.image;
  const asset = await findOrCreateAsset(
    { url: image.url, filename: image.filename, mimeType: image.mimeType, ownerId: null, width: image.width, height: image.height },
    { tx },
  );
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
            mask = COALESCE($16, mask), z_index = COALESCE($17, z_index),
            fit_mode = COALESCE($18, fit_mode)
      WHERE id = $1 RETURNING *`,
    [imageId, patch.x, patch.y, patch.width, patch.height, patch.rotation,
     patch.flipH, patch.flipV, patch.shape, patch.standOffPx, patch.caption,
     patch.cropX, patch.cropY, patch.cropWidth, patch.cropHeight,
     patch.mask ? JSON.stringify(patch.mask) : null, patch.zIndex, patch.fitMode],
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
 * block's pictures one block at a time would be a query per block.
 *
 * `media_assets` IS now joined, for its source width/height - a cutout's
 * exclusion is resolved through image-geometry.js's contain/cover/stretch
 * fit math (exclusion.js), which needs the source's own natural dimensions
 * to know what a mask cell's source-pixel coordinates mean. Omitting them
 * used to fall back to the placement frame's own size (imageInput()'s
 * "no known natural size" default), silently assuming a 1:1 aspect ratio
 * match between source and frame that Phase E's independent resize or a
 * non-'contain' fit mode can break - the worklist's character budget could
 * then disagree with what the browser actually composes for the same
 * block. Crop and flip are included for the same reason: they are read by
 * the same resolver.
 */
async function placementsByEdition(newspaperId) {
  const { rows } = await pool.query(
    `SELECT si.id, si.page_section_id, si.x_px, si.y_px, si.width_px, si.height_px,
            si.crop_x_px, si.crop_y_px, si.crop_width_px, si.crop_height_px,
            si.rotation, si.flip_h, si.flip_v,
            si.shape, si.stand_off_px, si.mask, si.fit_mode,
            ma.width_px AS source_width_px, ma.height_px AS source_height_px
       FROM section_images si
       JOIN media_assets ma ON ma.id = si.media_asset_id
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

module.exports = {
  listBySection, placementsByEdition, findOrCreateAsset, updateAssetDimensions,
  place, placePrepared, linkSectionSource, update, remove, replaceAsset,
};
