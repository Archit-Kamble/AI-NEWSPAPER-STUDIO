// WHAT A SPACE ON THE PAGE IS WORTH.
//
// `src/layout/rateCard.js` prices a block the way every rate card in the trade
// does, and `GET /pages/:pageId/sections/:sectionKey/rate` has served it since
// it was written. Nothing in the browser had ever asked, so an advert desk
// that quotes a dozen times a day did it with a calculator - beside software
// that already knew the block's width in columns and its height in millimetres
// exactly.
//
// The check that matters most here is the EAR. positionOf() used to look for a
// block right of centre above a hard-coded band; this paper's ear is on the
// left, so the dearest rate in the card was unreachable and every front-page
// ear was billed at the ordinary front-page rate.
//
//   node tests/browser/advert-rate.browser.js            # defaults to 54470
//
// It reads only - nothing here writes to the edition.
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
  const requests=[];
  p.on('request', r=>{ if (/\/rate$/.test(r.url())) requests.push(r.url()); });
  try {
    await p.goto(BASE,{waitUntil:'networkidle'});
    if (await p.locator('#email').count()) { await p.fill('#email','admin@esahas.com'); await p.fill('#password','admin123'); await p.click('#loginBtn'); }
    await p.waitForSelector('.edition-row',{timeout:25000});
    // The list searches the DATE, never the id, so look the edition up first.
    const when = await p.evaluate(async (id) => {
      const paper = await fetch(`/api/newspapers/${id}`).then((r) => r.json());
      return String(paper.publication_date || '').slice(0, 10);
    }, EDITION);
    await p.fill('#editionSearch', when);
    await p.waitForSelector(`.edition-row[data-edition-id="${EDITION}"]`, { timeout: 15000 });
    await p.locator(`.edition-row[data-edition-id="${EDITION}"] .edition-open`).click();
    await p.waitForSelector('.workspace-shell',{timeout:60000});
    await p.waitForTimeout(2500);

    // select the ear on page one
    await p.click('.newspaper-section[data-section-key="masthead-advert"]');
    await p.waitForTimeout(1800);
    // Properties shows block controls only while the whole BLOCK is selected
    await p.keyboard.press('Escape');
    await p.waitForTimeout(1200);

    check('the block carries a rate disclosure', await p.locator('.prop-rate').count()===1);
    check('  and it is CLOSED, so no request was made', requests.length===0, `${requests.length} requests`);

    await p.locator('.prop-rate summary').click();
    await p.waitForTimeout(2500);
    check('opening it asks the server once', requests.length===1, `${requests.length} requests`);
    const body = await p.locator('.prop-rate-body').innerText();
    check('  and the price is shown', /₹/.test(body), body.split('\n')[0]);
    check('  and the front-page EAR is priced as the ear',
      /नामपट्टीशेजारी/.test(body), (body.match(/Position\s*\n?(.*)/)||[])[1]||body.slice(0,60));
    check('  in column-centimetres, the way a rate card is written', /col-cm/.test(body));
    check('  and the colour surcharge is named', /Colour/.test(body));

    // closing and reopening does not ask again
    await p.locator('.prop-rate summary').click();
    await p.waitForTimeout(400);
    await p.locator('.prop-rate summary').click();
    await p.waitForTimeout(1200);
    check('reopening does not ask again', requests.length===1, `${requests.length} requests`);

    // a different block gets a different price
    await p.click('.newspaper-section[data-section-key="lead"]');
    await p.waitForTimeout(1500);
    await p.keyboard.press('Escape');
    await p.waitForTimeout(1200);
    await p.locator('.prop-rate summary').click();
    await p.waitForTimeout(2500);
    const leadBody = await p.locator('.prop-rate-body').innerText();
    check('another block is priced separately', requests.length===2, `${requests.length} requests`);
    check('  and the lead is NOT the ear', !/नामपट्टीशेजारी/.test(leadBody), leadBody.split('\n')[0]);

    console.log('\npage errors:', errors.length?errors.join(' | '):'none');
  } catch(e){ console.log('CRASH ::', e.message); fail++; }
  console.log(`\n${pass} passed, ${fail} failed`);
  await b.close(); process.exit(fail?1:0);
})();
