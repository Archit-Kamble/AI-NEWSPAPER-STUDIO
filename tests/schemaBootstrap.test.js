const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const pool = require('../src/config/db');
const { assertWritableDatabase } = require('./helpers/test-database');

assertWritableDatabase();
test.after(() => pool.end());

test('a fresh schema supports edition creation and can be applied twice', async () => {
  const client = await pool.connect();
  // A transaction-local namespace: no existing edition, table or schema is
  // migrated by this test, and even an assertion failure rolls it all back.
  const namespace = `bootstrap_${process.pid}`;
  const schema = fs.readFileSync(path.join(__dirname, '..', 'schema.sql'), 'utf8');
  try {
    await client.query('BEGIN');
    await client.query(`CREATE SCHEMA "${namespace}"`);
    await client.query(`SET LOCAL search_path TO "${namespace}"`);
    await client.query(schema);
    const { rows } = await client.query(
      "INSERT INTO newspapers (name, template, publication_date) VALUES ($1, $2, $3) RETURNING *",
      ['Bootstrap regression', 'front', '2099-09-06'],
    );
    assert.equal(rows[0].template, 'front');
    assert.equal(rows[0].publication_date, '2099-09-06');
    await client.query(schema);
    const saved = await client.query('SELECT name, template FROM newspapers WHERE id = $1', [rows[0].id]);
    assert.deepEqual(saved.rows, [{ name: 'Bootstrap regression', template: 'front' }]);
  } finally {
    await client.query('ROLLBACK');
    client.release();
  }
});
