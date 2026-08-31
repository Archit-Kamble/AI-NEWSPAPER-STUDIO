// A HEADLINE KEYSTROKE MUST NEVER LAND IN THE STORY.
//
// Loading a block's copy into Quill went through `dangerouslyPasteHTML`, whose
// trailing `setSelection` focuses the editor root. So a mount or a body sync
// landing just after a desk clicked the headline field pulled the caret back
// into the body - and the headline they then typed was inserted INTO THE
// STORY, silently. Caught in the act: `XYZ` at offset 162 of a real story.
//
// It is a RACE, so it is tested as one: the field is focused at eight
// different delays after the block is selected, on several blocks. Driving the
// half-fixed build (mount repaired, body sync not) this caught 2 of 24
// attempts landing in the story; with both repaired, none do.
//
// BE HONEST ABOUT WHAT THIS NET PROVES. Against the ORIGINAL code it passes
// too, because the losing sequence needs a mount or a sync to land inside the
// window and nothing reachable from outside the app forces one to. So this is
// a regression net, not a reproduction: it holds the property (a headline
// keystroke reaches the headline) and will catch a re-introduction that is
// less timing-dependent than the original. The evidence for the original bug
// is elsewhere and is not in doubt - `XYZ` written into offset 162 of a real
// story, and an instrumented stack showing
// `dangerouslyPasteHTML -> setSelection -> setNativeRange -> focus(ql-editor)`
// firing on both the mount and the body sync.
//
//   node tests/browser/headline-focus.browser.js [editionId]

const { chromium } = require('playwright-core');

const BASE = process.env.BASE || 'http://localhost:3000';
const ED = Number(process.argv[2] || 40294);
const DELAYS = [0, 30, 60, 100, 150, 250, 400, 600];

let pass = 0; let fail = 0;
const check = (name, ok, detail = '') => {
  if (ok) { pass += 1; console.log(`PASS  ${name}${detail ? ` :: ${detail}` : ''}`); }
  else { fail += 1; console.log(`FAIL  ${name}${detail ? ` :: ${detail}` : ''}`); }
};

(async () => {
  const browser = await chromium.launch({
    executablePath: process.env.CHROME_PATH || '/usr/bin/google-chrome',
  });
  const page = await browser.newPage({ viewport: { width: 1512, height: 950 } });
  const touched = [];
  try {
    await page.goto(BASE, { waitUntil: 'networkidle' });
    if (await page.locator('#email').count()) {
      await page.fill('#email', 'admin@esahas.com');
      await page.fill('#password', 'admin123');
      await page.click('#loginBtn');
    }
    await page.waitForSelector('.edition-row', { timeout: 20000 });
    const when = await page.evaluate((ed) => fetch(`/api/newspapers/${ed}`)
      .then((r) => r.json()).then((n) => String(n.publication_date).slice(0, 10)), ED);
    await page.fill('#editionSearch', when);
    await page.waitForTimeout(800);
    await page.locator(`.edition-row[data-edition-id="${ED}"] .edition-open`).click();
    await page.waitForSelector('#canvasSurface', { timeout: 30000 });
    await page.waitForTimeout(3500);

    const keys = await page.evaluate(() => [...document.querySelectorAll('.newspaper-section')]
      .filter((s) => s.querySelector('.section-headline'))
      .map((s) => s.dataset.sectionKey).slice(0, 3));
    check('the edition offers written blocks to type on', keys.length > 0, `${keys.length} blocks`);

    // THE PAGE MUST NOT CHASE THE PANEL. Selecting a block fills the Block
    // Editor and it grows ~430px; the browser's scroll anchoring then kept ITS
    // anchor steady and dragged the window 668px down, out of the newspaper
    // and into the editor - the desk's "clicking somewhere is redirected to
    // another place". No scroll was ever asked for; `overflow-anchor: none`
    // on that panel leaves the desk where they were.
    await page.evaluate(() => window.scrollTo(0, 250));
    await page.waitForTimeout(400);
    for (const k of keys.slice(0, 2)) {
      const y0 = await page.evaluate(() => Math.round(window.scrollY));
      await page.evaluate((kk) => document.querySelector(`.newspaper-section[data-section-key="${kk}"]`)?.click(), k);
      await page.waitForTimeout(1400);
      const y1 = await page.evaluate(() => Math.round(window.scrollY));
      check(`selecting ${k} does not throw the viewport`, Math.abs(y1 - y0) < 40, `${y1 - y0}px`);
      await page.evaluate(() => window.scrollTo(0, 250));
      await page.waitForTimeout(300);
    }

    // AND THE DESK MUST BE ABLE TO SEE WHAT THEY ARE TYPING INTO - which is
    // the OBJECT, and only failing that the field two screens below it.
    //
    // This check used to require the FIELD specifically: the headline field
    // sits ~1890px down a 1512x950 window, so selecting the flow dragged the
    // viewport down to it. That was right when the field was the only place a
    // headline could be typed, and it is not any more - the composed page
    // draws a caret and the band is edited in place, so a desk who selected
    // the headline BY CLICKING IT is already looking at the thing they are
    // about to type into. Hauling them to a second copy of it is the desk's
    // own report: "after clicking on heading or subheading it makes scroll or
    // redirect ... it usually happens on the FIRST click".
    //
    // So the invariant is what it always was - the desk can reach it - and
    // the frame satisfies it as honestly as the field does. Both halves are
    // held: something is in view, and a band already in view moves nothing.
    const revealKey = keys[0];
    await page.evaluate((k) => document.querySelector(`.newspaper-section[data-section-key="${k}"]`)?.click(), revealKey);
    await page.waitForTimeout(1500);
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.waitForTimeout(400);
    const offBefore = await page.evaluate(() => {
      const b = document.getElementById('edStoryHeadline').getBoundingClientRect();
      return b.top >= window.innerHeight || b.bottom <= 0;
    });
    await page.evaluate(() => document.getElementById('edHeadlineFrame')?.scrollIntoView({ block: 'center' }));
    await page.waitForTimeout(300);
    const band = await page.evaluate(() => {
      const r = document.getElementById('edHeadlineFrame').getBoundingClientRect();
      return { x: r.left + 10, y: r.top + r.height / 2 };
    });
    const beforeBand = await page.evaluate(() => Math.round(window.scrollY));
    await page.mouse.click(band.x, band.y);
    await page.waitForTimeout(1800);
    const reachable = await page.evaluate(() => {
      const seen = (el) => {
        if (!el) return false;
        const b = el.getBoundingClientRect();
        return b.height > 0 && b.top < window.innerHeight && b.bottom > 0;
      };
      return {
        field: seen(document.getElementById('edStoryHeadline')),
        frame: seen(document.getElementById('edHeadlineFrame')),
      };
    });
    check('the desk can see what they are about to type into',
      !offBefore || reachable.field || reachable.frame,
      offBefore ? `field ${reachable.field ? 'in view' : 'off'}, band ${reachable.frame ? 'in view' : 'off'}`
        : 'was already in view');

    // ITEM 6 ITSELF, AND IT IS PINNED ON THE BAND RATHER THAN ON A PIXEL
    // BUDGET. The band was in view when it was pressed, so pressing it must
    // leave the desk looking at it. Measured on this same block, same probe:
    //
    //     before   the click moved the page 540px and took the band with it,
    //              frame top 456 -> -84: clean off the top of the screen
    //     after    8px on the first selection and 0px on every one after,
    //              frame still in view
    //
    // The 8px is a one-off settle - no scrollIntoView, no focus, no change in
    // document height, and it does not repeat or accumulate over ten
    // alternating headline/subheading selections. So the movement bound is
    // loose enough to allow it and nowhere near loose enough to allow the
    // fault, and the band check is what actually holds the rule.
    const afterBand = await page.evaluate(() => Math.round(window.scrollY));
    const bandStillSeen = await page.evaluate(() => {
      const r = document.getElementById('edHeadlineFrame')?.getBoundingClientRect();
      return !!r && r.top < window.innerHeight && r.bottom > 0;
    });
    check('and the band the desk pressed is still in front of them',
      bandStillSeen && Math.abs(afterBand - beforeBand) <= 12,
      `${afterBand - beforeBand}px, band ${bandStillSeen ? 'in view' : 'scrolled away'}`);

    const steadyBefore = await page.evaluate(() => Math.round(window.scrollY));
    await page.mouse.click(band.x, band.y);
    await page.waitForTimeout(1200);
    const steadyAfter = await page.evaluate(() => Math.round(window.scrollY));
    check('and re-selecting it does not move the viewport', Math.abs(steadyAfter - steadyBefore) <= 2,
      `${steadyAfter - steadyBefore}px`);

    // THE INVARIANT, TESTED DIRECTLY RATHER THAN GAMBLED ON.
    //
    // The race above is real but probabilistic - it did not fire on every run,
    // and a net that only sometimes catches a bug is not a net. So the rule
    // itself is exercised: put the caret in the headline field, make the body
    // load run, and require that the caret is still there. That is the whole
    // property, and it fails deterministically against the old paste.
    const first = keys[0];
    await page.evaluate((k) => document.querySelector(`.newspaper-section[data-section-key="${k}"]`)?.click(), first);
    await page.waitForTimeout(1200);
    await page.evaluate(() => document.getElementById('edStoryHeadline')?.focus());
    await page.waitForTimeout(250);
    const heldBefore = await page.evaluate(() => document.activeElement?.id);
    check('the caret starts in the headline field', heldBefore === 'edStoryHeadline', String(heldBefore));

    // Re-selecting the block is what mounts it again and runs the body load.
    await page.evaluate((k) => document.querySelector(`.newspaper-section[data-section-key="${k}"]`)?.click(), first);
    await page.waitForTimeout(1200);
    const heldAfter = await page.evaluate(() => document.activeElement?.id
      || document.activeElement?.className?.toString?.().slice(0, 24));
    check('and a body load does not take it into the story', heldAfter === 'edStoryHeadline', String(heldAfter));

    // Typing now must reach the headline, not the copy.
    await page.keyboard.type('QQ');
    await page.waitForTimeout(600);
    const landed = await page.evaluate(() => ({
      headline: (document.getElementById('edStoryHeadline')?.textContent || '').includes('QQ'),
      body: (document.querySelector('.ql-editor')?.innerText || '').includes('QQ'),
    }));
    check('so the keystrokes land in the headline', landed.headline && !landed.body, JSON.stringify(landed));
    await page.keyboard.press('Backspace');
    await page.keyboard.press('Backspace');
    await page.waitForTimeout(300);

    let intoStory = 0; let intoHeadline = 0;
    for (const key of keys) {
      for (const delay of DELAYS) {
        // A different block first, so each attempt is a fresh selection.
        await page.evaluate((k) => document.querySelector(`.newspaper-section:not([data-section-key="${k}"])`)?.click(), key);
        await page.waitForTimeout(450);
        await page.evaluate((k) => document.querySelector(`.newspaper-section[data-section-key="${k}"]`)?.click(), key);
        await page.waitForTimeout(delay);          // <-- the race window
        await page.evaluate(() => document.getElementById('edStoryHeadline')?.focus());
        await page.keyboard.type('QQ');
        await page.waitForTimeout(650);

        const where = await page.evaluate(() => ({
          headline: (document.getElementById('edStoryHeadline')?.textContent || '').includes('QQ'),
          body: (document.querySelector('.ql-editor')?.innerText || '').includes('QQ'),
        }));
        if (where.body) { intoStory += 1; touched.push(`${key}@${delay}ms`); }
        if (where.headline && !where.body) intoHeadline += 1;
        await page.keyboard.press('Backspace');
        await page.keyboard.press('Backspace');
        await page.waitForTimeout(250);
      }
    }
    const attempts = keys.length * DELAYS.length;
    check('no headline keystroke reached the story', intoStory === 0,
      `${intoStory} of ${attempts}${touched.length ? ` (${touched.join(', ')})` : ''}`);
    check('every headline keystroke reached the headline', intoHeadline === attempts,
      `${intoHeadline} of ${attempts}`);
  } catch (error) {
    console.log(`\nCRASHED after ${pass + fail} checks: ${error.message}`);
    fail += 1;
  } finally {
    console.log(`\n${pass}/${pass + fail} passed`);
    await browser.close();
    process.exit(fail ? 1 : 0);
  }
})();
