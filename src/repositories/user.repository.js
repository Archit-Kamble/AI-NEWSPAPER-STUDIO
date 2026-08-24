const pool = require('../config/db');

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
    `SELECT id, role, name, email, phone, district, beat, notes, is_active, blocked_at
       FROM users WHERE id = $1 LIMIT 1`,
    [id],
  );
  return rows[0] || null;
}

async function listReporters(search = '') {
  const query = `%${String(search || '').trim()}%`;
  const { rows } = await pool.query(
    `SELECT u.id, u.name, u.email, u.phone, u.district, u.beat, u.notes,
            u.is_active, u.blocked_at, u.created_at,
            COUNT(n.id)::int AS story_count,
            COUNT(n.id) FILTER (WHERE n.status = 'pending')::int AS pending_count,
            COUNT(n.id) FILTER (WHERE n.status = 'approved')::int AS approved_count,
            COUNT(n.id) FILTER (WHERE n.status = 'rejected')::int AS rejected_count,
            MAX(n.updated_at) AS last_filed_at
       FROM users u
       LEFT JOIN news_items n ON n.created_by = u.id
      WHERE u.role = 'reporter'
        AND ($1 = '%%' OR u.name ILIKE $1 OR u.email ILIKE $1 OR u.district ILIKE $1 OR u.beat ILIKE $1)
      GROUP BY u.id
      ORDER BY u.is_active DESC, u.name ASC`,
    [query],
  );
  return rows;
}

async function findReporter(id) {
  const { rows } = await pool.query(
    `SELECT id, name, email, phone, district, beat, notes, is_active, blocked_at, created_at
       FROM users WHERE id = $1 AND role = 'reporter' LIMIT 1`,
    [id],
  );
  return rows[0] || null;
}

async function createReporter(reporter) {
  const { rows } = await pool.query(
    `INSERT INTO users (role, name, email, password_hash, phone, district, beat, notes)
     VALUES ('reporter', $1, $2, $3, $4, $5, $6, $7)
     RETURNING id, name, email, phone, district, beat, notes, is_active, blocked_at, created_at`,
    [reporter.name, reporter.email, reporter.passwordHash, reporter.phone || null, reporter.district || null, reporter.beat || null, reporter.notes || null],
  );
  return rows[0];
}

async function updateReporter(id, reporter) {
  const { rows } = await pool.query(
    `UPDATE users
        SET name = $2, email = $3, phone = $4, district = $5, beat = $6, notes = $7
      WHERE id = $1 AND role = 'reporter'
      RETURNING id, name, email, phone, district, beat, notes, is_active, blocked_at, created_at`,
    [id, reporter.name, reporter.email, reporter.phone || null, reporter.district || null, reporter.beat || null, reporter.notes || null],
  );
  return rows[0] || null;
}

async function setReporterActive(id, isActive) {
  const { rows } = await pool.query(
    `UPDATE users
        SET is_active = $2, blocked_at = CASE WHEN $2 THEN NULL ELSE CURRENT_TIMESTAMP END
      WHERE id = $1 AND role = 'reporter'
      RETURNING id, name, email, phone, district, beat, notes, is_active, blocked_at, created_at`,
    [id, isActive],
  );
  return rows[0] || null;
}

module.exports = {
  findByEmail, findById, listReporters, findReporter, createReporter, updateReporter, setReporterActive,
};
