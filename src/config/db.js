const { Pool, types } = require('pg');

// A DATE is a day, not an instant.
//
// By default node-pg turns a DATE column into a JavaScript Date at local
// midnight. East of Greenwich that serialises to the previous day in UTC: an
// edition published on 3 August came back over the API as
// "2026-08-02T18:30:00.000Z", and the masthead printed it as 2 August. For a
// newspaper that is not a formatting nuisance - the date on page one is the
// edition's identity, and the archive is indexed by it.
//
// 1082 is DATE. Handing it back as the plain "YYYY-MM-DD" string Postgres
// stored means no timezone ever touches it.
types.setTypeParser(1082, (value) => value);

const pool = new Pool({
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT),
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
});

pool.on('connect', () => {
  console.log('✅ PostgreSQL Connected');
});

pool.on('error', (err) => {
  console.error('❌ PostgreSQL Error:', err);
});

module.exports = pool;
