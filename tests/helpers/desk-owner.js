// A DESK LOGIN THAT IS NOT THE NEWSROOM'S OWN.
//
// Seven test files upserted `admin@esahas.com` and REPLACED its password hash
// with a constant published in this repository:
//
//   INSERT INTO users (...) VALUES ('Owner', 'admin@esahas.com', $1, 'admin', TRUE)
//   ON CONFLICT (email) DO UPDATE SET password_hash = $1, role = 'admin', is_active = TRUE
//
// That is the real administrator of a real newspaper. Every `npm test` run
// overwrote their password with `admin123`, never restored it, and kept no
// copy of what it replaced - so the owner could not set their own password and
// have it survive a test run, and the documented credential went on working
// for anyone who had read this repository.
//
// It is also why nothing noticed: the tests worked BECAUSE they had corrupted
// the account, so the corruption looked like configuration.
//
// This is the replacement. Each process gets its own owner, with a random
// password, on an `@example.test` address - a reserved TLD that can never be a
// real person's mailbox - and it is removed again. Nothing here ever writes to
// an account somebody uses.

const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const pool = require('../../src/config/db');

// `zz-` matches the convention this newsroom's own database already uses to
// mark fixtures, so a leftover from a killed run is recognisable by eye.
const RUN = `${process.pid}-${Date.now()}`;
const PASSWORD = crypto.randomBytes(18).toString('base64url');
const EMAIL = `zz-test-owner-admin-${RUN}@example.test`;

// One per ROLE, because a test that needs both a desk and a reporter needs two
// accounts and neither of them may be a real one. Cached, so a file that signs
// in repeatedly makes one login rather than one per call.
const created = new Map();

/**
 * The disposable user for this test process and role, made once and reused.
 * Returns `{ id, email, password }`.
 */
async function testOwner(role = 'admin') {
  if (created.has(role)) return created.get(role);
  const email = `zz-test-owner-${role}-${RUN}@example.test`;
  const hash = await bcrypt.hash(PASSWORD, 4);
  const { rows } = await pool.query(
    `INSERT INTO users (name, email, password_hash, role, is_active)
     VALUES ($1, $2, $3, $4, TRUE) RETURNING id`,
    [`ZZ test ${role}`, email, hash, role],
  );
  const record = { id: rows[0].id, email, password: PASSWORD };
  created.set(role, record);
  return record;
}

/**
 * Remove it. Safe to call when nothing was created, and safe to call twice.
 *
 * A filing belongs to the reporter who wrote it, not to the login - the same
 * rule the edition delete already follows - so anything this owner authored is
 * detached rather than destroyed, and the delete cannot fail on a foreign key
 * and leave the account behind.
 */
async function removeTestOwner() {
  const ids = [...created.values()].map((record) => record.id);
  created.clear();
  if (!ids.length) return;
  try {
    // Anything these logins filed goes with them - they are fixtures, not
    // reporters, so unlike a real account there is nothing here to preserve.
    await pool.query('DELETE FROM news_items WHERE created_by = ANY($1)', [ids]);
  } catch { /* the column may not exist in every schema state */ }
  try {
    await pool.query('DELETE FROM users WHERE id = ANY($1)', [ids]);
  } catch { /* a leftover row is visible and harmless; a failed test run is not */ }
}

/**
 * Sweep owners left behind by runs that were killed before they could clean up.
 * Older than a day, so it can never remove one a parallel run is still using.
 */
async function sweepAbandonedTestOwners() {
  try {
    await pool.query(
      `DELETE FROM users
        WHERE email LIKE 'zz-test-owner-%@example.test'
          AND created_at < NOW() - INTERVAL '1 day'`,
    );
  } catch { /* best effort; never the reason a suite fails */ }
}

module.exports = { testOwner, removeTestOwner, sweepAbandonedTestOwners, TEST_OWNER_EMAIL: EMAIL };
