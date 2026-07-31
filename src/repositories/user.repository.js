const pool = require('../config/db');

async function findByEmail(email) {
  const query = `
    SELECT
      id,
      role,
      name,
      email,
      password_hash
    FROM users
    WHERE email = $1
    LIMIT 1;
  `;

  const { rows } = await pool.query(query, [email]);
  return rows[0] || null;
}

module.exports = {
  findByEmail,
};
