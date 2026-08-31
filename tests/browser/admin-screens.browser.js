// THE OWNER'S OWN SCREENS, WHICH NO NET COVERED.
//
// Every browser net in this repository drives the workspace. The five screens
// behind the ☰ - Past Newspapers, Past News, Reporters, Settings, E-paper -
// had none, and that is where this found a review queue of 1972 filings drawn
// one card at a time into the live document with no way to search it.
//
//   node tests/browser/admin-screens.browser.js
//
// Needs playwright-core and Chrome at /usr/bin/google-chrome (CHROME_PATH
// overrides), against a running server on :3000.

const { chromium } = require('playwright-core');

const BASE = process.env.BASE || 'http://localhost:3000';
let pass = 0; let fail = 0;
const check = (name, ok, detail = '') => {
  if (ok) { pass += 1; console.log(`PASS  ${name}${detail ? ` :: ${detail}` : ''}`); }
  else { fail += 1; console.log(`FAIL  ${name}${detail ? ` :: ${detail}` : ''}`); }
};

(async () => {
  const browser = await chromium.launch({
    executablePath: process.env.CHROME_PATH || '/usr/bin/google-chrome',
  });
  const page = await browser.newPage({ viewport: { width: 1512, height: 950 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e.message).slice(0, 160)));

  let dialog = null;
  page.on('dialog', async (d) => { dialog = d.message(); await d.accept(); });

  try {
    await page.goto(BASE, { waitUntil: 'networkidle' });
    if (await page.locator('#email').count()) {
      await page.fill('#email', 'admin@esahas.com');
      await page.fill('#password', 'admin123');
      await page.click('#loginBtn');
    }
    await page.waitForSelector('.edition-row', { timeout: 20000 });

    // The nav is an off-canvas sidebar: the hamburger is how a desk reaches it.
    const openNav = async () => {
      const open = await page.evaluate(() => document.querySelector('.sidebar')?.getBoundingClientRect().x >= 0);
      if (!open) {
        await page.click('#appSidebarToggle');
        await page.waitForFunction(
          () => document.querySelector('.sidebar')?.getBoundingClientRect().x >= 0,
          { timeout: 5000 },
        );
      }
    };
    const heading = () => page.evaluate(() => {
      const m = document.querySelector('.dashboard-main, #appMain, main') || document.body;
      return (m.innerText || '').trim().split('\n').map((s) => s.trim()).filter(Boolean)[0] || '(empty)';
    });

    // --- every screen actually lands on itself ------------------------------
    for (const [id, expected] of [
      ['pastNewsBtn', 'REPORTER NEWS REVIEW'],
      ['reportersBtn', 'Reporters'],
      ['settingsBtn', 'General settings'],
      ['epaperBtn', 'E-paper'],
      ['pastBtn', 'आजचा अंक'],
    ]) {
      await openNav();
      await page.click(`#${id}`);
      await page.waitForTimeout(1200);
      check(`#${id} opens its own screen`, (await heading()).includes(expected), await heading());
    }

    // --- the review queue ---------------------------------------------------
    await openNav();
    await page.click('#pastNewsBtn');
    await page.waitForSelector('.admin-news-card', { timeout: 20000 });
    await page.waitForTimeout(400);

    const drawn = await page.locator('.admin-news-card').count();
    // A REVIEW QUEUE IS BOUNDED. It used to draw all 1972 filings - 17,780 DOM
    // nodes, ~1030 ms - every time the screen opened.
    check('the queue draws a bounded first page', drawn > 0 && drawn <= 60, `${drawn} cards`);
    const nodes = await page.evaluate(() => document.querySelectorAll('*').length);
    check('so the screen stays a screen, not a wall', nodes < 4000, `${nodes} DOM nodes`);
    check('it is searchable', await page.locator('#adminNewsSearch').count() === 1);
    check('and filterable by status', await page.locator('#adminNewsStatus').count() === 1);
    check('and says how many filings there are',
      /filings/.test(await page.locator('#adminNewsCount').textContent()),
      (await page.locator('#adminNewsCount').textContent()).trim());

    await page.fill('#adminNewsSearch', 'zzzz-no-such-filing');
    await page.waitForTimeout(400);
    check('a search with no match says so',
      (await page.locator('#adminNewsList').textContent()).includes('No filing matches'));
    await page.fill('#adminNewsSearch', '');
    await page.waitForTimeout(400);

    // A decision must repaint ITS OWN card. It used to call showPastNews()
    // again, so passing one story rebuilt the whole queue.
    await page.evaluate(() => { document.querySelector('.admin-news-card').dataset.stamp = 'keep'; });

    // A REFUSED decision must be reported rather than swallowed: the PATCH's
    // answer used to go unread, so a 500 repainted the same status silently.
    await page.route('**/api/news/*/status', (r) => r.fulfill({
      status: 500, contentType: 'application/json', body: '{"error":"the desk could not record that"}',
    }));
    dialog = null;
    const before = await page.evaluate(() => document.querySelector('.admin-news-card .status-pill').textContent.trim());
    await page.evaluate(() => document.querySelector('.admin-news-card .approve').click());
    await page.waitForTimeout(1200);
    check('a refused decision tells the desk', Boolean(dialog), dialog || '(silent)');
    check('and the card keeps its real status',
      (await page.evaluate(() => document.querySelector('.admin-news-card .status-pill').textContent.trim())) === before,
      before);
    check('and the queue was not rebuilt underneath it',
      await page.evaluate(() => document.querySelector('.admin-news-card').dataset.stamp === 'keep'));
    await page.unroute('**/api/news/*/status');

    // --- a cached failure must not outlive the blip -------------------------
    // One failed /api/templates used to be cached forever: `templates.map is
    // not a function`, the Layout picker gone for the rest of the session.
    const fresh = await browser.newPage({ viewport: { width: 1512, height: 950 } });
    const freshErrors = [];
    fresh.on('pageerror', (e) => freshErrors.push(String(e.message).slice(0, 120)));
    let served = 0;
    await fresh.route('**/api/templates', (route) => (served++ === 0
      ? route.fulfill({ status: 500, contentType: 'application/json', body: '{"error":"blip"}' })
      : route.continue()));
    await fresh.goto(BASE, { waitUntil: 'networkidle' });
    if (await fresh.locator('#email').count()) {
      await fresh.fill('#email', 'admin@esahas.com');
      await fresh.fill('#password', 'admin123');
      await fresh.click('#loginBtn');
    }
    await fresh.waitForSelector('.edition-row', { timeout: 20000 });
    const ed = await fresh.evaluate(() => document.querySelector('.edition-row')?.dataset.editionId);
    await fresh.locator(`.edition-row[data-edition-id="${ed}"] .edition-open`).click();
    await fresh.waitForSelector('#canvasSurface', { timeout: 30000 }).catch(() => {});
    await fresh.waitForTimeout(3500);
    check('a failed templates fetch throws nothing at the desk', freshErrors.length === 0,
      freshErrors[0] || 'no exceptions');
    await fresh.evaluate(() => document.querySelectorAll('.page-pill')[1]?.click());
    await fresh.waitForTimeout(2500);
    check('and the Layout picker comes back once the blip is over',
      await fresh.locator('#layoutSelect').count() === 1);
    check('because the failure was never cached', served >= 2, `${served} requests`);
    await fresh.close();

    check('no page exceptions anywhere', errors.length === 0, errors[0] || 'none');
  } catch (error) {
    console.log(`\nCRASHED after ${pass + fail} checks: ${error.message}`);
    fail += 1;
  } finally {
    console.log(`\n${pass}/${pass + fail} passed`);
    await browser.close();
    process.exit(fail ? 1 : 0);
  }
})();
