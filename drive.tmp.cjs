const { chromium } = require('playwright-core');
const OUT='/tmp/shots';
(async () => {
  const b = await chromium.launch({ executablePath: '/usr/bin/google-chrome' });
  const page = await b.newPage({ viewport: { width: 1512, height: 950 }, deviceScaleFactor: 3 });
  await page.goto('http://localhost:3000'); await page.waitForTimeout(900);
  if (await page.locator('#email').count()) { await page.fill('#email','admin@esahas.com'); await page.fill('#password','admin123'); await page.click('button[type=submit]'); await page.waitForTimeout(1800); }
  await page.goto('http://localhost:3000/#!/edition/54470'); await page.waitForTimeout(5500);
  await page.click('#printViewBtn').catch(()=>{});
  await page.waitForTimeout(1200);
  // zoom to 150%
  await page.selectOption('#zoomSelect','1.5').catch(()=>{});
  await page.waitForTimeout(1200);
  const el = await page.$('.newspaper-section[data-section-key="panchang"]');
  if (el) { await el.scrollIntoViewIfNeeded(); await el.screenshot({ path: OUT+'/canvas-card.png' }); console.log('shot ok'); }
  else console.log('no block');
  await b.close();
})();
