require('dotenv').config();

const pool = require('./src/config/db');

async function test() {
  try {
    const result = await pool.query('SELECT NOW() AS current_time');
    console.log(result.rows[0]);
  } catch (err) {
    console.error(err);
  } finally {
    await pool.end();
  }
}

test();
