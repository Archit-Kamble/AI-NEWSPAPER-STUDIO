// Screenshots all 4 pages of Project A's realistic test edition
// (scripts/build-test-edition.js) for real visual inspection - "does not
// look wrong" is a claim that has to be checked with eyes, not assumed
// because preflight came back clean. Same launch pattern as
// tests/browser/workspace.browser.js.
//
// node scripts/screenshot-test-edition.js [editionId]

const { chromium } = require('playwright-core');
const path = require('path');

const BASE = process.env.SAHAS_BASE || 'http://localhost:3000';
const ED = Number(process.argv[2] || process.env.SAHAS_EDITION);
const CHROME = process.env.CHROME_PATH || '/usr/bin/google-chrome';
const OUT_DIR = process.argv[3] || '/tmp/claude-1000/-home-archit-kamble-ai-newspaper-studio/eb1a2a54-e0f8-4629-bcd1-291a103bbec3/scratchpad';

(async () => {
  if (!ED) throw new Error('usage: node scripts/screenshot-test-edition.js <editionId>');

  const browser = await chromium.launch({ executablePath: CHROME, args: ['--no-sandbox'] });
  // At 100% zoom the page (1060px) is taller than any reasonable viewport, and
  // an element screenshot of something taller than the viewport gets stitched
  // from several scrolled captures - the workspace's sticky toolbar (CLAUDE.md:
  // "a sticky grid item is confined to its whole grid") re-appears in every
  // slice, an artifact that looks like a real rendering bug but is not one.
  // "Fit" zoom instead shrinks the WHOLE page to comfortably inside one
  // viewport - no scrolling, no stitching - and a high deviceScaleFactor keeps
  // it legible despite the small CSS size.
  const page = await (await browser.newContext({
    viewport: { width: 1512, height: 950 },
    deviceScaleFactor: 3,
  })).newPage();

  await page.goto(BASE);
  await page.waitForTimeout(900);
  if (await page.locator('#email').count()) {
    await page.fill('#email', 'admin@esahas.com');
    await page.fill('#password', 'admin123');
    await page.click('#loginBtn');
  }
  await page.waitForSelector('.edition-row', { timeout: 20000 });
  const when = await page.evaluate(
    (ed) => fetch(`/api/newspapers/${ed}`).then((r) => r.json()).then((n) => String(n.publication_date).slice(0, 10)),
    ED,
  );
  await page.fill('#editionSearch', when);
  await page.waitForTimeout(700);
  await page.locator(`.edition-row[data-edition-id="${ED}"] button`).click();
  await page.waitForSelector('#canvasSurface', { timeout: 20000 });
  await page.waitForTimeout(1500);

  const pills = await page.locator('.page-pill').count();
  console.log(`found ${pills} page pills`);

  const printView = process.argv.includes('--print-view');
  if (printView) {
    await page.locator('#printViewBtn').click();
    await page.waitForTimeout(300);
  }

  for (let i = 0; i < pills; i += 1) {
    await page.locator('.page-pill').nth(i).click();
    await page.waitForTimeout(1000);

    // Close the Block Editor if a block is selected - "Back to page" clears
    // the selection, same as a desk clicking away. Without this the dock
    // stays open below the canvas and is not part of the printed page.
    if (await page.locator('#edReturnToPage').count()) {
      await page.locator('#edReturnToPage').click();
      await page.waitForTimeout(400);
    }

    await page.selectOption('#zoomSelect', 'fit');
    await page.waitForTimeout(700);

    const surface = page.locator('#canvasSurface');
    await surface.evaluate((el) => el.scrollIntoView({ block: 'start', inline: 'nearest' }));
    await page.waitForTimeout(300);
    // Chromium element screenshots include a fixed ancestor's paint layer when
    // it overlaps the element. The workspace toolbar is fixed while scrolling,
    // so temporarily hide only that chrome for a truthful page-only capture.
    await page.evaluate(() => {
      document.querySelectorAll('.workspace-toolbar, .app-header, .topbar').forEach((el) => { el.dataset.sahasCaptureHidden = el.style.visibility; el.style.visibility = 'hidden'; });
    });
    const suffix = printView ? '-print' : '';
    const file = path.join(OUT_DIR, `test-edition-page-${i + 1}${suffix}.png`);
    await surface.screenshot({ path: file });
    await page.evaluate(() => {
      document.querySelectorAll('[data-sahas-capture-hidden]').forEach((el) => { el.style.visibility = el.dataset.sahasCaptureHidden; delete el.dataset.sahasCaptureHidden; });
    });
    console.log(`wrote ${file}`);
  }

  await browser.close();
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
