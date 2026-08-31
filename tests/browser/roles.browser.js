// WHAT EACH ROLE ACTUALLY SEES.
//
// tests/roles.test.js proves the ROUTES refuse the right people. It cannot see
// the other half, which is the half a desk meets: whether the screen offers a
// control that will then be refused, or hides one the person is entitled to.
// This product's rule is "a control that cannot act is not offered", and the
// only way to check it is to sign in and look.
//
//   node tests/browser/roles.browser.js [editionId]
//
// It creates its own three logins through the real owner API and removes them
// afterwards, crash path included - the dev database grew to 221 editions the
// other way.

require('dotenv').config();
const { chromium } = require('playwright-core');
// There is deliberately no DELETE route for a login - an owner blocks an
// account, because blocking keeps the filing and review history that a
// newsroom has to be able to answer for. So this net removes its own
// throwaway rows the only way there is: directly, which it may do because it
// made them and knows their ids.
const pool = require('../../src/config/db');

const BASE = process.env.SAHAS_BASE || 'http://localhost:3000';
const ED = Number(process.argv[2] || process.env.SAHAS_EDITION || 2099);
const CHROME = process.env.CHROME_PATH || '/usr/bin/google-chrome';
const SUFFIX = `${process.pid}-${Date.now()}`;
const PASSWORD = 'role-net-pass-1';
const emailFor = (role) => `zz-net-${role}-${SUFFIX}@example.test`;

let pass = 0;
let fail = 0;
// A run that threw is not a run that passed. `finally` below reports and exits,
// and it used to exit 0 whenever no CHECK had failed - so a click that timed
// out mid-sweep printed a green tally and took every later check with it
// silently. That is the exact fault CLAUDE.md names: a browser test that
// crashes is worse than one that fails.
let crashed = null;
const check = (name, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` :: ${detail}` : ''}`);
  if (ok) pass += 1; else fail += 1;
};

(async () => {
  const browser = await chromium.launch({ executablePath: CHROME, args: ['--no-sandbox'] });
  const made = [];

  // The owner's own session, out here in Node - `page.request` shares a browser
  // context's cookies, and each role below needs a context of its own.
  const ownerContext = await browser.newContext();
  const ownerApi = ownerContext.request;
  const signInOwner = await ownerApi.post(`${BASE}/api/auth/login`, {
    data: { email: 'admin@esahas.com', password: 'admin123' },
  });
  if (!signInOwner.ok()) throw new Error(`owner sign-in answered ${signInOwner.status()}`);

  const makeLogin = async (role, name) => {
    const response = await ownerApi.post(`${BASE}/api/staff`, {
      data: { name, email: emailFor(role), password: PASSWORD, role },
    });
    if (!response.ok()) throw new Error(`create ${role} answered ${response.status()}`);
    const person = await response.json();
    made.push(person.id);
    return person;
  };

  try {
    await makeLogin('chief_editor', 'ZZ Sampadak');
    await makeLogin('editor', 'ZZ Editor');
    await makeLogin('reporter', 'ZZ Reporter');

    // Signs in in a FRESH context, so no session leaks between roles.
    const asRole = async (email) => {
      const context = await browser.newContext({ viewport: { width: 1512, height: 950 } });
      const page = await context.newPage();
      const errors = [];
      page.on('pageerror', (e) => errors.push(`pageerror: ${e.message.slice(0, 140)}`));
      page.on('console', (m) => m.type() === 'error' && errors.push(`console: ${m.text().slice(0, 140)}`));
      await page.goto(BASE);
      await page.waitForTimeout(700);
      await page.fill('#email', email);
      await page.fill('#password', PASSWORD);
      await page.click('#loginBtn');
      await page.waitForTimeout(1600);
      return { context, page, errors };
    };

    const sees = (page, id) => page.locator(`#${id}`).count();

    // ---------------------------------------------------------------- editor
    {
      const { context, page, errors } = await asRole(emailFor('editor'));
      // A desk role must land on the DESK dashboard. init() used to ask
      // `role === "admin"`, so an editor reloading the page was handed the
      // REPORTER dashboard - the login path and the reload path disagreed
      // about the same account.
      check('editor lands on the desk dashboard', await sees(page, 'pastBtn') === 1);
      check('  and can start an edition', await sees(page, 'newEditionBtn') === 1);
      check('  but is not offered the review queue', await sees(page, 'pastNewsBtn') === 0);
      check('  nor the paper\'s logins', await sees(page, 'reportersBtn') === 0);
      check('  nor the settings', await sees(page, 'settingsBtn') === 0);
      check('  nor the e-paper', await sees(page, 'epaperBtn') === 0);

      // A screen they have no authority for is not painted just because the
      // address bar asks for it: the form would refuse every save with no
      // sentence saying why.
      await page.goto(`${BASE}/#!/settings`);
      await page.waitForTimeout(1400);
      check('  a typed #!/settings address is not followed', await sees(page, 'settingsGeneralForm') === 0,
        (await page.evaluate(() => window.location.hash)));

      // No Delete door on an edition row.
      await page.goto(`${BASE}/#!/past-newspapers`);
      await page.waitForSelector('.edition-row', { timeout: 20000 });
      check('  no edition carries a Delete button', await page.locator('.edition-delete').count() === 0);

      await page.goto(`${BASE}/#!/edition/${ED}`);
      await page.waitForSelector('#canvasSurface', { timeout: 30000 });
      await page.waitForTimeout(2500);
      check('  the editor CAN make up the paper', await page.locator('.newspaper-section').count() > 0,
        `${await page.locator('.newspaper-section').count()} blocks`);
      check('  and is not offered Publish', await sees(page, 'tbPublish') === 0);
      check('  no page exceptions', errors.length === 0, errors[0] || 'none');
      await context.close();
    }

    // -------------------------------------------------------------- sampadak
    {
      const { context, page, errors } = await asRole(emailFor('chief_editor'));
      check('sampadak lands on the desk dashboard', await sees(page, 'pastBtn') === 1);
      check('  and IS offered the review queue', await sees(page, 'pastNewsBtn') === 1);
      check('  and the e-paper', await sees(page, 'epaperBtn') === 1);
      check('  but not the paper\'s logins', await sees(page, 'reportersBtn') === 0);
      check('  nor the settings', await sees(page, 'settingsBtn') === 0);

      await page.goto(`${BASE}/#!/past-newspapers`);
      await page.waitForSelector('.edition-row', { timeout: 20000 });
      check('  no edition carries a Delete button', await page.locator('.edition-delete').count() === 0);

      await page.goto(`${BASE}/#!/edition/${ED}`);
      await page.waitForSelector('#canvasSurface', { timeout: 30000 });
      await page.waitForTimeout(2500);
      check('  and IS offered Publish', await sees(page, 'tbPublish') === 1);
      check('  no page exceptions', errors.length === 0, errors[0] || 'none');
      await context.close();
    }

    // -------------------------------------------------------------- reporter
    {
      const { context, page, errors } = await asRole(emailFor('reporter'));
      check('a reporter still gets the reporter dashboard', await sees(page, 'pastBtn') === 0);
      check('  and no desk screens at all',
        (await sees(page, 'reportersBtn')) + (await sees(page, 'settingsBtn')) + (await sees(page, 'epaperBtn')) === 0);
      check('  no page exceptions', errors.length === 0, errors[0] || 'none');
      await context.close();
    }

    // ----------------------------------------------------------------- owner
    {
      const context = await browser.newContext({ viewport: { width: 1512, height: 950 } });
      const page = await context.newPage();
      const errors = [];
      page.on('pageerror', (e) => errors.push(`pageerror: ${e.message.slice(0, 140)}`));
      await page.goto(BASE);
      await page.waitForTimeout(700);
      await page.fill('#email', 'admin@esahas.com');
      await page.fill('#password', 'admin123');
      await page.click('#loginBtn');
      await page.waitForTimeout(1600);
      for (const id of ['newEditionBtn', 'pastBtn', 'pastNewsBtn', 'reportersBtn', 'settingsBtn', 'epaperBtn']) {
        check(`owner is offered ${id}`, await sees(page, id) === 1);
      }
      await page.goto(`${BASE}/#!/past-newspapers`);
      await page.waitForSelector('.edition-row', { timeout: 20000 });
      check('owner sees the Delete door', await page.locator('.edition-delete').count() > 0,
        `${await page.locator('.edition-delete').count()} rows`);

      // The Staff screen draws every role, with its own pill, and says what
      // each one may do.
      await page.goto(`${BASE}/#!/reporters`);
      await page.waitForSelector('[data-reporter-row]', { timeout: 20000 });
      await page.waitForTimeout(400);
      const roles = await page.evaluate(() =>
        [...document.querySelectorAll('[data-reporter-row]')].map((r) => r.dataset.role));
      check('the Staff screen lists every role, not only reporters',
        new Set(roles).size >= 3, [...new Set(roles)].join(', '));
      check('  every row wears its role', await page.locator('.role-pill').count() >= roles.length);
      check('  and what each role may do is on the screen', await page.locator('.role-legend li').count() === 4);
      check('  it can be filtered to one role', await page.locator('[data-role-pick]').count() === 5);

      await page.click('[data-role-pick="editor"]');
      await page.waitForTimeout(300);
      const shown = await page.evaluate(() =>
        [...document.querySelectorAll('[data-reporter-row]')].filter((r) => !r.hidden).map((r) => r.dataset.role));
      check('  and the filter shows only that role', shown.length > 0 && shown.every((r) => r === 'editor'),
        `${shown.length} rows, ${[...new Set(shown)].join(',') || 'none'}`);

      // THE FORM SHOWS ONE ROLE'S DESCRIPTION, NOT ALL FOUR. Counting the
      // markup is not enough - the notes are hidden with the `hidden`
      // attribute, and an author `display` rule beats the UA sheet that
      // implements it, so all four printed at once under a picker showing one.
      // Only a VISIBILITY check can see that, which is why this asks the
      // browser what is on the screen rather than what is in the DOM.
      // It runs LAST of the staff checks: opening the form replaces the list.
      await page.click('[data-add-reporter]');
      await page.waitForSelector('[data-role-select]', { timeout: 10000 });
      await page.selectOption('[data-role-select]', 'chief_editor');
      await page.waitForTimeout(250);
      const visibleNotes = await page.evaluate(() => [...document.querySelectorAll('[data-role-note]')]
        .filter((n) => n.offsetParent !== null)
        .map((n) => n.dataset.roleNote));
      check('the role picker shows exactly one description - the chosen one',
        visibleNotes.length === 1 && visibleNotes[0] === 'chief_editor', visibleNotes.join(', ') || 'none');
      await page.selectOption('[data-role-select]', 'reporter');
      await page.waitForTimeout(250);
      const afterSwitch = await page.evaluate(() => [...document.querySelectorAll('[data-role-note]')]
        .filter((n) => n.offsetParent !== null)
        .map((n) => n.dataset.roleNote));
      check('  and it follows the picker', afterSwitch.length === 1 && afterSwitch[0] === 'reporter',
        afterSwitch.join(', ') || 'none');

      check('no page exceptions', errors.length === 0, errors[0] || 'none');
      await context.close();
    }
  } catch (error) {
    crashed = error;
  } finally {
    // The three logins go, whether this run finished or threw. Anything left
    // behind would show up on the owner's own Staff screen for ever.
    await ownerContext.close();
    await browser.close();
    if (made.length) await pool.query('DELETE FROM users WHERE id = ANY($1)', [made]);
    await pool.query(`DELETE FROM users WHERE email LIKE 'zz-net-%@example.test'`);
    await pool.end();
    console.log(`\n${pass} passed, ${fail} failed`);
    if (crashed) {
      console.log(`CRASH (the checks after this point never ran): ${crashed.message}`);
      process.exit(1);
    }
    process.exit(fail ? 1 : 0);
  }
})().catch((error) => { console.error('CRASH:', error); process.exit(1); });
