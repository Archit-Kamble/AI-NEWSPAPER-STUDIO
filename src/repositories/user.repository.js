const pool = require('../config/db');
const { ROLE_KEYS } = require('../auth/roles');

// The columns every staff-facing answer returns. Never `password_hash` - it is
// listed nowhere in this file except where bcrypt compares it.
const STAFF_COLUMNS = 'id, role, name, email, phone, district, beat, notes, is_active, blocked_at, created_at';

async function findByEmail(email) {
  const query = `
    SELECT
      id,
      role,
      name,
      email,
      password_hash,
      is_active
    FROM users
    WHERE email = $1
    LIMIT 1;
  `;

  const { rows } = await pool.query(query, [email]);
  return rows[0] || null;
}

async function findById(id) {
  const { rows } = await pool.query(
    `SELECT ${STAFF_COLUMNS} FROM users WHERE id = $1 LIMIT 1`,
    [id],
  );
  return rows[0] || null;
}

/**
 * Everyone on the paper, or just the roles asked for.
 *
 * This was `listReporters` and hard-coded `WHERE u.role = 'reporter'`, which is
 * why the owner's own screen could only ever see a quarter of the newsroom -
 * an editor or a Sampadak, once one could exist, would have been an account
 * nothing in the product could show, edit or block.
 *
 * Filed counts stay in the query for every role. They are a reporter's measure
 * and read 0 for the desk, which is the honest answer rather than a hidden
 * column: a Sampadak who files a story has filed a story.
 */
async function listStaff(search = '', roles = ROLE_KEYS) {
  const query = `%${String(search || '').trim()}%`;
  const wanted = roles.filter((role) => ROLE_KEYS.includes(role));
  const { rows } = await pool.query(
    `SELECT u.id, u.role, u.name, u.email, u.phone, u.district, u.beat, u.notes,
            u.is_active, u.blocked_at, u.created_at,
            COUNT(n.id)::int AS story_count,
            COUNT(n.id) FILTER (WHERE n.status = 'pending')::int AS pending_count,
            COUNT(n.id) FILTER (WHERE n.status = 'approved')::int AS approved_count,
            COUNT(n.id) FILTER (WHERE n.status = 'rejected')::int AS rejected_count,
            MAX(n.updated_at) AS last_filed_at
       FROM users u
       LEFT JOIN news_items n ON n.created_by = u.id
      WHERE u.role = ANY($2)
        AND ($1 = '%%' OR u.name ILIKE $1 OR u.email ILIKE $1 OR u.district ILIKE $1 OR u.beat ILIKE $1)
      GROUP BY u.id
      ORDER BY u.is_active DESC,
               -- The newsroom's own order, not the alphabet: the owner, then
               -- the Sampadak, then the desk, then the reporters.
               CASE u.role WHEN 'admin' THEN 0 WHEN 'chief_editor' THEN 1 WHEN 'editor' THEN 2 ELSE 3 END,
               u.name ASC`,
    [query, wanted],
  );
  return rows;
}

async function findStaff(id) {
  const { rows } = await pool.query(
    `SELECT ${STAFF_COLUMNS} FROM users WHERE id = $1 LIMIT 1`,
    [id],
  );
  return rows[0] || null;
}

async function createStaff(person) {
  const { rows } = await pool.query(
    `INSERT INTO users (role, name, email, password_hash, phone, district, beat, notes)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     RETURNING ${STAFF_COLUMNS}`,
    [person.role, person.name, person.email, person.passwordHash,
      person.phone || null, person.district || null, person.beat || null, person.notes || null],
  );
  return rows[0];
}

/**
 * The identity fields, and the role.
 *
 * `role` is COALESCEd rather than always written, so a caller that is only
 * correcting a spelling cannot silently reset somebody's authority to a
 * default - the same rule every presentational column in page_sections
 * follows, and for the same reason.
 */
async function updateStaff(id, person) {
  const { rows } = await pool.query(
    `UPDATE users
        SET name = $2, email = $3, phone = $4, district = $5, beat = $6, notes = $7,
            role = COALESCE($8, role)
      WHERE id = $1
      RETURNING ${STAFF_COLUMNS}`,
    [id, person.name, person.email, person.phone || null, person.district || null,
      person.beat || null, person.notes || null, person.role || null],
  );
  return rows[0] || null;
}

async function setStaffActive(id, isActive) {
  const { rows } = await pool.query(
    `UPDATE users
        SET is_active = $2, blocked_at = CASE WHEN $2 THEN NULL ELSE CURRENT_TIMESTAMP END
      WHERE id = $1
      RETURNING ${STAFF_COLUMNS}`,
    [id, isActive],
  );
  return rows[0] || null;
}

/**
 * How many owners can still sign in.
 *
 * Only an owner can hand out or restore a login, so an owner who blocks or
 * demotes the last active owner - themselves, most likely - locks the paper's
 * own administration away with no way back short of psql. That is the shape of
 * fault this codebase already refused once, in the login throttle: a guard
 * keyed on the account alone lets anyone lock the editor out of their own
 * paper on deadline, and the guard becomes the attack.
 */
async function activeOwnerCount(exceptId = null) {
  const { rows } = await pool.query(
    `SELECT COUNT(*)::int AS count FROM users
      WHERE role = 'admin' AND is_active = TRUE AND ($1::int IS NULL OR id <> $1)`,
    [exceptId],
  );
  return rows[0].count;
}

module.exports = {
  findByEmail, findById, listStaff, findStaff, createStaff, updateStaff, setStaffActive, activeOwnerCount,
};
