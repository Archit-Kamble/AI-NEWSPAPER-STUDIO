const pool = require('../config/db');

async function create(newspaper) {
  const { rows } = await pool.query(
    `INSERT INTO newspapers (name, template, publication_date, status, page_width_px, page_height_px, matter_width_px, matter_height_px, color_mode, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING *`,
    [newspaper.name, 'front', newspaper.publicationDate, 'draft', 660, 1060, 620, 1020, 'CMYK', newspaper.createdBy]
  );
  return rows[0];
}

async function findAll() {
  const { rows } = await pool.query(
    `SELECT n.*, COUNT(p.id)::int AS page_count
     FROM newspapers n LEFT JOIN pages p ON p.newspaper_id = n.id
     GROUP BY n.id ORDER BY n.created_at DESC`
  );
  return rows;
}

async function findById(id) {
  const { rows } = await pool.query('SELECT * FROM newspapers WHERE id = $1', [id]);
  return rows[0] || null;
}

async function update(id, updates) {
  const { rows } = await pool.query(
    `UPDATE newspapers SET name = COALESCE($2, name), status = COALESCE($3, status), updated_at = CURRENT_TIMESTAMP
     WHERE id = $1 RETURNING *`,
    [id, updates.name ?? null, updates.status ?? null]
  );
  return rows[0] || null;
}

module.exports = { create, findAll, findById, update };
