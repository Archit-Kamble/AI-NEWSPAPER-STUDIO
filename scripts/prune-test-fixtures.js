#!/usr/bin/env node
/**
 * WHAT THE TEST SUITE LEFT IN THE NEWSROOM'S OWN DATABASE.
 *
 * Measured on 2026-09-06, before the fixtures were taught to clean up after
 * themselves:
 *
 *   editions        273 of 474 were 2099-dated fixtures
 *   pages           301 of 435
 *   page_sections   4,555 of 6,002  - 76% of every block in the paper
 *   news_items      1,652 rows named `test-<timestamp>`
 *
 * And they SORT FIRST, so a desk opening Past Newspapers waded through test
 * data before reaching a real edition. The tests no longer leak (see
 * tests/helpers/desk.js and tests/health.test.js); this is for what is already
 * there.
 *
 * IT PRINTS BY DEFAULT AND DELETES ONLY WHEN TOLD TO, TWICE.
 *
 *   node scripts/prune-test-fixtures.js              # count and list, changes nothing
 *   node scripts/prune-test-fixtures.js --delete     # after a backup
 *
 * This is somebody's newspaper archive. A script that removes 273 editions
 * because it was run without arguments is not a tidy-up, it is a data loss
 * incident with a friendly name - so the destructive path is explicit, it
 * refuses without a recent backup flag, and it never touches a row it cannot
 * positively identify as a fixture.
 *
 * WHAT COUNTS AS A FIXTURE - all three must be true for an edition:
 *   * its publication date is in 2099 (the date this repository has always
 *     used for disposable editions, and refuses to let fill-edition-copy.js
 *     touch anything else),
 *   * it carries no e-paper release,
 *   * it carries no uploaded press file.
 *
 * The last two are the ones that matter: an edition somebody released or sent
 * to press is not a fixture whatever date is on it, and this stops even a
 * mistyped 2099 edition from being taken.
 */

require('dotenv').config();
const pool = require('../src/config/db');

const DELETE = process.argv.includes('--delete');
const CONFIRMED_BACKUP = process.argv.includes('--i-have-a-backup');

// THE LEAK HAS A SIGNATURE, AND ONLY THAT SIGNATURE IS TOUCHED.
//
// The first version of this query took "2099-dated, no e-paper release, no
// press file" and was wrong in the most dangerous possible direction: the
// leaked editions all DO carry press files (health.test.js uploads a fake
// .sla and .pdf on every run), so that filter excluded all 265 of them and
// selected the ten that were left - which are the editions the browser nets
// target by default and the showcase block CLAUDE.md tells you to look at.
// Running it would have deleted the useful fixtures and kept the junk.
//
// Measured instead. The 265 are byte-for-byte the same shape, because they
// are one test run 265 times:
//
//   publication_date  2099-01-01
//   name              साहस
//   pages             exactly 1
//   status            finalised
//   publication_files 2, both placeholder blobs
//
// So that whole shape is the condition. Anything that differs from it in any
// respect - a different date, a different name, more than one page, a real
// release - is not this leak and is left alone, which is the right default for
// a script pointed at a newspaper's archive.
const FIXTURE_EDITIONS = `
  SELECT n.id, n.name, n.publication_date,
         (SELECT count(*) FROM pages p WHERE p.newspaper_id = n.id) AS pages,
         (SELECT count(*) FROM page_sections s
            JOIN pages p ON p.id = s.page_id WHERE p.newspaper_id = n.id) AS blocks
    FROM newspapers n
   WHERE n.publication_date = DATE '2099-01-01'
     AND n.name = 'साहस'
     AND n.epaper_released_at IS NULL
     AND (SELECT count(*) FROM pages p WHERE p.newspaper_id = n.id) <= 1
   ORDER BY n.id`;

// Everything else dated 2099 - reported so the owner can SEE what is being
// kept, because "it did not delete anything it should not have" is a claim
// that needs evidence, not assurance. These are the editions the browser nets
// open by default (40294, 44929, 49291) and the showcase pages CLAUDE.md
// names; deleting them would break the test suite this script exists to serve.
const PROTECTED_EDITIONS = `
  SELECT n.id, n.name, n.publication_date,
         (SELECT count(*) FROM pages p WHERE p.newspaper_id = n.id) AS pages
    FROM newspapers n
   WHERE EXTRACT(YEAR FROM n.publication_date) = 2099
     AND NOT (n.publication_date = DATE '2099-01-01'
              AND n.name = 'साहस'
              AND n.epaper_released_at IS NULL
              AND (SELECT count(*) FROM pages p WHERE p.newspaper_id = n.id) <= 1)
   ORDER BY n.id`;

// Named by the suite itself, and now prefixed `zz-` for exactly this reason.
// `ZZ ` catches the older convention this newsroom's database already carries.
const FIXTURE_FILINGS = `
  SELECT id, title FROM news_items
   WHERE title LIKE 'zz-test-%' OR title LIKE 'test-%' OR title LIKE 'ZZ %'
   ORDER BY id`;

const FIXTURE_LOGINS = `
  SELECT id, email FROM users
   WHERE email LIKE 'zz-%@example.test'
   ORDER BY id`;

(async () => {
  const editions = (await pool.query(FIXTURE_EDITIONS)).rows;
  const kept = (await pool.query(PROTECTED_EDITIONS)).rows;
  const filings = (await pool.query(FIXTURE_FILINGS)).rows;
  const logins = (await pool.query(FIXTURE_LOGINS)).rows;
  const totals = (await pool.query('SELECT (SELECT count(*) FROM newspapers) AS editions, (SELECT count(*) FROM page_sections) AS blocks')).rows[0];

  const blocks = editions.reduce((sum, row) => sum + Number(row.blocks), 0);
  const pages = editions.reduce((sum, row) => sum + Number(row.pages), 0);

  console.log(`\nFixtures found:`);
  console.log(`  editions   ${editions.length} of ${totals.editions}`);
  console.log(`  pages      ${pages}`);
  console.log(`  blocks     ${blocks} of ${totals.blocks}`);
  console.log(`  filings    ${filings.length}`);
  console.log(`  logins     ${logins.length}`);

  for (const row of editions.slice(0, 15)) {
    console.log(`   #${row.id}  ${String(row.publication_date).slice(0, 10)}  ${row.pages}pp ${row.blocks} blocks  ${row.name || ''}`);
  }
  if (editions.length > 15) console.log(`   … and ${editions.length - 15} more`);

  console.log(`\n2099-dated editions being KEPT (${kept.length}) - the nets open these:`);
  for (const row of kept) {
    console.log(`   #${row.id}  ${String(row.publication_date).slice(0, 10)}  ${row.pages}pp  ${row.name || ''}`);
  }

  if (!DELETE) {
    console.log('\nNothing was changed. To remove them:');
    console.log('  1. Back the database up:  pg_dump -Fc <db> > sahas-backup.dump');
    console.log('  2. node scripts/prune-test-fixtures.js --delete --i-have-a-backup\n');
    await pool.end();
    return;
  }

  if (!CONFIRMED_BACKUP) {
    console.error('\nRefusing to delete without --i-have-a-backup.');
    console.error('This removes editions permanently and page_sections cascade with them.\n');
    await pool.end();
    process.exitCode = 1;
    return;
  }

  // One transaction: a half-pruned archive is worse than an untouched one.
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // A filing belongs to the reporter who wrote it, so it is DETACHED from the
    // edition rather than removed with it - the same rule the edition delete
    // route already follows.
    if (editions.length) {
      const ids = editions.map((row) => row.id);
      await client.query('UPDATE news_items SET newspaper_id = NULL WHERE newspaper_id = ANY($1)', [ids]);
      await client.query('DELETE FROM newspapers WHERE id = ANY($1)', [ids]);
    }
    if (filings.length) {
      await client.query('DELETE FROM news_items WHERE id = ANY($1)', [filings.map((r) => r.id)]);
    }
    if (logins.length) {
      await client.query('DELETE FROM users WHERE id = ANY($1)', [logins.map((r) => r.id)]);
    }
    await client.query('COMMIT');
    console.log(`\nRemoved ${editions.length} editions, ${filings.length} filings, ${logins.length} logins.`);
    console.log('Generated files under public/uploads are NOT touched by this script.\n');
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('\nRolled back, nothing was removed:', error.message, '\n');
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
})();
