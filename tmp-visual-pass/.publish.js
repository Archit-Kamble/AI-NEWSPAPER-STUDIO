const { chromium } = require('playwright-core');
(async () => {
  const b = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--no-sandbox'] });
  const page = await (await b.newContext()).newPage();
  await page.goto('http://localhost:3000');
  await page.waitForTimeout(900);
  if (await page.locator('#email').count()) {
    await page.fill('#email', 'admin@esahas.com'); await page.fill('#password', 'admin123'); await page.click('#loginBtn');
  }
  await page.waitForSelector('.edition-row', { timeout: 20000 });
  const out = await page.evaluate(async (ed) => {
    const r = await fetch(`/api/newspapers/${ed}/publish-current`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    return { status: r.status, body: (await r.text()).slice(0, 400) };
  }, Number(process.argv[2]));
  console.log(out.status, out.body);
  await b.close();
})();
