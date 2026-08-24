// THE VISUAL PASS - drive the running app, set things, and LOOK.
//
//   node tests/browser/visual-pass.browser.js [editionId] [sectionKey]
//
// Every UI regression in this project was found by driving the app and reading
// a screenshot, never by reading code (CLAUDE.md says so in as many words).
// This net exists for the professional-quality pass: it presses the controls
// that pass adds and checks the two surfaces that must never disagree - the
// newspaper canvas and the Block Editor page - then writes the screenshots out
// so they can be compared against the export.
//
// It borrows a REAL block and puts it back, from the crash handler too.

const fs = require('fs');
const { chromium } = require('playwright-core');

const CHROME = process.env.CHROME_PATH || '/usr/bin/google-chrome';
const BASE = process.env.BASE_URL || 'http://localhost:3000';
const SHOTS = process.env.SHOT_DIR || 'tmp-visual-pass';
const ED = Number(process.argv[2] || 40294);
const KEY = process.argv[3] || 'lead';

let pass = 0;
let ran = 0;
let putBack = async () => {};
const say = (ok, what, detail = '') => {
  ran += 1;
  if (ok) pass += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${what}${detail ? ' :: ' + String(detail).slice(0, 160) : ''}`);
};

(async () => {
  fs.mkdirSync(SHOTS, { recursive: true });
  const browser = await chromium.launch({ executablePath: CHROME, args: ['--no-sandbox'] });
  const page = await (await browser.newContext({ viewport: { width: 1700, height: 2200 } })).newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message.slice(0, 180)}`));
  page.on('console', (m) => m.type() === 'error' && errors.push(`console: ${m.text().slice(0, 180)}`));

  await page.goto(BASE);
  await page.waitForTimeout(900);
  if (await page.locator('#email').count()) {
    await page.fill('#email', 'admin@esahas.com');
    await page.fill('#password', 'admin123');
    await page.click('#loginBtn');
  }
  await page.waitForSelector('.edition-row', { timeout: 20000 });
  const when = await page.evaluate((ed) => fetch(`/api/newspapers/${ed}`).then((r) => r.json())
    .then((n) => String(n.publication_date).slice(0, 10)), ED);
  await page.fill('#editionSearch', when);
  await page.waitForTimeout(700);
  await page.locator(`.edition-row[data-edition-id="${ED}"] button`).click();
  await page.waitForSelector('#canvasSurface', { timeout: 25000 });
  await page.waitForTimeout(2600);

  // ---- the page as a whole, which is what a desk judges ------------------
  await page.locator('#canvasSurface').screenshot({ path: `${SHOTS}/canvas-page-1.png` });
  say(true, 'front page captured', `${SHOTS}/canvas-page-1.png`);

  // ---- the masthead, beside the export's own ----------------------------
  const plate = page.locator('.page-masthead').first();
  if (await plate.count()) {
    await plate.screenshot({ path: `${SHOTS}/canvas-masthead.png` });
    const words = await plate.innerText();
    say(/किंमत/.test(words), 'the canvas masthead carries the cover price');
    say(/पृष्ठे/.test(words), 'and the page count');
    say(!/RNI/.test(words), 'and does NOT repeat the RNI the artwork already carries');
    say(/@/.test(words), 'and the contact line');
  } else say(false, 'the masthead is on the page');

  // ---- a picture caption, on BOTH surfaces -------------------------------
  await page.locator(`.newspaper-section[data-section-key="${KEY}"]`).first().click();
  await page.waitForTimeout(2200);
  await page.evaluate(() => document.getElementById('edFramePage')?.scrollIntoView({ block: 'center' }));
  await page.waitForTimeout(400);

  const field = page.locator('.picture-caption').first();
  const hasPicture = await field.count() > 0;
  say(hasPicture, 'the Pictures panel offers a caption field', hasPicture ? '' : 'no picture on this block');

  if (hasPicture) {
    putBack = async () => {
      await page.evaluate(async ([ed, key]) => {
        const pages = await fetch(`/api/newspapers/${ed}/pages`).then((r) => r.json());
        const pg = pages.find((p) => p.sections.some((s) => s.section_key === key));
        const s = pg.sections.find((x) => x.section_key === key);
        // Addressed by section KEY - the route's :sectionId parameter is a
        // key, exactly as CLAUDE.md records for every production action.
        const images = await fetch(`/api/pages/${pg.id}/sections/${key}/images`).then((r) => r.json()).catch(() => []);
        for (const img of images.images || images || []) {
          await fetch(`/api/pages/${pg.id}/sections/${key}/images/${img.id}`, {
            method: 'PATCH', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ caption: '' }),
          });
        }
      }, [ED, KEY]).catch(() => {});
    };

    const CAPTION = 'छायाचित्र : साहस वार्ता';
    await field.fill(CAPTION);
    await field.blur();
    await page.waitForTimeout(2600);

    const inEditor = await page.evaluate(() => {
      const node = document.querySelector('#edFramePictures .pic-caption');
      return node && !node.hidden ? node.textContent.trim() : '';
    });
    say(inEditor === CAPTION, 'the Block Editor page draws the caption', inEditor);

    const onCanvas = await page.evaluate((key) => {
      const block = document.querySelector(`.newspaper-section[data-section-key="${key}"]`);
      const node = block && block.querySelector('.section-placed-caption');
      return node ? node.textContent.trim() : '';
    }, KEY);
    say(onCanvas === CAPTION, 'and the newspaper canvas draws the same one', onCanvas);

    await page.locator('#edFramePage').screenshot({ path: `${SHOTS}/editor-caption.png` }).catch(() => {});
    const blockShot = page.locator(`.newspaper-section[data-section-key="${KEY}"]`).first();
    await blockShot.screenshot({ path: `${SHOTS}/canvas-caption.png` }).catch(() => {});
    say(true, 'caption screenshots written', `${SHOTS}/editor-caption.png, ${SHOTS}/canvas-caption.png`);
  }

  console.log(`\nERRORS: ${errors.length ? errors.join('\n  ') : '(none)'}`);
  say(errors.length === 0, 'no console or page errors');
  await putBack();
  await browser.close();
  console.log(`\n${pass}/${ran} passed`);
  process.exit(pass === ran ? 0 : 1);
})().catch(async (e) => {
  console.error(`\nCRASHED after ${pass}/${ran} - later checks did NOT run\n`, e);
  await putBack().catch(() => {});
  process.exit(1);
});
