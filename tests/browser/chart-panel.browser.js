// CHARTS AND PANELS, AS A DESK MEETS THEM.
//
// npm test can ask layoutSmartCard() what a chart resolves to, and it does
// (tests/chartInk.test.js, tests/cardFace.test.js). What it cannot see is the
// browser drawing something other than the answer it was given, or a panel
// that has handles nobody can grab - and every fault in this group was
// reported off a screen recording, not off a stack trace.
//
//   node tests/browser/chart-panel.browser.js [editionId]
//
// It borrows one real block, and puts it back from the crash path as well as
// the success path.

require('dotenv').config();
const { chromium } = require('playwright-core');

const BASE = process.env.SAHAS_BASE || 'http://localhost:3000';
const ED = Number(process.argv[2] || process.env.SAHAS_EDITION || 2099);
const KEY = process.env.SAHAS_BLOCK || 'anchor';
const CHROME = process.env.CHROME_PATH || '/usr/bin/google-chrome';

let pass = 0;
let fail = 0;
let crashed = null;
const check = (name, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` :: ${detail}` : ''}`);
  if (ok) pass += 1; else fail += 1;
};

(async () => {
  const browser = await chromium.launch({ executablePath: CHROME, args: ['--no-sandbox'] });
  const context = await browser.newContext({ viewport: { width: 1500, height: 1000 } });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message.slice(0, 160)}`));
  page.on('console', (m) => m.type() === 'error' && errors.push(`console: ${m.text().slice(0, 160)}`));

  const api = context.request;
  let restore = null;
  let pageId = null;

  try {
    await page.goto(BASE);
    await page.waitForTimeout(800);
    if (await page.locator('#email').count()) {
      await page.fill('#email', 'admin@esahas.com');
      await page.fill('#password', 'admin123');
      await page.click('#loginBtn');
      await page.waitForTimeout(1600);
    }

    const pages = await (await api.get(`${BASE}/api/newspapers/${ED}/pages`)).json();
    pageId = pages[0].id;
    const block = pages[0].sections.find((s) => s.section_key === KEY);
    if (!block) throw new Error(`edition ${ED} page one has no "${KEY}" block`);
    restore = {
      headline: block.headline, subheading: block.subheading, body: block.body,
      insetPanels: block.inset_panels, smartCardKey: block.smart_card_key, smartCardData: block.smart_card_data,
      widthPx: Number(block.width_px), heightPx: Number(block.height_px),
    };
    const W = Number(block.width_px);
    const H = Number(block.height_px);

    const put = (data) => api.put(`${BASE}/api/pages/${pageId}/sections/${KEY}`, { data });
    const readPanels = async () => {
      const fresh = await (await api.get(`${BASE}/api/newspapers/${ED}/pages`)).json();
      return fresh[0].sections.find((s) => s.section_key === KEY).inset_panels || [];
    };
    // A GOTO TO THE SAME URL DIFFERING ONLY BY FRAGMENT DOES NOT RELOAD.
    //
    // `#!/edition/2099` is a same-document navigation, so the second and third
    // time this ran the store still held the edition as it was before the PUT
    // - and the checks read a page that had never been told anything had
    // changed. It reported as the product failing to draw a face and a panel
    // frame; both were fine. Reload explicitly.
    const openBlock = async () => {
      if (page.url().includes(`#!/edition/${ED}`)) await page.reload();
      else await page.goto(`${BASE}/#!/edition/${ED}`);
      await page.waitForSelector('#canvasSurface', { timeout: 30000 });
      await page.waitForTimeout(2500);
      await page.locator(`.newspaper-section[data-section-key="${KEY}"]`).click();
      await page.waitForTimeout(3000);
    };

    // ------------------------------------------------ a colour per reading ---
    const items = [
      { label: 'सातारा', value: 10000, ink: '#17458f' },
      { label: 'वडूज', value: 5000, ink: '#0a7a3f' },
      { label: 'पुसेगाव', value: 2000 },
    ];
    await put({ ...restore, headline: '', subheading: '', body: '', insetPanels: [],
      smartCardKey: 'chart', smartCardData: { chartType: 'bar', unit: '', items } });
    await openBlock();

    const bars = await page.evaluate(() => [...document.querySelectorAll(
      '.smart-chart-bars .smart-chart-track i')].map((i) => i.style.background));
    check('each bar is drawn in its own ink', new Set(bars).size === 3, bars.join(' | '));
    check('  a reading that named no colour keeps the chart\'s own',
      bars[2] && bars[2] !== bars[0] && bars[2] !== bars[1], bars[2] || 'none');

    // ------------------------------------------------------- the card face ---
    await put({ ...restore, headline: '', subheading: '', body: '', insetPanels: [],
      smartCardKey: 'chart', smartCardData: { chartType: 'bar', unit: '', items, family: 'mukta' } });
    await openBlock();
    // EVERY surface showing this block, not just the first one found: the
    // page canvas, the Block Editor's own page and the minimap all draw the
    // same card, and a face that reached one of them and not the others is
    // the two-surface fault this product guards hardest against.
    const drawnFaces = await page.evaluate(() =>
      [...document.querySelectorAll('.smart-card-chart')].map((c) => c.getAttribute('style') || ''));
    check('a card is drawn in the face it was solved in',
      drawnFaces.length > 0 && drawnFaces.every((s) => /Mukta/i.test(s)),
      `${drawnFaces.length} surfaces :: ${drawnFaces[0] || '(none)'}`.slice(0, 90));

    await put({ ...restore, headline: '', subheading: '', body: '', insetPanels: [],
      smartCardKey: 'chart', smartCardData: { chartType: 'bar', unit: '', items, family: 'Comic Sans' } });
    await openBlock();
    const refusedFaces = await page.evaluate(() =>
      [...document.querySelectorAll('.smart-card-chart')].map((c) => c.getAttribute('style') || ''));
    check('  and a face that is not the paper\'s is refused, not drawn',
      refusedFaces.length > 0 && refusedFaces.every((s) => !/comic/i.test(s)),
      `${refusedFaces.length} surfaces`);

    // --------------------------------------- a panel is adjusted like a picture ---
    await put({ ...restore, headline: restore.headline, subheading: restore.subheading, body: restore.body,
      smartCardKey: null, smartCardData: null,
      insetPanels: [{ id: 'net-panel', kind: 'note', title: 'चौकट', lines: ['एक', 'दोन'], x: 20, y: 120, width: 110, height: 80 }] });
    await openBlock();

    const frame = page.locator('.panel-frame[data-panel-frame="net-panel"]');
    check('a panel is drawn with a frame of its own', await frame.count() === 1);
    check('  and it says what kind of panel it is',
      (await page.locator('.panel-frame[data-panel-frame="net-panel"] .panel-frame-label').textContent() || '').trim() === 'Fact box');
    check('  with the same eight handles a picture has',
      await page.locator('.panel-frame[data-panel-frame="net-panel"] .panel-handle').count() === 8);

    await frame.scrollIntoViewIfNeeded();
    await page.waitForTimeout(400);
    const box = await frame.boundingBox();
    // Counted for real. `check(true)` is not a check.
    const saves = [];
    const watchSaves = (req) => {
      if (req.method() === 'PUT' && /\/sections\//.test(req.url())) saves.push(req.url());
    };
    page.on('request', watchSaves);
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2 + 70, box.y + box.height / 2 + 40, { steps: 8 });
    // MID-DRAG: the rectangle moves while the pointer is still down, which is
    // what makes the copy reflow round it before anything is committed.
    const moving = await page.evaluate(() => {
      const f = document.querySelector('.panel-frame[data-panel-frame="net-panel"]');
      return { left: parseFloat(f.style.left), dragging: f.classList.contains('is-dragging') };
    });
    check('  it moves while the pointer is still down', moving.dragging && moving.left > 20, JSON.stringify(moving));
    check('  and nothing is saved while it is still moving', saves.length === 0,
      `${saves.length} writes mid-drag`);
    await page.mouse.up();
    await page.waitForTimeout(3000);
    page.off('request', watchSaves);
    check('  exactly one save when the pointer comes up', saves.length === 1,
      `${saves.length} writes`);

    const moved = (await readPanels())[0];
    check('the drag is saved', moved && (moved.x !== 20 || moved.y !== 120),
      moved ? `x ${moved.x}, y ${moved.y}` : 'no panel');
    check('  and the panel keeps its size', moved && moved.width === 110 && moved.height === 80,
      moved ? `${moved.width}x${moved.height}` : '-');

    const handle = page.locator('.panel-frame[data-panel-frame="net-panel"] .panel-handle-se');
    const hb = await handle.boundingBox();
    if (hb) {
      await page.mouse.move(hb.x + hb.width / 2, hb.y + hb.height / 2);
      await page.mouse.down();
      await page.mouse.move(hb.x + hb.width / 2 + 50, hb.y + hb.height / 2 + 30, { steps: 8 });
      await page.mouse.up();
      await page.waitForTimeout(3000);
      const sized = (await readPanels())[0];
      check('the south-east handle sizes it, and that is saved too',
        sized && sized.width > moved.width && sized.height > moved.height,
        sized ? `${sized.width}x${sized.height} from ${moved.width}x${moved.height}` : 'no panel');
      check('  and the corner it was NOT dragged from stays put',
        sized && sized.x === moved.x && sized.y === moved.y,
        sized ? `x ${sized.x}, y ${sized.y}` : '-');
    } else {
      check('the south-east handle is reachable', false, 'no bounding box');
    }

    check('no page errors anywhere', errors.length === 0, errors[0] || 'none');
  } catch (error) {
    crashed = error;
  } finally {
    // The block goes back whether this run finished or threw - a net that
    // leaves a real block carrying its fixture is how five blocks of edition
    // 40294 came to hold body sizes nobody chose.
    if (restore && pageId) {
      await api.put(`${BASE}/api/pages/${pageId}/sections/${KEY}`, { data: restore }).catch(() => {});
      console.log(`restored ${KEY}`);
    }
    await browser.close();
    console.log(`\n${pass} passed, ${fail} failed`);
    if (crashed) {
      console.log(`CRASH (the checks after this point never ran): ${crashed.message}`);
      process.exit(1);
    }
    process.exit(fail ? 1 : 0);
  }
})();
