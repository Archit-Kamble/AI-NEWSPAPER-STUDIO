// THE POOL READS ITS CREDENTIALS AT MODULE LOAD, SO THEY MUST BE THERE.
//
// `process.env` is read once, below, when this file is first required. Any
// entry point that reaches a repository before calling `dotenv.config()`
// therefore builds a pool with `undefined` for the password, and every query
// fails with "client password must be a string" - a message that says nothing
// about the real cause. server.js gets the order right; several scripts in
// scripts/ do not, and a new one is one `require` away from the same trap.
// Loading it here means the order cannot be got wrong. `dotenv` never
// overwrites a variable already set, so a real environment still wins.
require('dotenv').config();

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

// A REQUEST THAT CANNOT GET A CONNECTION MUST FAIL, NOT HANG.
//
// With no `connectionTimeoutMillis` the pool waits for ever: if the database
// is unreachable or every connection is checked out, the desk's page simply
// stops - no error, no message, nothing to retry - which is indistinguishable
// from the software having crashed. Ten seconds turns that into an error the
// catch-all handler can report as one.
// TLS TO THE DATABASE IS A DEPLOYMENT FACT, AND IT WAS NOT EXPRESSIBLE.
//
// The pool carried no `ssl` at all, so every deployment connected in the
// clear - right for a Unix socket or a machine on the newsroom's own LAN, and
// wrong the moment PostgreSQL is a managed instance across a network this
// paper does not own, where the whole edition and the desk's credentials
// cross it unencrypted.
//
// Off unless asked for, so no existing deployment changes. `require` is the
// ordinary setting for a managed database presenting a CA the host already
// trusts; `no-verify` exists because a provider with a self-signed
// certificate is otherwise a connection that cannot be made at all - it still
// ENCRYPTS, it only declines to check who is on the other end, so it is
// named honestly rather than hidden behind `true`.
function sslConfig() {
  const value = String(process.env.DB_SSL || '').trim().toLowerCase();
  if (!value || value === 'false' || value === 'off' || value === 'disable') return false;
  if (value === 'no-verify' || value === 'allow') return { rejectUnauthorized: false };
  return { rejectUnauthorized: true };
}

const pool = new Pool({
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT),
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  ssl: sslConfig(),
  max: Number(process.env.DB_POOL_MAX) || 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000,
});

// `connect` fires for every connection the pool opens, so this printed the
// same line ten times over a busy boot. It is a fact about the database, not
// about each socket, so it is said once.
let announced = false;
pool.on('connect', () => {
  if (announced) return;
  announced = true;
  console.log('✅ PostgreSQL Connected');
});

pool.on('error', (err) => {
  console.error('❌ PostgreSQL Error:', err);
});

module.exports = pool;
