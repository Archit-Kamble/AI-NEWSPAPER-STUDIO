// WHERE A DESK'S LOGIN LIVES.
//
// `express-session` with no `store` uses its own MemoryStore, and its own
// documentation says what that means: it leaks memory, and it is "not designed
// for a production environment". Two things follow, and both of them land on a
// newsroom on the day it matters:
//
//   - every session is lost when the process restarts. A deploy, a crash or an
//     ordinary `systemctl restart` in the middle of an edition signs out every
//     editor at once, mid-sentence.
//   - the store grows for the life of the process. Nothing ever removes an
//     expired session, so a machine that stays up between editions accumulates
//     one entry per login, for ever.
//
// This paper already has a database and this project's stated position is that
// it will not add distributed infrastructure for its own sake (the same
// argument the information cache makes for being a bare Map). So the sessions
// go in PostgreSQL, in one small table, through the pool that is already open.
// That is ~60 lines against a new dependency, and it is the same store the
// rest of the paper is kept in.

const session = require('express-session');
const pool = require('../config/db');

const TABLE = 'user_sessions';

// Created here rather than in schema.sql because schema.sql is never run at
// boot - a session table that has to be applied by hand is a server that
// refuses every login on a fresh deploy until somebody notices.
const CREATE = `
  CREATE TABLE IF NOT EXISTS ${TABLE} (
    sid        VARCHAR(128) PRIMARY KEY,
    data       JSONB        NOT NULL,
    expires_at TIMESTAMPTZ  NOT NULL
  );
  CREATE INDEX IF NOT EXISTS ${TABLE}_expires_at_idx ON ${TABLE} (expires_at);
`;

const DEFAULT_TTL_MS = 12 * 60 * 60 * 1000;

function expiryOf(sess) {
  const ms = Number(sess?.cookie?.originalMaxAge ?? sess?.cookie?.maxAge);
  return new Date(Date.now() + (Number.isFinite(ms) && ms > 0 ? ms : DEFAULT_TTL_MS));
}

class PostgresSessionStore extends session.Store {
  constructor() {
    super();
    this.readying = null;
    // One sweep an hour is enough for a table that gains a row per login.
    // `unref` so a pending timer can never hold the process open on shutdown.
    this.sweeper = setInterval(() => { this.sweep(); }, 60 * 60 * 1000);
    this.sweeper.unref?.();
  }

  /**
   * Creates the table, once, whoever asks first.
   *
   * The boot path awaits this so a fresh deploy has the table before it
   * accepts a login. But `createApp()` is also called directly - by `npm test`,
   * and by anything embedding the app - where nobody calls it, so every query
   * below funnels through here too. Without that, the first run against a
   * database that has never held a session fails on a missing relation, which
   * is precisely the "schema.sql is not applied at boot" trap this table was
   * put in code to avoid.
   */
  ready() {
    if (!this.readying) {
      this.readying = pool.query(CREATE)
        .then(() => this.sweep())
        .then(() => this)
        .catch((error) => { this.readying = null; throw error; });
    }
    return this.readying;
  }

  async sweep() {
    try {
      await pool.query(`DELETE FROM ${TABLE} WHERE expires_at < NOW()`);
    } catch (error) {
      console.error('Session sweep failed:', error.message);
    }
  }

  get(sid, done) {
    this.ready()
      .then(() => pool.query(`SELECT data FROM ${TABLE} WHERE sid = $1 AND expires_at >= NOW()`, [sid]))
      .then(({ rows }) => done(null, rows[0] ? rows[0].data : null))
      .catch((error) => done(error));
  }

  set(sid, sess, done) {
    this.ready()
      .then(() => pool.query(
        `INSERT INTO ${TABLE} (sid, data, expires_at) VALUES ($1, $2, $3)
         ON CONFLICT (sid) DO UPDATE SET data = EXCLUDED.data, expires_at = EXCLUDED.expires_at`,
        [sid, JSON.stringify(sess), expiryOf(sess)],
      ))
      .then(() => done(null)).catch((error) => done(error));
  }

  // A desk working through an edition must not be signed out for being quiet;
  // `touch` is what keeps a live session alive without rewriting its contents.
  touch(sid, sess, done) {
    this.ready()
      .then(() => pool.query(`UPDATE ${TABLE} SET expires_at = $2 WHERE sid = $1`, [sid, expiryOf(sess)]))
      .then(() => done(null)).catch((error) => done(error));
  }

  destroy(sid, done) {
    this.ready()
      .then(() => pool.query(`DELETE FROM ${TABLE} WHERE sid = $1`, [sid]))
      .then(() => done(null)).catch((error) => done(error));
  }

  close() {
    clearInterval(this.sweeper);
  }
}

module.exports = { PostgresSessionStore, TABLE };
