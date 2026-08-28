const pool = require('../config/db');

async function create(newspaper) {
  const { rows } = await pool.query(
    `INSERT INTO newspapers (name, template, publication_date, status, page_width_px, page_height_px, matter_width_px, matter_height_px, color_mode, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING *`,
    [newspaper.name, 'front', newspaper.publicationDate, 'draft', 660, 1060, 620, 1020, 'CMYK', newspaper.createdBy]
  );
  return rows[0];
}

// THE EDITION FOR A DATE, asked the same way wherever it is asked.
//
// `findByDate` reads it through the pool; `claimDate` has to read it on its
// own client, inside the transaction holding the date's lock. Two copies of
// this SELECT would be two answers to "which edition is this date's" the
// moment either was touched - the duplicated-SQL fault this project already
// names - so the query is written once and both run it.
const EDITION_FOR_DATE_SQL = `SELECT n.*,
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
   LIMIT 1`;

// CLAIMING A DATE: THE CHECK AND THE CREATE, ON ONE CONNECTION, UNDER A LOCK.
//
// `findByDate` then `create` is a check-then-act. Two editors pressing "Start
// edition" together - or one double-clicking a button that takes a second to
// answer - both read nothing and both insert, and the newsroom ends up with
// two papers for one day. This project has already lived through the version
// of that where the desk could not find the edition holding its work.
//
// The lock has to be an ADVISORY one because there is no row to lock when the
// answer is "nothing exists yet", and it has to be `_xact_` and taken on a
// dedicated client, because the pool hands out a different connection per
// query - a session-scoped lock taken here could be released on a connection
// that never held it, or never released at all. One client, one transaction:
// lock the date, look, insert if it is genuinely free, commit.
//
// `hashtext` maps the date to the bigint the advisory lock space uses. A
// collision between two different dates would only ever make one wait briefly
// for the other, which is harmless.
async function claimDate(newspaper) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [String(newspaper.publicationDate)]);

    const { rows: found } = await client.query(EDITION_FOR_DATE_SQL, [newspaper.publicationDate]);
    if (found[0]) {
      await client.query('COMMIT');
      return { newspaper: found[0], created: false };
    }

    const { rows } = await client.query(
      `INSERT INTO newspapers (name, template, publication_date, status, page_width_px, page_height_px, matter_width_px, matter_height_px, color_mode, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING *`,
      [newspaper.name, 'front', newspaper.publicationDate, 'draft', 660, 1060, 620, 1020, 'CMYK', newspaper.createdBy],
    );
    await client.query('COMMIT');
    return { newspaper: rows[0], created: true };
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
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
  const { rows } = await pool.query(EDITION_FOR_DATE_SQL, [publicationDate]);
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

/**
 * The paper's own house style: the two faces and whether it rules its gutters.
 *
 * A DEFAULT, NOT AN OVERRIDE. A face is written down onto the edition's blocks
 * only where the block has not chosen one itself (`font_family IS NULL`), so a
 * sub-editor who deliberately set one block in Khand keeps it when the paper
 * is set in Mukta. Silently overwriting a person's explicit decision is the
 * same fault as the AI overwriting reporter copy, in different clothes.
 *
 * Written down rather than cascaded at read time on purpose. The alternative -
 * a fallback resolved wherever a block is composed - would have to be threaded
 * through every one of the thirty-odd services that compose a stored row, and
 * any one of them that forgot would measure the block in one face and print it
 * in another. One value per block, on the block, is what the rest of this
 * system already relies on.
 */
async function setHouseStyle(id, { bodyFamily, displayFamily, columnRules }) {
  // THE FACE THE PAPER WAS SET IN BEFORE THIS CHANGE, read first because it is
  // what tells a house-style face apart from a desk's own choice.
  //
  // `WHERE font_family IS NULL` alone is why the desk reported that changing
  // the paper's face "works sometime, sometime not": it works EXACTLY ONCE per
  // edition. The first change finds every block still NULL and writes all of
  // them; that same write leaves nothing NULL, so the second change matches no
  // rows at all and the paper's own column says one face while all forty-five
  // blocks are still set in the previous one. Measured on edition 40294:
  // 45 blocks restyled, then 0.
  //
  // A block still carrying the paper's PREVIOUS house face never chose it -
  // this function put it there - so it moves with the paper. A block a
  // sub-editor deliberately set to something else is carrying neither NULL nor
  // the old house face, and is left exactly as it is. That is the guarded
  // backfill this codebase already uses for a changed column default in
  // schema.sql: move only the rows still carrying the exact old value.
  const previous = await pool.query(
    'SELECT body_family, display_family FROM newspapers WHERE id = $1', [id],
  );
  if (!previous.rows[0]) return null;
  const wasBody = previous.rows[0].body_family;
  const wasDisplay = previous.rows[0].display_family;

  const { rows } = await pool.query(
    `UPDATE newspapers
        SET body_family = COALESCE($2, body_family),
            display_family = COALESCE($3, display_family),
            column_rules = COALESCE($4, column_rules),
            updated_at = CURRENT_TIMESTAMP
      WHERE id = $1 RETURNING *`,
    [id, bodyFamily ?? null, displayFamily ?? null,
      typeof columnRules === 'boolean' ? columnRules : null],
  );
  if (!rows[0]) return null;

  let restyled = 0;
  if (bodyFamily) {
    const { rowCount } = await pool.query(
      `UPDATE page_sections SET font_family = $2, updated_at = CURRENT_TIMESTAMP
        WHERE (font_family IS NULL OR font_family IS NOT DISTINCT FROM $3)
          AND font_family IS DISTINCT FROM $2
          AND page_id IN (SELECT id FROM pages WHERE newspaper_id = $1)`,
      [id, bodyFamily, wasBody],
    );
    restyled += rowCount;
  }
  if (displayFamily) {
    const { rowCount } = await pool.query(
      `UPDATE page_sections SET display_family = $2, updated_at = CURRENT_TIMESTAMP
        WHERE (display_family IS NULL OR display_family IS NOT DISTINCT FROM $3)
          AND display_family IS DISTINCT FROM $2
          AND page_id IN (SELECT id FROM pages WHERE newspaper_id = $1)`,
      [id, displayFamily, wasDisplay],
    );
    restyled += rowCount;
  }
  return { newspaper: rows[0], restyled };
}

module.exports = { create, claimDate, findAll, setHouseStyle, findEpaperReleases, findPublicEpaper, selectPublicEpaper, recordEpaperRelease, clearEpaperRelease, findById, findByDate, findAllByDate, findPrevious, update };
