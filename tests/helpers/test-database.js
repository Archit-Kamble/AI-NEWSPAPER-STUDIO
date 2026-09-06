// WHICH DATABASE `npm test` IS ALLOWED TO WRITE TO.
//
// This suite runs against a REAL PostgreSQL through the real createApp(), which
// is deliberate and is what makes it worth having - but it also means every
// run creates editions, pages, blocks, filings and logins in whatever database
// `.env` happens to name. On this machine that is the newsroom's own.
//
// Two rules, and they are deliberately different in strength:
//
//   * Against NODE_ENV=production it REFUSES. There is no circumstance in
//     which a test suite that writes rows should run against a live
//     newspaper's production database, and no amount of care makes it safe.
//
//   * Anywhere else it WARNS, once, naming the database and how to get a
//     separate one. It does not refuse, because refusing would stop the suite
//     running on every machine that has this repository today, and a fix that
//     turns 1,197 passing tests into zero is not a fix. The fixtures now clean
//     up after themselves, so the warning is about the remaining risk rather
//     than about ongoing damage.
//
// A database is "a test database" if its name ends in `_test` or begins with
// `test_` - the two conventions in ordinary use - so pointing DB_NAME at
// `sahas_test` silences this without any other change.

require('dotenv').config();

const name = process.env.DB_NAME || '';
const looksLikeTestDb = /_test$/i.test(name) || /^test_/i.test(name);

function assertWritableDatabase() {
  if (process.env.NODE_ENV === 'production') {
    throw new Error(
      `Refusing to run the test suite against NODE_ENV=production (database "${name}"). ` +
      'These tests create and delete real rows.',
    );
  }
  if (looksLikeTestDb) return;
  if (process.env.SAHAS_TEST_DB_WARNED) return;
  process.env.SAHAS_TEST_DB_WARNED = '1';
  console.warn(
    `\n  ⚠  The tests are writing to "${name}", which is not a test database.\n` +
    '     They create editions, blocks, filings and logins, and remove their own\n' +
    '     again - but a crashed run can still leave rows behind.\n' +
    '     To use a separate one:  createdb sahas_test && DB_NAME=sahas_test npm test\n',
  );
}

module.exports = { assertWritableDatabase, looksLikeTestDb };
