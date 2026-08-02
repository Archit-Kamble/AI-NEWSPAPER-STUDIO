const pool = require('../config/db');

async function save(newspaperId, fileType, storagePath, uploadedBy) {
  const { rows } = await pool.query(
    `INSERT INTO publication_files (newspaper_id, file_type, storage_path, uploaded_by)
     VALUES ($1, $2, $3, $4) RETURNING *`,
    [newspaperId, fileType, storagePath, uploadedBy || null]
  );
  return rows[0];
}

async function latestByNewspaper(newspaperId) {
  const { rows } = await pool.query(
    `SELECT DISTINCT ON (file_type) file_type, storage_path, created_at
     FROM publication_files WHERE newspaper_id = $1
     ORDER BY file_type, created_at DESC`,
    [newspaperId]
  );
  return rows;
}

module.exports = { save, latestByNewspaper };
