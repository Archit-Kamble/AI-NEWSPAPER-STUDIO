// THE PRESS PANEL - PASSING A PAGE, AND CHOOSING ITS FORME.
//
// Both controls reach services that were fully built and fully tested and that
// NOTHING in the browser could reach: `PATCH /pages/:id/state` and
// `PATCH /pages/:id/colour` appeared nowhere under public/, and neither did
// `GET /newspapers/:id/status`, which is the whole per-page picture this panel
// is made of. Since pressReadiness blocks on PAGE_NOT_PASSED, that left the
// press package, the press-final e-paper and the CMYK export gated on a
// readiness no control could ever produce.
//
// tests/press.test.js holds the sign-off RULES and tests/pressPanelContract
// holds the payload. What only a browser can show is whether the control is
// there, whether it reaches the server, and - the half that matters most -
// whether a refusal arrives as a reason or as a shrug.
//
//   node tests/browser/press-panel.browser.js            # defaults to 54470
//
// It leaves every page on the stage and forme it found them.
//
// Needs playwright-core and Chrome at /usr/bin/google-chrome (CHROME_PATH
// overrides), against a running server on :3000.

const { chromium } = require('playwright-core');
const BASE = process.env.BASE || 'http://localhost:3000';
const EDITION = Number(process.argv[2]) || 54470;
let pass=0, fail=0;
const check=(n,ok,d='')=>{ok?pass++:fail++;console.log(`${ok?'PASS':'FAIL'}  ${n}${d?` :: ${d}`:''}`);};
(async()=>{
  const b = await chromium.launch({ executablePath: process.env.CHROME_PATH || '/usr/bin/google-chrome' });
  const p = await b.newPage({ viewport:{width:1512,height:950} });
  const errors=[]; p.on('pageerror',e=>errors.push(e.message.slice(0,160)));
  p.on('dialog', async d=>{ await d.accept(); });
  try {
    await p.goto(BASE,{waitUntil:'networkidle'});
    if (await p.locator('#email').count()) { await p.fill('#email','admin@esahas.com'); await p.fill('#password','admin123'); await p.click('#loginBtn'); }
    await p.waitForSelector('.edition-row',{timeout:25000});
    // The list shows the twelve most recent editions and searches the DATE,
    // never the id, so the edition is looked up first.
    const when = await p.evaluate(async (id) => {
      const paper = await fetch(`/api/newspapers/${id}`).then((r) => r.json());
      return String(paper.publication_date || '').slice(0, 10);
    }, EDITION);
    await p.fill('#editionSearch', when);
    await p.waitForSelector(`.edition-row[data-edition-id="${EDITION}"]`, { timeout: 15000 });
    await p.locator(`.edition-row[data-edition-id="${EDITION}"] .edition-open`).click();
    await p.waitForSelector('.workspace-shell',{timeout:60000});
    await p.waitForTimeout(2500);

    await p.click('#tbPreflight');
    await p.waitForSelector('#preflightPanel',{timeout:20000});
    await p.waitForTimeout(1500);
    check('the Preflight door opens a press panel', await p.locator('.press-panel').count()===1);
    const head = await p.locator('#preflightPanel header strong').innerText();
    check('  and it says where the edition stands', /Press —/.test(head), head);
    check('every page is listed', await p.locator('.press-page').count()===4,
      `${await p.locator('.press-page').count()} pages`);
    check('each page shows its stage', await p.locator('.press-state').count()===4);
    check('each page shows its forme', await p.locator('.press-forme').count()===4);

    // --- the forme -------------------------------------------------------
    const forme = p.locator('.press-page[data-page-number="2"] .press-forme');
    check('page 2 starts on a colour forme', (await forme.getAttribute('aria-pressed'))==='true',
      await forme.innerText());
    await forme.click();
    await p.waitForTimeout(4000);
    const nowMono = await p.evaluate(async (id)=>{
      const pages = await fetch(`/api/newspapers/${id}/pages`).then(r=>r.json());
      return pages.find(x=>x.page_number===2).prints_colour;
    }, EDITION);
    check('pressing it puts the page on a mono forme', nowMono===false, `prints_colour=${nowMono}`);
    check('  and the button says so', (await p.locator('.press-page[data-page-number="2"] .press-forme').innerText())==='Mono');
    // put it back
    await p.locator('.press-page[data-page-number="2"] .press-forme').click();
    await p.waitForTimeout(4000);
    const backColour = await p.evaluate(async (id)=>{
      const pages = await fetch(`/api/newspapers/${id}/pages`).then(r=>r.json());
      return pages.find(x=>x.page_number===2).prints_colour;
    }, EDITION);
    check('  and it goes back', backColour===true);

    // --- the stage -------------------------------------------------------
    const sel = p.locator('.press-page[data-page-number="2"] select[data-page-state]');
    check('page 2 starts at Being made up', (await sel.inputValue())==='making_up');
    await sel.selectOption('subbed');
    await p.waitForTimeout(3000);
    const subbed = await p.evaluate(async (id)=>{
      const s = await fetch(`/api/newspapers/${id}/status`).then(r=>r.json());
      return s.pages.find(x=>x.page_number===2).production_state;
    }, EDITION);
    check('the desk can sub a page', subbed==='subbed', subbed);
    // --- a page that is NOT ready says exactly why --------------------------
    check('a page that cannot go to press says how many things stop it',
      await p.locator('.press-page[data-page-number="2"] .press-errors').count()===1,
      await p.locator('.press-page[data-page-number="2"] .press-errors').innerText().catch(()=>''));
    check('  and lists them, in the server\'s own words',
      await p.locator('.press-page[data-page-number="2"] .press-blockers li').count()>0,
      await p.locator('.press-page[data-page-number="2"] .press-blockers li').first().innerText().catch(()=>''));

    await p.locator('.press-page[data-page-number="2"] select[data-page-state]').selectOption('passed');
    await p.waitForTimeout(3500);
    const refused = await p.evaluate(async (id)=>{
      const s = await fetch(`/api/newspapers/${id}/status`).then(r=>r.json());
      return s.pages.find(x=>x.page_number===2).production_state;
    }, EDITION);
    check('pressing Passed on a page that is not ready is REFUSED', refused!=='passed', refused);
    const notice = await p.evaluate(()=>document.getElementById('deskNotice')?.innerText||'');
    check('  and the desk is told the reason, not just "no"',
      /cannot go to press/.test(notice) && notice.length>60, notice.slice(0,110));
    check('  and the control goes back to what is true', 
      (await p.locator('.press-page[data-page-number="2"] select[data-page-state]').inputValue())!=='passed');

    // put page 2 back
    await p.locator('.press-page[data-page-number="2"] select[data-page-state]').selectOption('making_up');
    await p.waitForTimeout(2500);
    const restored = await p.evaluate(async (id)=>{
      const s = await fetch(`/api/newspapers/${id}/status`).then(r=>r.json());
      return s.pages.find(x=>x.page_number===2).production_state;
    }, EDITION);
    check('a page can be pulled back off the stone', restored==='making_up', restored);

    console.log('\npage errors:', errors.length?errors.join(' | '):'none');
  } catch(e){ console.log('CRASH ::', e.message); fail++; }
  console.log(`\n${pass} passed, ${fail} failed`);
  await b.close(); process.exit(fail?1:0);
})();
