const pool = require('../config/db');

async function create(newspaper) {
  const { rows } = await pool.query(
    `INSERT INTO newspapers (name, template, publication_date, status, page_width_px, page_height_px, matter_width_px, matter_height_px, color_mode, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING *`,
    [newspaper.name, 'front', newspaper.publicationDate, 'draft', 660, 1060, 620, 1020, 'CMYK', newspaper.createdBy]
  );
  return rows[0];
}

// Editions newest first, and each one carrying the two numbers the desk judges
// it by: how many pages it has, and how many of its blocks have copy in them.
// A list that shows only a name and a status cannot tell a finished edition
// from an empty shell created by accident - which is exactly how 116 editions
// accumulated, most of them empty, with no way to see which held the work.
async function findAll() {
  const { rows } = await pool.query(
    `SELECT n.*,
            COUNT(DISTINCT p.id)::int AS page_count,
            COUNT(DISTINCT s.id) FILTER (
              WHERE COALESCE(s.headline, '') <> ''
                 OR COALESCE(s.body, '') <> ''
                 OR COALESCE(s.image_url, '') <> ''
            )::int AS filled_block_count,
            COUNT(DISTINCT s.id)::int AS block_count
     FROM newspapers n
     LEFT JOIN pages p ON p.newspaper_id = n.id
     LEFT JOIN page_sections s ON s.page_id = p.id
     GROUP BY n.id ORDER BY n.publication_date DESC, n.created_at DESC`
  );
  return rows;
}

// An e-paper release is deliberately separate from the newsroom / press
// status. A draft can be frozen as a web proof, while only an explicitly
// selected release is reachable from the public canonical URL.
async function findEpaperReleases() {
  const { rows } = await pool.query(
    `SELECT n.id, n.name, n.publication_date, n.district, n.status,
            n.epaper_released_at, n.epaper_selected, n.epaper_source
       FROM newspapers n
      WHERE n.epaper_released_at IS NOT NULL
      ORDER BY n.epaper_released_at DESC, n.publication_date DESC, n.id DESC`,
  );
  return rows;
}

async function findPublicEpaper() {
  const { rows } = await pool.query(
    `SELECT * FROM newspapers WHERE epaper_selected = TRUE AND epaper_released_at IS NOT NULL
      ORDER BY epaper_released_at DESC, id DESC LIMIT 1`,
  );
  return rows[0] || null;
}

async function selectPublicEpaper(id) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      `UPDATE newspapers SET epaper_selected = FALSE, updated_at = CURRENT_TIMESTAMP
        WHERE epaper_selected = TRUE AND id <> $1`,
      [id],
    );
    const { rows } = await client.query(
      `UPDATE newspapers SET epaper_selected = TRUE, updated_at = CURRENT_TIMESTAMP
        WHERE id = $1 AND epaper_released_at IS NOT NULL RETURNING *`,
      [id],
    );
    await client.query('COMMIT');
    return rows[0] || null;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

async function recordEpaperRelease(id, { source, selected = false } = {}) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    if (selected) {
      await client.query(
        `UPDATE newspapers SET epaper_selected = FALSE, updated_at = CURRENT_TIMESTAMP
          WHERE epaper_selected = TRUE AND id <> $1`,
        [id],
      );
    }
    const { rows } = await client.query(
      `UPDATE newspapers
          SET epaper_released_at = CURRENT_TIMESTAMP,
              epaper_selected = $2,
              epaper_source = COALESCE($3, epaper_source),
              updated_at = CURRENT_TIMESTAMP
        WHERE id = $1
        RETURNING *`,
      [id, selected, source || null],
    );
    await client.query('COMMIT');
    return rows[0] || null;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

async function clearEpaperRelease(id) {
  const { rows } = await pool.query(
    `UPDATE newspapers
        SET epaper_released_at = NULL, epaper_selected = FALSE, epaper_source = NULL,
            updated_at = CURRENT_TIMESTAMP
      WHERE id = $1 RETURNING *`,
    [id],
  );
  return rows[0] || null;
}

/**
 * The edition for one date - a paper is a singleton per date.
 *
 * District editions hang off a parent, so only the parent counts as "the"
 * edition for a date.
 *
 * Duplicates already exist in the database from before starting an edition was
 * idempotent, so this has to choose between them. It chooses the one with the
 * most work in it: when an editor says "today's paper" they mean the one they
 * have been filling, not whichever row was inserted first.
 */
async function findByDate(publicationDate) {
  const { rows } = await pool.query(
    `SELECT n.*,
            COUNT(DISTINCT s.id) FILTER (
              WHERE COALESCE(s.headline, '') <> '' OR COALESCE(s.body, '') <> ''
                 OR COALESCE(s.image_url, '') <> ''
            )::int AS filled_block_count,
            COUNT(DISTINCT p.id)::int AS page_count
     FROM newspapers n
     LEFT JOIN pages p ON p.newspaper_id = n.id
     LEFT JOIN page_sections s ON s.page_id = p.id
     WHERE n.publication_date = $1 AND n.parent_edition_id IS NULL
     GROUP BY n.id
     ORDER BY filled_block_count DESC, page_count DESC, n.created_at DESC
     LIMIT 1`,
    [publicationDate],
  );
  return rows[0] || null;
}

async function findAllByDate(publicationDate) {
  const { rows } = await pool.query(
    `SELECT n.*, COUNT(DISTINCT p.id)::int AS page_count
       FROM newspapers n LEFT JOIN pages p ON p.newspaper_id = n.id
      WHERE n.publication_date = $1 AND n.parent_edition_id IS NULL
      GROUP BY n.id ORDER BY n.created_at ASC`,
    [publicationDate],
  );
  return rows;
}

/** The most recent edition published before `publicationDate` - yesterday's paper. */
async function findPrevious(publicationDate) {
  const { rows } = await pool.query(
    `SELECT * FROM newspapers
     WHERE publication_date < $1 AND parent_edition_id IS NULL
     ORDER BY publication_date DESC, created_at DESC LIMIT 1`,
    [publicationDate],
  );
  return rows[0] || null;
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

module.exports = { create, findAll, findEpaperReleases, findPublicEpaper, selectPublicEpaper, recordEpaperRelease, clearEpaperRelease, findById, findByDate, findAllByDate, findPrevious, update };
