const { chromium } = require('playwright-core');
const OUT='/tmp/claude-1000/-home-archit-kamble-ai-newspaper-studio/eb1a2a54-e0f8-4629-bcd1-291a103bbec3/scratchpad/shots';
(async () => {
  const b = await chromium.launch({ executablePath: '/usr/bin/google-chrome' });
  const page = await b.newPage({ viewport: { width: 1512, height: 950 } });
  const errs=[]; page.on('pageerror',e=>errs.push(e.message));
  await page.goto('http://localhost:3000'); await page.waitForTimeout(900);
  if (await page.locator('#email').count()) { await page.fill('#email','admin@esahas.com'); await page.fill('#password','admin123'); await page.click('button[type=submit]'); await page.waitForTimeout(1800); }
  await page.goto('http://localhost:3000/#!/edition/54470'); await page.waitForTimeout(5000);
  // page 2 carries the imprint
  await page.click('.page-pill:nth-child(2), [data-page-number="2"]').catch(()=>{});
  await page.waitForTimeout(2500);
  const im = await page.evaluate(()=>{
    const e=document.querySelector('.page-imprint');
    if(!e) return null;
    const b=e.getBoundingClientRect();
    return {h:e.offsetHeight, sh:e.scrollHeight, styleH:e.style.height, boxes:[...e.querySelectorAll('.imprint-box')].map(x=>x.offsetHeight),
      text:e.innerText.replace(/\s+/g,' ').slice(0,400)};
  });
  console.log(JSON.stringify(im,null,1));
  const el = await page.$('.page-imprint');
  if (el) await el.screenshot({ path: OUT+'/07-imprint.png' });
  console.log('ERR',errs.slice(0,4));
  await b.close();
})();
