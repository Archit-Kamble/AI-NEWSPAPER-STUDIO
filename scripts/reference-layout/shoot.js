// Photographs one page of an edition's SHEET for comparison against a scan.
//
//   node scripts/reference-layout/shoot.js <editionId> <page> <out.png> [view] [dpr]
//
// view (Astra's three comparison views, so a mismatch can be told apart as
// geometry, typography or the weight of the photographs):
//   full        - the page as it prints
//   structure   - every word hidden: frames, pictures, rules and grounds only
//   typography  - every picture replaced by a neutral grey rectangle
//
// dpr is device pixels per editor pixel. Pass the scan's own pixels per editor
// pixel (compare.py prints it) so the render is compared at the scan's
// resolution rather than upscaled - a 2x render stretched 2.2x to meet a scan
// blurs exactly the strokes being judged.
//
// The sheet is cloned into a full-screen layer and that is what is captured:
// an element screenshot inside the workspace catches the sticky chrome over it.

const { chromium } = require('playwright-core');
const { DESK_EMAIL, DESK_PASSWORD } = require('../../tests/browser/helpers/desk-login');

const [ED, PAGE, OUT, VIEW = 'full', DPR = '4.33'] = process.argv.slice(2);
if (!ED || !PAGE || !OUT) {
  console.error('usage: shoot.js <editionId> <page> <out.png> [full|structure|typography] [dpr]');
  process.exit(2);
}

const VIEW_CSS = {
  full: '',
  structure: `#shotLayer .newspaper-canvas * { color: transparent !important; -webkit-text-fill-color: transparent !important; text-shadow: none !important; }`,
  typography: `#shotLayer .section-placed-image, #shotLayer .section-image { visibility: hidden !important; }
               #shotLayer .section-placed, #shotLayer .section-image-box { background: #c8c8c8 !important; }`,
};

(async () => {
  if (!(VIEW in VIEW_CSS)) throw new Error(`unknown view ${VIEW}`);
  const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || '/usr/bin/google-chrome' });
  const page = await browser.newPage({ viewport: { width: 1700, height: 1400 }, deviceScaleFactor: Number(DPR) });
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto('http://localhost:3000/', { waitUntil: 'networkidle' });
  if (await page.locator('#email').count()) {
    await page.fill('#email', DESK_EMAIL);
    await page.fill('#password', DESK_PASSWORD);
    await page.click('#loginBtn');
  }
  await page.waitForSelector('.edition-row', { timeout: 25000 });
  await page.goto(`http://localhost:3000/#!/edition/${ED}`);
  await page.waitForSelector('.workspace-shell', { timeout: 60000 });
  await page.waitForTimeout(3000);
  await page.locator('#printViewBtn').click();
  await page.selectOption('#zoomSelect', '1');
  await page.waitForTimeout(1000);
  await page.locator(`.page-pill[title="Page ${PAGE}"]`).click();
  await page.waitForTimeout(4000);
  await page.evaluate((css) => {
    document.getElementById('shotLayer')?.remove();
    const layer = document.createElement('div');
    layer.id = 'shotLayer';
    layer.style.cssText = 'position:fixed;inset:0;z-index:2147483647;background:#fff;overflow:hidden';
    const clone = document.querySelector('.newspaper-canvas').cloneNode(true);
    clone.style.transform = 'none';
    clone.style.margin = '0';
    layer.appendChild(clone);
    const style = document.createElement('style');
    style.textContent = css;
    layer.appendChild(style);
    document.body.appendChild(layer);
  }, VIEW_CSS[VIEW]);
  await page.waitForTimeout(800);
  await page.locator('#shotLayer .newspaper-canvas').screenshot({ path: OUT });
  console.log(`shot page ${PAGE} (${VIEW}, dpr ${DPR}) -> ${OUT}; page errors: ${errors.length}`);
  await browser.close();
  if (errors.length) process.exit(1);
})().catch((e) => { console.error(e); process.exit(1); });
