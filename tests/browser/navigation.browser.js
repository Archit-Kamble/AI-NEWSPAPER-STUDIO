// THE DESK'S OWN BACK BUTTON.
//
// This product had no history handling at all until navigation.js, so every
// screen was the same history entry as the login page and Back left the
// application. None of that is visible in `npm test` - a router is a fact
// about a browser - and the one fault that mattered most was invisible in the
// code too: Chrome fires popstate with a NULL state before hashchange for a
// fragment navigation, so an address the desk typed was trusted without being
// checked.
//
//   node tests/browser/navigation.browser.js
//
// Needs playwright-core and Chrome at /usr/bin/google-chrome (CHROME_PATH
// overrides), against a running server on :3000.
const { chromium } = require('playwright-core');
const { DESK_EMAIL, DESK_PASSWORD } = require('./helpers/desk-login');

const BASE = process.env.BASE || 'http://localhost:3000';
let pass = 0, fail = 0;
const check = (n, ok, d='') => { ok ? pass++ : fail++; console.log(`${ok?'PASS':'FAIL'}  ${n}${d?` :: ${d}`:''}`); };

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || '/usr/bin/google-chrome' });
  const page = await browser.newPage({ viewport: { width: 1512, height: 950 } });
  const errors = [];
  page.on('pageerror', e => errors.push(String(e.message).slice(0,160)));
  page.on('dialog', async d => { await d.accept(); });
  try {
    await page.goto(BASE, { waitUntil: 'networkidle' });
    if (await page.locator('#email').count()) {
      await page.fill('#email',DESK_EMAIL); await page.fill('#password',DESK_PASSWORD);
      await page.click('#loginBtn');
    }
    await page.waitForSelector('.edition-row', { timeout: 25000 });

    check('lands with an address', (await page.evaluate(()=>location.hash)) === '#!/past-newspapers',
      await page.evaluate(()=>location.hash));

    const openNav = async () => {
      const open = await page.evaluate(()=>document.querySelector('.sidebar')?.getBoundingClientRect().x >= 0);
      if (!open) { await page.click('#appSidebarToggle');
        await page.waitForFunction(()=>document.querySelector('.sidebar')?.getBoundingClientRect().x>=0,{timeout:5000}); }
    };

    // --- the sidebar's New Edition button, above Past Newspapers ------------
    await openNav();
    const order = await page.evaluate(()=>[...document.querySelectorAll('.sidebar-btn')].map(b=>b.id));
    check('New Edition sits above Past Newspapers',
      order.indexOf('newEditionBtn') === 0 && order.indexOf('pastBtn') === 1, order.slice(0,3).join(' > '));

    await page.click('#newEditionBtn');
    await page.waitForTimeout(900);
    check('New Edition opens the creator', await page.evaluate(()=>{
      const f = document.querySelector('#editionCreator'); return !!f && !f.hidden; }));
    check('  and has its own address', (await page.evaluate(()=>location.hash))==='#!/new-edition',
      await page.evaluate(()=>location.hash));

    // --- every screen pushes, Back walks them ------------------------------
    for (const [id, hash] of [['pastNewsBtn','#!/past-news'],['reportersBtn','#!/reporters'],['settingsBtn','#!/settings']]) {
      await openNav(); await page.click('#'+id); await page.waitForTimeout(800);
      check(`${id} -> ${hash}`, (await page.evaluate(()=>location.hash))===hash, await page.evaluate(()=>location.hash));
    }
    const litFor = () => page.evaluate(()=>document.querySelector('.sidebar-btn.active')?.id||'(none)');
    check('the lit sidebar button follows the screen', (await litFor())==='settingsBtn', await litFor());

    await page.goBack(); await page.waitForTimeout(900);
    check('Back -> reporters', (await page.evaluate(()=>location.hash))==='#!/reporters', await page.evaluate(()=>location.hash));
    check('  and it repainted', (await page.evaluate(()=>document.body.innerText)).toLowerCase().includes('reporter'));
    await page.goBack(); await page.waitForTimeout(900);
    check('Back -> past-news', (await page.evaluate(()=>location.hash))==='#!/past-news', await page.evaluate(()=>location.hash));
    await page.goForward(); await page.waitForTimeout(900);
    check('Forward -> reporters', (await page.evaluate(()=>location.hash))==='#!/reporters', await page.evaluate(()=>location.hash));

    // --- an edition is an address, and Back leaves it ----------------------
    await openNav(); await page.click('#pastBtn'); await page.waitForSelector('.edition-row',{timeout:15000});
    await page.click('.edition-open');
    await page.waitForSelector('.workspace-shell', { timeout: 45000 });
    const editionHash = await page.evaluate(()=>location.hash);
    check('opening an edition is an address', /^#!\/edition\/\d+$/.test(editionHash), editionHash);

    // the hamburger must be reachable from deep inside the edition
    await page.evaluate(()=>window.scrollTo(0, 1600));
    await page.waitForTimeout(400);
    const ham = await page.evaluate(()=>{
      const b = document.getElementById('appSidebarToggle'); if (!b) return null;
      const r = b.getBoundingClientRect();
      const hit = document.elementFromPoint(r.x + r.width/2, r.y + r.height/2);
      return { y: Math.round(r.y), scrolled: Math.round(window.scrollY), reachable: !!hit && (hit===b || b.contains(hit)) };
    });
    check('the menu button is still on screen 1600px down', ham && ham.y >= 0 && ham.y < 900 && ham.reachable, JSON.stringify(ham));

    await page.goBack(); await page.waitForTimeout(2500);
    check('Back leaves the edition', (await page.evaluate(()=>location.hash))==='#!/past-newspapers', await page.evaluate(()=>location.hash));
    check('  and the workspace is gone', (await page.evaluate(()=>!!document.querySelector('.workspace-shell')))===false);
    check('  and the dashboard is back', await page.evaluate(()=>!!document.querySelector('.edition-row')));

    // --- a reload comes back to where the desk was -------------------------
    await page.goto(BASE + '/' + editionHash, { waitUntil: 'networkidle' });
    await page.waitForSelector('.workspace-shell', { timeout: 45000 });
    check('a reload comes back to the open edition', await page.evaluate(()=>!!document.querySelector('.workspace-shell')), editionHash);

    // --- a nonsense address does not blank the screen ----------------------
    await page.goto(BASE + '/#!/not-a-screen', { waitUntil: 'networkidle' });
    await page.waitForTimeout(2500);
    check('a nonsense address lands on the dashboard',
      (await page.evaluate(()=>location.hash))==='#!/past-newspapers' && await page.evaluate(()=>!!document.querySelector('.edition-row')),
      await page.evaluate(()=>location.hash));

    console.log('\npage errors:', errors.length ? errors.join(' | ') : 'none');
  } catch (e) { console.log('CRASH ::', e.message); fail++; }
  console.log(`\n${pass} passed, ${fail} failed`);
  await browser.close();
  process.exit(fail ? 1 : 0);
})();
