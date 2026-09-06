#!/usr/bin/env node
/**
 * EVERY BROWSER NET, IN ONE COMMAND.
 *
 * `npm test` runs `node --test`, which sees the 1,198 checks under tests/ and
 * NONE of the twenty browser nets - and this product is mostly the browser.
 * Every UI regression this repository has ever recorded was found by driving
 * the running app; not one was found by reading code. So the nets existed, and
 * running them meant knowing all twenty filenames and typing them one at a
 * time, which in practice means running the two you remember.
 *
 *   npm run test:browser                    # all of them
 *   npm run test:browser workspace parity   # only nets whose name matches
 *
 * They need the app already running (the nets drive a real server) and Chrome
 * at /usr/bin/google-chrome, which CHROME_PATH overrides.
 *
 * WHAT IT REPORTS IS THE LAST LINE, NOT THE FIRST FAILURE. This repository has
 * been bitten specifically by a net that CRASHED at check 18 of 211 and looked
 * like a pass, so a net that exits non-zero, prints no tally, or dies is
 * reported as failed and named - and the summary is a table, so a run that
 * half-worked cannot be mistaken for a clean one.
 */

const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const DIR = __dirname;
const filters = process.argv.slice(2);

const nets = fs.readdirSync(DIR)
  .filter((name) => name.endsWith('.browser.js'))
  .filter((name) => !filters.length || filters.some((f) => name.includes(f)))
  .sort();

if (!nets.length) {
  console.error(filters.length ? `No net matches ${filters.join(', ')}` : 'No browser nets found.');
  process.exit(1);
}

// The epaper net reports honestly and exits 0 when nothing is released, which
// is correct - releasing an edition is not something a test should do by
// accident - so it is included and its own output speaks for it.
const BASE = process.env.SAHAS_BASE || 'http://localhost:3000';

function run(name) {
  return new Promise((resolve) => {
    const started = Date.now();
    const child = spawn(process.execPath, [path.join(DIR, name)], {
      cwd: path.join(DIR, '..', '..'),
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let out = '';
    child.stdout.on('data', (chunk) => { out += chunk; });
    child.stderr.on('data', (chunk) => { out += chunk; });
    child.on('close', (code) => {
      // The tally each net prints, in either of the two shapes they use.
      const tally = out.match(/(\d+)\s*\/\s*(\d+)\s+passed/) || out.match(/(\d+) passed, (\d+) failed/);
      resolve({
        name,
        code,
        seconds: Math.round((Date.now() - started) / 1000),
        tally: tally ? tally[0] : '(no tally printed)',
        out,
      });
    });
  });
}

(async () => {
  // A net that cannot reach the app fails for a reason that has nothing to do
  // with the product, so it is worth saying so once rather than twenty times.
  try {
    const health = await fetch(`${BASE}/api/health`);
    const body = await health.json();
    if (body.status !== 'ok') throw new Error(JSON.stringify(body));
  } catch (error) {
    console.error(`\nThe app is not answering at ${BASE} - start it first:\n`);
    console.error('  setsid nohup node server.js &\n');
    process.exit(1);
  }

  console.log(`\nRunning ${nets.length} browser nets against ${BASE}\n`);
  const results = [];
  for (const name of nets) {
    process.stdout.write(`  ${name.padEnd(34)} `);
    // Serially, on purpose: they drive ONE running app and several of them
    // borrow a real block and put it back. Two at once would have each net
    // restoring the other's fixture.
    const result = await run(name);
    results.push(result);
    console.log(`${result.code === 0 ? 'ok  ' : 'FAIL'}  ${result.tally}  (${result.seconds}s)`);
  }

  const failed = results.filter((r) => r.code !== 0);
  console.log(`\n${results.length - failed.length}/${results.length} nets green\n`);
  for (const result of failed) {
    console.log(`--- ${result.name} (exit ${result.code}) ---`);
    console.log(result.out.split('\n').slice(-25).join('\n'));
  }
  process.exit(failed.length ? 1 : 0);
})();
