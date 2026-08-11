const pool = require('../config/db');

// A ruler guide, placed on a page. Mirrors sectionImage.repository.js's own
// shape - list/create/update/remove over one owning parent - because a guide
// is the same kind of thing an image placement is: a positioned row attached
// to something bigger, read back as a list.

async function listByPage(pageId) {
  const { rows } = await pool.query(
    'SELECT * FROM page_guides WHERE page_id = $1 ORDER BY orientation, position_px',
    [pageId],
  );
  return rows;
}

async function create(pageId, orientation, positionPx) {
  const { rows } = await pool.query(
    `INSERT INTO page_guides (page_id, orientation, position_px) VALUES ($1, $2, $3) RETURNING *`,
    [pageId, orientation, positionPx],
  );
  return rows[0];
}

async function findById(guideId) {
  const { rows } = await pool.query('SELECT * FROM page_guides WHERE id = $1', [guideId]);
  return rows[0] || null;
}

async function updatePosition(guideId, positionPx) {
  const { rows } = await pool.query(
    `UPDATE page_guides SET position_px = $2, updated_at = CURRENT_TIMESTAMP WHERE id = $1 RETURNING *`,
    [guideId, positionPx],
  );
  return rows[0] || null;
}

async function remove(guideId) {
  const { rowCount } = await pool.query('DELETE FROM page_guides WHERE id = $1', [guideId]);
  return rowCount > 0;
}

module.exports = { listByPage, create, findById, updatePosition, remove };
