const { chromium } = require('playwright-core');
(async () => {
  const b = await chromium.launch({ executablePath: '/usr/bin/google-chrome' });
  const page = await b.newPage({ viewport: { width: 1512, height: 950 } });
  await page.goto('http://localhost:3000'); await page.waitForTimeout(900);
  if (await page.locator('#email').count()) { await page.fill('#email','admin@esahas.com'); await page.fill('#password','admin123'); await page.click('button[type=submit]'); await page.waitForTimeout(1800); }
  await page.goto('http://localhost:3000/#!/edition/54470'); await page.waitForTimeout(5000);
  await page.evaluate(() => document.querySelector('.newspaper-section[data-section-key="anchor"]')?.click());
  await page.waitForTimeout(2500);
  await page.click('.assist-tab[data-assist-tab="block"]'); await page.waitForTimeout(1200);
  console.log(await page.evaluate(()=>{
    const t=document.querySelector('.workspace-top');
    const h=document.querySelector('.workspace-canvas-host');
    return JSON.stringify({cls:t.className, cols:getComputedStyle(t).gridTemplateColumns,
      hostW:h.getBoundingClientRect().width, hostCS:getComputedStyle(h).width, maxW:getComputedStyle(h).maxWidth});
  }));
  await b.close();
})();
