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
const { DESK_EMAIL, DESK_PASSWORD } = require('./helpers/desk-login');

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
      sources: [{
        id: 's1', publisher: 'PIB', url: 'https://pib.gov.in/x',
        // Only the FIRST story has a photograph, so this can check that the
        // offer appears where there is one and says so where there is not.
        ...(i === 0 ? { imageUrl: 'https://images.example.invalid/a.jpg' } : {}),
      }],
    }));
    await route.fulfill({ status: 200, contentType: 'application/json',
      body: JSON.stringify({ stories, blocksOffered: STORIES, leftEmpty: [],
        retrieval: { candidates: 187, feedsFetched: 13 } }) });
  });
  // HALF THE BATCH FAILS, which is the ordinary case on a metered account -
  // this project has measured a 26-block run exhausting every configured
  // provider - and it is the case the panel used to throw away.
  await page.route('**/newsdesk/write', async (route) => {
    writeCalls += 1;
    wroteBody = JSON.parse(route.request().postData() || '{}');
    const results = wroteBody.stories.map((story, i) => (i % 2 === 0
      ? {
        page: story.page, sectionKey: story.sectionKey, pageId: 1, story,
        proposal: { headline: `ZZ net ${i}`, subheading: 'deck', body: 'copy '.repeat(40) },
        fit: { fill: { ratio: 0.97 }, acceptable: true, overflowing: false },
        retrieval: { status: 'verified', sources: story.sources },
      }
      : {
        page: story.page, sectionKey: story.sectionKey, pageId: 1, story,
        error: 'The provider is out of quota.',
      }));
    await route.fulfill({ status: 200, contentType: 'application/json',
      body: JSON.stringify({ results, written: results.filter((r) => !r.error).length,
        failed: results.filter((r) => r.error).length }) });
  });
  // THE PICTURE ROUTES ARE STUBBED TOO, for the same reason the rest are: this
  // net ticks a photograph to prove the tick survives a re-render, and the
  // stub's host is deliberately unreachable - the real from-link route refuses
  // it with a 400, correctly, which is the SSRF guard doing its job and not
  // something this net is here to measure.
  let fromLink = 0; let cutouts = 0;
  await page.route('**/images/from-link', async (route) => {
    fromLink += 1;
    await route.fulfill({ status: 200, contentType: 'application/json',
      body: JSON.stringify([{ id: 4242, url: '/uploads/zz.png' }]) });
  });
  await page.route('**/images/*/cutout', async (route) => {
    cutouts += 1;
    await route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
  });
  let acceptedRows = 0;
  await page.route('**/newsdesk/accept', async (route) => {
    acceptCalls += 1;
    acceptedRows = (JSON.parse(route.request().postData() || '{}').stories || []).length;
    await route.fulfill({ status: 200, contentType: 'application/json',
      body: JSON.stringify({ saved: acceptedRows, refused: [] }) });
  });

  await page.goto(BASE);
  await page.waitForTimeout(900);
  if (await page.locator('#email').count()) {
    await page.fill('#email', DESK_EMAIL);
    await page.fill('#password', DESK_PASSWORD);
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

  // ---- THE BRIEF MAY NOT CARRY AN ASK THAT IS PER STORY BY NATURE.
  //
  // The desk's report was that ticking "chart of its figures" here "will going
  // have all news with chart which is wrong totally". Measured on this same
  // 31-story stub before the fix: one press came back as 31 of 31 rows
  // carrying a chart. The per-story controls existed and worked; they could
  // not help, because THIS control is the one a desk meets first - before the
  // plan exists - so it is applied blind and the only way back is to un-tick
  // thirty of them by hand.
  const briefAsks = await page.evaluate(() => [...document.querySelectorAll('.newsdesk-asks label.toggle')]
    .map((l) => l.textContent.trim()));
  say(briefAsks.length === 2 && /headline/i.test(briefAsks[0]) && /subheading/i.test(briefAsks[1]),
    'the brief asks only for the paper-wide NORMS — a headline and a subheading', briefAsks.join(' | '));
  say(await page.locator('#newsdeskChart').count() === 0
    && await page.locator('#newsdeskReason').count() === 0,
    'a chart and thinking-it-through cannot be set for the whole run at all');

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

  // ---- WHAT EACH BLOCK IS ASKED FOR IS THE BLOCK'S OWN DECISION.
  //
  // These four used to be one setting for the whole run, so a deck on the lead
  // meant a deck on all thirty-one and a chart was either on every block or on
  // none. A page is not made up that way.
  const askRows = await page.locator('.newsdesk-ask-row').count();
  say(askRows === STORIES, 'every story on the plan carries its own asks', `${askRows} rows`);
  const words = await page.evaluate(() => [...document.querySelectorAll('.newsdesk-ask-row')[0]
    .querySelectorAll('.toggle')].map((l) => l.textContent.trim()));
  say(words.length === 4 && words.every((w) => w.length > 2),
    'named in words, never initials — a desk should not have to learn that H means headline',
    words.join(' | '));

  // ---- A PAPER IS REVIEWED PAGE BY PAGE, because that is how it is made up.
  // The list was flat and 3848px long in a 1066px panel with nothing saying
  // where one page ended and the next began.
  const pageHeads = await page.locator('.newsdesk-plan-page').count();
  say(pageHeads === 4, 'the plan is grouped by page, like the brief above it', `${pageHeads} pages`);

  // ---- APPLYING TO EVERY STORY IS NOT THE FAULT; APPLYING BLIND IS. So the
  // All/None lives HERE, where the desk can see the rows it affects and
  // un-tick any of them afterwards.
  const chartsOn = () => page.evaluate(() => [...document.querySelectorAll('.newsdesk-plan-row')]
    .filter((r) => r.querySelector('[data-ask="writeChart"]')?.checked).length);
  say(await chartsOn() === 0, 'no story starts with a chart', `${await chartsOn()} of ${STORIES}`);
  await page.locator('[data-ask-all="writeChart"][data-ask-value="1"]').first().click();
  await page.waitForTimeout(400);
  say(await chartsOn() === STORIES, 'All sets every story the paper is keeping', `${await chartsOn()}`);
  await page.locator('[data-ask-all="writeChart"][data-ask-value="0"]').first().click();
  await page.waitForTimeout(400);
  say(await chartsOn() === 0, 'and None clears them again', `${await chartsOn()}`);
  const counts = await page.evaluate(() => [...document.querySelectorAll('.newsdesk-review-col')]
    .map((c) => c.textContent.replace(/\s+/g, ' ').trim()));
  say(counts.length === 4 && counts[0].startsWith(`${STORIES} of ${STORIES}`),
    'and the strip counts what is asked for, over the rows being kept', counts.join(' / '));

  // A ROW IS ADDRESSED BY ITS BLOCK, NEVER BY ITS POSITION.
  //
  // These checks used to index into `.newsdesk-ask-row` and compare against
  // `stories[n]`, which held only while the list was flat and in the planner's
  // own order. Grouping the plan by page reorders the DOM - p1's stories come
  // first, whatever their place in the plan - and the net failed on a row it
  // had itself moved. A block is identified by its key on both sides now, so
  // the assertion survives any ordering the review chooses.
  const NO_DECK = 'zz-block-7';
  const WANTS_CHART = 'zz-block-0';
  const NO_CHART = 'zz-block-2';
  const askRow = (key) => page.locator(`.newsdesk-ask-row:has([data-ask-row="1/${key}"]), .newsdesk-ask-row:has([data-ask-row="2/${key}"]), .newsdesk-ask-row:has([data-ask-row="3/${key}"]), .newsdesk-ask-row:has([data-ask-row="4/${key}"])`);
  await askRow(NO_DECK).locator('[data-ask="writeSubheading"]').uncheck();
  await askRow(WANTS_CHART).locator('[data-ask="writeChart"]').check();
  await page.waitForTimeout(800);
  say(await askRow(WANTS_CHART).locator('[data-ask="chartType"]').count() === 1
    && await askRow(NO_CHART).locator('[data-ask="chartType"]').count() === 0,
    'asking for a chart reveals WHICH chart, on that row alone');

  // The two asks that change what a story COSTS are named where the desk is
  // about to spend, not counted by hand down three screens of checkboxes.
  const cost = await page.evaluate(() => document.querySelector('.newsdesk-actions .muted')?.textContent.trim());
  say(/1 with a chart/.test(cost || ''), 'the cost line names the one story asked for a chart', cost);

  // ---- 2. THE PLAN -> THE COPY. This is the press that did nothing.
  await page.locator('#newsdeskWrite').click();
  await page.waitForTimeout(2500);
  say(writeCalls === 1,
    'pressing it REACHES THE SERVER — the guard from a successful research does not swallow it',
    `${writeCalls} POST(s) to /newsdesk/write`);
  say(wroteBody && Array.isArray(wroteBody.stories) && wroteBody.stories.length === STORIES,
    'and it sends the stories the desk kept', `${wroteBody && wroteBody.stories && wroteBody.stories.length} stories`);
  const asksOf = (key) => (wroteBody.stories || []).find((row) => row.sectionKey === key)?.asks || {};
  const decksOff = (wroteBody.stories || []).filter((row) => row.asks?.writeSubheading === false).length;
  say(asksOf(NO_DECK).writeSubheading === false && asksOf(WANTS_CHART).writeSubheading === true && decksOff === 1,
    'the deck is off on the ONE row the desk turned it off on, and on everywhere else',
    `${decksOff} row(s) without a deck`);
  const chartsAsked = (wroteBody.stories || []).filter((row) => row.asks?.writeChart === true).length;
  say(asksOf(WANTS_CHART).writeChart === true && asksOf(NO_CHART).writeChart !== true && chartsAsked === 1,
    'and the chart is on the ONE row that asked for it — never on all thirty-one',
    `${chartsAsked} of ${STORIES} asked for a chart`);
  const accept = await page.evaluate(() => {
    const b = document.getElementById('newsdeskAccept');
    return b ? { label: b.textContent.trim(), disabled: b.disabled } : null;
  });
  say(Boolean(accept), 'the copy stage is rendered', JSON.stringify(accept));

  // ---- THE STORY'S OWN PHOTOGRAPH, offered where the source carries one.
  const offers = await page.locator('[data-pic-row]').count();
  const nones = await page.locator('.newsdesk-nopic').count();
  say(offers === 1, 'a photograph is offered on the one written story that has one', `${offers} offer(s)`);
  say(nones > 0, 'and the ones without say so plainly', `${nones} said "no photograph"`);
  const ticked = await page.locator('[data-pic-row]').first().isChecked();
  say(ticked === false, 'and nothing is fetched until a person ticks it');
  say(await page.locator('[data-cut-row]').count() === 1,
    'with the background cut-out offered beside it, also off');

  // ---- A REVIEW YOU CANNOT READ IS NOT A REVIEW.
  //
  // This stage carried the headline, a fill percentage and nothing else, under
  // a line reading "the desk must check every fact before any of this is
  // printed" - so the panel demanded a check it gave nobody the means to make.
  // The deck and the story were already in `proposal`; they had never been
  // drawn.
  const readable = await page.locator('.newsdesk-read').count();
  say(readable > 0, 'every written story can be read before it is accepted', `${readable} readable`);
  const firstRead = await page.evaluate(() => {
    const d = document.querySelector('.newsdesk-read');
    if (!d) return null;
    d.open = true;
    return {
      deck: d.querySelector('.newsdesk-read-deck')?.textContent.trim(),
      paragraphs: d.querySelectorAll('p:not(.newsdesk-read-deck)').length,
    };
  });
  say(firstRead && firstRead.deck === 'deck' && firstRead.paragraphs > 0,
    'and it carries the deck and the story, not just the headline', JSON.stringify(firstRead));

  // A TICK MUST SURVIVE A RE-RENDER OF THE STAGE IT IS ON.
  //
  // The photograph and cut-out checkboxes were read off the LIVE DOM at accept
  // time, so adding any control that re-renders the copy stage silently wiped
  // every tick the desk had made. They live in the run's own state now, keyed
  // by block like the asks beside them - the rule bindBrief's own comment
  // states: a value held in a detached node is a value lost.
  await page.locator('[data-pic-row]').first().check();
  await page.locator('[data-cut-row]').first().check();

  // A story the desk has READ and decided against is a decision, not a
  // failure: it is not placed, and it does not come back as unfinished
  // business either. Put back afterwards so the accept count below is the
  // one this net has always asserted.
  const acceptLabel = () => page.evaluate(() => document.getElementById('newsdeskAccept')?.textContent.trim());
  const acceptBefore = await acceptLabel();
  await page.locator('[data-copy-drop]').first().click();
  await page.waitForTimeout(400);
  const acceptDropped = await acceptLabel();
  say(acceptBefore === 'Accept 16 into the paper' && acceptDropped === 'Accept 15 into the paper',
    'leaving one out takes it off the count Accept places', `${acceptBefore} -> ${acceptDropped}`);
  say(await page.locator('.bulk-row.is-dropped').count() === 1,
    'and the row stays where it was, so the desk can change its mind');
  await page.locator('[data-copy-drop]').first().click();
  await page.waitForTimeout(400);
  say(await acceptLabel() === acceptBefore, 'and putting it back restores it', await acceptLabel());
  say(await page.locator('[data-pic-row]').first().isChecked()
    && await page.locator('[data-cut-row]').first().isChecked(),
    'and the photograph ticked before all that is STILL ticked — a re-render does not wipe it');

  // ---- 3. THE COPY -> THE PAPER. The same leak killed this one too.
  await page.locator('#newsdeskAccept').click();
  await page.waitForTimeout(2500);
  say(acceptCalls === 1,
    'and Accept reaches the server as well — the leak killed this stage too',
    `${acceptCalls} POST(s) to /newsdesk/accept`);
  // The photograph is fetched AFTER the copy and only where the desk ticked -
  // a picture on a block whose story the paper refused is a picture of
  // nothing - and the cut-out is a second, separate act on what was placed.
  say(fromLink === 1 && cutouts === 1,
    'the one ticked photograph is fetched, and its background cut out after it',
    `${fromLink} fetch(es), ${cutouts} cut-out(s)`);

  // ---- EVERY WRITTEN STORY IS PLACED, AND THE REST ARE KEPT.
  //
  // The desk's report was "it should accept all news to layout but it just
  // accepts one, then it vanishes all the other news". The panel used to
  // filter the failures out and then `panel.remove()` the run, so a story the
  // desk had already paid a research call for could not be written again
  // without paying for the whole research pass a second time.
  const written = wroteBody.stories.filter((u, i) => i % 2 === 0).length;
  say(acceptedRows === written,
    'every story that was written is placed, not one', `${acceptedRows} sent of ${written} written`);
  say(await page.locator('.newsdesk-panel').count() === 1,
    'the panel STAYS while anything is outstanding — the rest do not vanish');
  const leftRows = await page.locator('.bulk-row.is-error').count();
  const again = await page.locator('#newsdeskWriteAgain');
  say(leftRows > 0 && await again.count() === 1,
    'and it names each one, with a way to write exactly those again',
    `${leftRows} left · "${(await again.textContent() || '').trim()}"`);

  const before = writeCalls;
  await again.click();
  await page.waitForTimeout(2500);
  say(writeCalls === before + 1 && planCalls === 1,
    'writing them again costs one call per block and NO second research pass',
    `${writeCalls} write calls, ${planCalls} plan call`);

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
