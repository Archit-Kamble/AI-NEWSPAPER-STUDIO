// THE NEWSDESK RUN'S THREE STAGES, AND THAT EACH ONE'S BUTTON ACTUALLY ACTS.
//
//   node tests/browser/newsdesk-run.browser.js [editionId]
//
// WHY THIS EXISTS. The desk's report was "it shows me 31 stories but when I
// clicked Write 31 stories nothing is happening". It was true, and nothing
// could see it: the plan rendered correctly, the button was enabled and
// carried the right count, and pressing it made no request, showed no message
// and changed nothing on screen.
//
// `busy` is set by `working()` and cleared only by the function it returns,
// and each stage called that in its CATCH alone - so a run that SUCCEEDED
// left the flag true for the life of the panel and the next stage's
// `if (busy) return;` swallowed the press. The same leak in write() then
// killed Accept.
//
// It is the "a control that draws perfectly and does nothing" fault arriving
// through a guard flag rather than a listener, and it is the worse kind: the
// FIRST press of each button works, so only the next stage is dead and it
// reads as the AI failing rather than as the panel.
//
// EVERY NEWSDESK ENDPOINT IS STUBBED, DELIBERATELY. This net must cost no
// provider call - the real planner is one Ultra call for a whole newspaper and
// the writers are one call per block, which is a bill for running a test. What
// is being held here is the PANEL: that each stage's press reaches the server
// at all, and that the counts the desk reads are the ones it acts on.

const { chromium } = require('playwright-core');

const CHROME = process.env.CHROME_PATH || '/usr/bin/google-chrome';
const BASE = process.env.BASE_URL || 'http://localhost:3000';
const ED = Number(process.argv[2] || 0);
const STORIES = 31;

let pass = 0;
let ran = 0;
const say = (ok, what, detail = '') => {
  ran += 1;
  if (ok) pass += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${what}${detail ? ' :: ' + String(detail).slice(0, 140) : ''}`);
};

(async () => {
  const browser = await chromium.launch({ executablePath: CHROME, args: ['--no-sandbox'] });
  const page = await (await browser.newContext({ viewport: { width: 1700, height: 1300 } })).newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message.slice(0, 180)}`));
  page.on('console', (m) => m.type() === 'error' && errors.push(`console: ${m.text().slice(0, 180)}`));

  // ---- the stubs. Shapes are the panel's own contract, not invented: `page`
  // and `headlineHint` (not pageNumber/headline), `publishers` beside
  // `sources`, `proposal` on a written row, and `written`/`failed` counts.
  let planCalls = 0; let writeCalls = 0; let acceptCalls = 0; let wroteBody = null;
  // Held long enough to LOOK at the panel mid-flight. This is the longest wait
  // in the product - the real planner measured 83s on a 26-block brief - and a
  // label alone on a wait that long reads as a frozen screen.
  const hold = (ms) => new Promise((r) => setTimeout(r, ms));
  await page.route('**/newsdesk/plan', async (route) => {
    planCalls += 1;
    await hold(2200);
    const stories = Array.from({ length: STORIES }, (u, i) => ({
      page: 1 + (i % 4), sectionKey: `zz-block-${i}`, rung: 'standard',
      headlineHint: `ZZ net story ${i + 1}`, tagKey: 'national-politics', importance: 5,
      publishers: ['PIB'], verified: true, facts: ['a fact'],
      sources: [{ id: 's1', publisher: 'PIB', url: 'https://pib.gov.in/x' }],
    }));
    await route.fulfill({ status: 200, contentType: 'application/json',
      body: JSON.stringify({ stories, blocksOffered: STORIES, leftEmpty: [],
        retrieval: { candidates: 187, feedsFetched: 13 } }) });
  });
  await page.route('**/newsdesk/write', async (route) => {
    writeCalls += 1;
    wroteBody = JSON.parse(route.request().postData() || '{}');
    const results = Array.from({ length: 3 }, (u, i) => ({
      page: 1, sectionKey: `zz-block-${i}`,
      proposal: { headline: `ZZ net ${i}`, subheading: 'deck', body: 'copy '.repeat(40) },
      fit: { fill: { ratio: 0.97 }, acceptable: true, overflowing: false }, retrieval: null,
    }));
    await route.fulfill({ status: 200, contentType: 'application/json',
      body: JSON.stringify({ results, written: 3, failed: 0 }) });
  });
  await page.route('**/newsdesk/accept', async (route) => {
    acceptCalls += 1;
    await route.fulfill({ status: 200, contentType: 'application/json',
      body: JSON.stringify({ saved: 3, refused: [] }) });
  });

  await page.goto(BASE);
  await page.waitForTimeout(900);
  if (await page.locator('#email').count()) {
    await page.fill('#email', 'admin@esahas.com');
    await page.fill('#password', 'admin123');
    await page.click('#loginBtn');
  }
  await page.waitForSelector('.edition-row', { timeout: 20000 });
  if (ED) {
    await page.fill('#editionSearch', String(ED));
    await page.waitForTimeout(800);
    await page.locator(`.edition-row[data-edition-id="${ED}"] .edition-open`).click();
  } else {
    await page.locator('.edition-row .edition-open').first().click();
  }
  await page.waitForSelector('#canvasSurface', { timeout: 25000 });
  await page.waitForTimeout(3000);

  const opened = await page.evaluate(() => {
    const button = [...document.querySelectorAll('button')]
      .find((b) => /write empty blocks/i.test(b.textContent));
    if (!button) return false;
    button.click();
    return true;
  });
  say(opened, 'the desk can reach the newsdesk run from the workspace');
  await page.waitForTimeout(2500);
  say(await page.locator('.newsdesk-panel').count() === 1, 'and it opens the brief');

  // ---- 1. THE BRIEF -> THE PLAN
  await page.locator('#newsdeskResearch').click();
  await page.waitForTimeout(900);
  // MID-FLIGHT: the run says it is working, in the same vocabulary as every
  // other control in the product.
  const midRun = await page.evaluate(() => {
    const b = document.getElementById('newsdeskResearch');
    const after = b && getComputedStyle(b, '::after');
    return b ? {
      label: b.textContent.trim(), disabled: b.disabled,
      busy: b.classList.contains('is-busy'), aria: b.getAttribute('aria-busy'),
      pinned: Boolean(b.style.minWidth),
      spin: after && after.animationName,
      panelBusy: document.querySelector('.newsdesk-panel')?.getAttribute('aria-busy'),
    } : null;
  });
  say(midRun && midRun.busy && midRun.disabled && midRun.aria === 'true',
    'while it researches, the control says so and cannot be pressed again', JSON.stringify(midRun));
  say(midRun && midRun.spin === 'sahas-spin' && midRun.pinned,
    'with the shared spinner, and its width pinned so the row cannot reflow', midRun && midRun.spin);
  say(midRun && midRun.panelBusy === 'true',
    'and the panel about to be replaced says so too — the button is at the foot of a long list');

  await page.waitForTimeout(2600);
  say(planCalls === 1, 'Research asks the planner exactly once', `${planCalls} call(s)`);
  const released = await page.evaluate(() => document.querySelector('.newsdesk-panel')?.getAttribute('aria-busy'));
  say(released === null, 'and the busy state is released when the plan lands', String(released));
  const write = await page.evaluate(() => {
    const b = document.getElementById('newsdeskWrite');
    return b ? { label: b.textContent.trim(), disabled: b.disabled } : null;
  });
  say(Boolean(write), 'and the plan is rendered', JSON.stringify(write));
  say(write && write.label === `Write ${STORIES} stories`,
    'the button carries the number of stories the desk is about to pay for', write && write.label);
  say(write && !write.disabled, 'and it is enabled');

  // ---- 2. THE PLAN -> THE COPY. This is the press that did nothing.
  await page.locator('#newsdeskWrite').click();
  await page.waitForTimeout(2500);
  say(writeCalls === 1,
    'pressing it REACHES THE SERVER — the guard from a successful research does not swallow it',
    `${writeCalls} POST(s) to /newsdesk/write`);
  say(wroteBody && Array.isArray(wroteBody.stories) && wroteBody.stories.length === STORIES,
    'and it sends the stories the desk kept', `${wroteBody && wroteBody.stories && wroteBody.stories.length} stories`);
  const accept = await page.evaluate(() => {
    const b = document.getElementById('newsdeskAccept');
    return b ? { label: b.textContent.trim(), disabled: b.disabled } : null;
  });
  say(Boolean(accept), 'the copy stage is rendered', JSON.stringify(accept));

  // ---- 3. THE COPY -> THE PAPER. The same leak killed this one too.
  await page.locator('#newsdeskAccept').click();
  await page.waitForTimeout(2500);
  say(acceptCalls === 1,
    'and Accept reaches the server as well — the leak killed this stage too',
    `${acceptCalls} POST(s) to /newsdesk/accept`);
  say(await page.locator('.newsdesk-panel').count() === 0,
    'the panel closes once the stories are placed');

  say(errors.length === 0, 'no console or page errors anywhere in this run', errors.join(' | ') || '(none)');
  console.log(`\n${pass}/${ran} passed`);
  await browser.close();
  process.exit(pass === ran ? 0 : 1);
})().catch((error) => {
  // A net that crashes must not look like one that passed.
  console.log(`CRASH :: ${error.message}`);
  console.log(`${pass}/${ran} passed before the crash — later checks did not run`);
  process.exit(1);
});
