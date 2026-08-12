const test = require('node:test');
const assert = require('node:assert/strict');
const { parseArguments } = require('../scripts/reapply-edition-layout');

test('edition layout reapply defaults to dry run and requires an exact date', () => {
  assert.deepEqual(parseArguments(['--date', '2026-08-12']), {
    apply: false, dryRun: true, date: '2026-08-12', editionId: null,
  });
  assert.throws(() => parseArguments([]), /exact valid --date/);
  assert.throws(() => parseArguments(['--date', '12-08-2026']), /exact valid --date/);
});

test('edition layout reapply only applies with explicit --apply', () => {
  assert.equal(parseArguments(['--date', '2026-08-12', '--dry-run']).apply, false);
  assert.equal(parseArguments(['--date', '2026-08-12', '--apply']).apply, true);
  assert.equal(parseArguments(['--date', '2026-08-12', '--edition-id', '11273']).editionId, '11273');
});
