// The browser net.
//
// `npm test` does not see the browser, and most of this product is the browser.
// Every UI regression this project has had was found by driving the running app
// and looking at it - never by reading code.
//
// This lives in the repository ON PURPOSE. It used to live in a scratch
// directory, which was wiped, and a hundred checks went with it. A test that
// cannot survive the week is not a test.
//
//   node tests/browser/workspace.browser.js [editionId]
//
// It needs the app running on :3000 and a desk sign-in. It drives a REAL
// edition and resets the block it touches first, so it can be run repeatedly.

const { chromium } = require('playwright-core');

const BASE = process.env.SAHAS_BASE || 'http://localhost:3000';
const ED = Number(process.argv[2] || process.env.SAHAS_EDITION || 2099);
const KEY = process.env.SAHAS_BLOCK || 'third-lead';
const CHROME = process.env.CHROME_PATH || '/usr/bin/google-chrome';

const results = [];
const say = (ok, name, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` :: ${detail}` : ''}`);
  results.push({ ok, name });
};

const HEADLINE = 'पुणे मेट्रोचा तिसरा टप्पा लवकरच सुरू होणार';
const SUBHEADING = 'नवीन मार्गिका लवकरच नागरिकांसाठी खुली होणार';
const BODY = 'पुणे : महामेट्रोने तिसऱ्या टप्प्याचे काम सुरू केले आहे.';

(async () => {
  const browser = await chromium.launch({ executablePath: CHROME, args: ['--no-sandbox'] });
  const page = await (await browser.newContext({ viewport: { width: 1512, height: 950 } })).newPage();

  const errors = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message.slice(0, 160)}`));
  page.on('console', (m) => m.type() === 'error' && errors.push(`console: ${m.text().slice(0, 160)}`));
  page.on('response', (r) => { if (r.status() >= 400) errors.push(`HTTP ${r.status()} ${r.url().slice(0, 110)}`); });

  const block = (key = KEY) => page.locator(`.newspaper-section[data-section-key="${key}"]`);
  const blockText = async (key = KEY) => (await block(key).innerText()).replace(/\s+/g, ' ').trim();

  async function openEdition() {
    await page.goto(BASE);
    await page.waitForTimeout(900);
    // The session survives a reload, so the login form is only there once.
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
    await page.waitForTimeout(2200);
  }

  // A repeatable starting point: copy AND pictures. Runs pile photographs on
  // the same spot, and a stack of frames swallows the clicks meant for the one
  // underneath. Done before the edition is opened - the workspace is rendered
  // in place, so a reload would leave it.
  async function resetBlock() {
    await page.evaluate(async ([ed, key]) => {
      const pages = await fetch(`/api/newspapers/${ed}/pages`).then((r) => r.json());
      await fetch(`/api/pages/${pages[0].id}/sections/${key}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ headline: '', subheading: '', body: '', smartCardKey: null, smartCardData: null, status: 'empty' }),
      });
      const images = await fetch(`/api/pages/${pages[0].id}/sections/${key}/images`).then((r) => r.json());
      for (const image of images) {
        await fetch(`/api/pages/${pages[0].id}/sections/${key}/images/${image.id}`, { method: 'DELETE' });
      }
    }, [ED, KEY]);
  }

  /** Full-page-height scrollers that are actually on screen. */
  const nestedScrollers = () => page.evaluate(() => [...document.querySelectorAll('*')]
    .filter((el) => {
      const style = getComputedStyle(el);
      const rect = el.getBoundingClientRect();
      // A drawer parked at translateX(-100%) is not a scrollbar anybody can see.
      const visible = rect.width > 0 && rect.height > 0 && rect.right > 0 && rect.left < window.innerWidth;
      return /(auto|scroll)/.test(style.overflowY)
        && el.scrollHeight > el.clientHeight + 4
        && el.clientHeight > window.innerHeight * 0.7
        && visible;
    })
    .map((el) => el.id || String(el.className).slice(0, 40)));

  await openEdition();
  await resetBlock();
  await openEdition();

  // ---------------------------------------------------------- the provider ---
  {
    const status = await page.evaluate(() => fetch('/api/ai/status').then((r) => r.json()));
    say(status.provider?.key === 'gemini', 'AI status names Gemini as the writer',
      `${status.provider?.key} (ready ${status.provider?.ready})`);
    say((status.fallbacks || [])[0]?.key === 'sarvam', 'and Sarvam as the understudy',
      (status.fallbacks || []).map((f) => f.key).join(','));
    say(status.tiersMeaningful === true, 'the effort tiers mean something on it');
    say(!JSON.stringify(status).match(/AIza|sk-|api[_-]?key/i), 'and no key reaches the browser');
  }

  // --------------------------------------------------------- terminology ---
  {
    const heading = await page.locator('.ext-editor-header h3').innerText();
    say(/block editor/i.test(heading), 'the panel is the Block Editor', heading);
    const stray = await page.evaluate(() => document.body.innerText.match(/external editor/i)?.[0] || '');
    say(!stray, '"External Editor" appears nowhere on screen', stray || '(absent)');
  }

  // ------------------------------------------------------- selecting a block ---
  await block().click();
  await page.waitForTimeout(1600);
  say(await block().evaluate((e) => e.classList.contains('active')), 'the clicked block is highlighted on the newspaper');
  say(await page.locator('.newspaper-section.active').count() === 1, 'exactly one block is selected');
  say((await page.locator('.ext-editor-section-name').innerText()).toLowerCase() === KEY,
    'the Block Editor names that block');
  say(await page.locator('.ext-editor-selected').count() === 1, 'and says it is the selected one');
  say(/\d+ × \d+ px/.test(await page.locator('#edSectionSize').innerText()), 'with its dimensions',
    await page.locator('#edSectionSize').innerText());
  say(await page.locator('#edStatusBadge').count() === 1, 'its content status',
    await page.locator('#edStatusBadge').innerText());
  say(await page.locator('.ext-editor-kind').count() === 1, 'and what kind of block it is',
    await page.locator('.ext-editor-kind').innerText());

  // ------------------------------------------------------- live preview ---
  await page.fill('#edStoryHeadline', HEADLINE);
  await page.waitForTimeout(400);
  say((await blockText()).includes('पुणे मेट्रोचा'), 'the headline reaches the newspaper as it is typed');

  await page.fill('#edStorySubheading', SUBHEADING);
  await page.waitForTimeout(400);
  say((await blockText()).includes('नवीन मार्गिका'), 'the subheading reaches the newspaper as it is typed');

  await page.locator('.ql-editor').click();
  await page.type('.ql-editor', BODY, { delay: 4 });
  await page.waitForTimeout(500);
  say((await blockText()).includes('महामेट्रोने'), 'the body reaches the newspaper as it is typed');

  {
    const parts = await page.evaluate((key) => {
      const el = document.querySelector(`.newspaper-section[data-section-key="${key}"]`);
      return {
        headline: el.querySelector('.section-headline')?.innerText.trim() || '',
        subheading: el.querySelector('.section-subheading')?.innerText.trim() || '',
        bodyCarriesHeadline: (el.querySelector('.section-body')?.innerText || '').includes('पुणे मेट्रोचा'),
      };
    }, KEY);
    say(parts.headline && parts.subheading && !parts.bodyCarriesHeadline,
      'headline, subheading and body are three separate elements');

    const draft = await page.evaluate(async () => {
      const store = await import('/editor/store.js');
      const d = store.getDraft();
      return {
        hasAll: ['headline', 'subheading', 'body'].every((k) => k in d),
        shadows: Object.keys(d).filter((k) => /^(canvas|editor|external)/i.test(k)),
      };
    });
    say(draft.hasAll && draft.shadows.length === 0,
      'one draft holds all three, and nothing shadows them', draft.shadows.join(',') || '(none)');
  }

  // -------------------------------------------- WYSIWYG geometry match ---
  //
  // The canvas positions the headline/subheading/body by real CSS reflow
  // (no picture on this block, so it takes contentMarkup()'s normal-flow
  // path); the Block Editor's frame positions them from buildFlowMap()'s
  // row-count ESTIMATE (block-frame.js#layoutTextFrames). Those are two
  // different algorithms answering the same question, so exact pixel
  // equality is not the bar - order, non-overlap, and a tolerance shaped by
  // the grid's own row height are. A block whose editor frame put the body
  // above the headline, or 200px off, would be exactly the bug this guards.
  {
    const geom = await page.evaluate((key) => {
      const scaleOf = (el) => {
        const t = el ? getComputedStyle(el).transform : 'none';
        if (!t || t === 'none') return 1;
        const m = t.match(/matrix\(([^,]+),/);
        return m ? parseFloat(m[1]) : 1;
      };
      const normRect = (el, scale) => {
        if (!el) return null;
        const r = el.getBoundingClientRect();
        return { top: r.top / scale, left: r.left / scale, height: r.height / scale, width: r.width / scale };
      };

      const canvasScale = scaleOf(document.getElementById('canvasSurface'));
      const canvasBlock = document.querySelector(`.newspaper-section[data-section-key="${key}"]`);
      // .section-content's own box already excludes the chrome status bar
      // (type icon/label/status badge) that the canvas draws and the editor
      // frame, correctly, does not - so it is the fair "content starts here"
      // origin on the canvas side.
      const cOrigin = normRect(canvasBlock.querySelector('.section-content'), canvasScale);
      const cHeadline = normRect(canvasBlock.querySelector('.section-headline'), canvasScale);
      const cSubheading = normRect(canvasBlock.querySelector('.section-subheading'), canvasScale);
      const cBody = normRect(canvasBlock.querySelector('.section-body'), canvasScale);

      const framePage = document.getElementById('edFramePage');
      const blockWidthPx = parseFloat(canvasBlock.style.width);
      // pageScale()'s own formula (block-frame.js): block px per screen px.
      const frameScale = blockWidthPx / framePage.getBoundingClientRect().width;
      const margin = frameScale ? (parseFloat(document.getElementById('edHeadlineFrame')?.style.left) || 0) * frameScale : 0;
      const fOriginRaw = normRect(framePage, 1 / frameScale);
      // The frame page's own top-left is the RAW block edge (matches the
      // canvas's outer .newspaper-section, not .section-content) - shifted
      // by the block's margin so both origins mean "where the content area
      // starts", the same adjustment .section-content already made for free.
      const fOrigin = fOriginRaw ? { top: fOriginRaw.top + margin, left: fOriginRaw.left + margin } : null;
      const fHeadline = normRect(document.getElementById('edHeadlineFrame'), 1 / frameScale);
      const fSubheading = normRect(document.getElementById('edSubheadingFrame'), 1 / frameScale);
      const fBody = normRect(document.getElementById('edBodyFrame'), 1 / frameScale);

      const rel = (rect, origin) => (rect && origin ? { top: rect.top - origin.top, left: rect.left - origin.left, height: rect.height } : null);

      return {
        canvas: { headline: rel(cHeadline, cOrigin), subheading: rel(cSubheading, cOrigin), body: rel(cBody, cOrigin) },
        editor: { headline: rel(fHeadline, fOrigin), subheading: rel(fSubheading, fOrigin), body: rel(fBody, fOrigin) },
      };
    }, KEY);

    // The grid reserves whole rows; real text can end mid-row. The gap this
    // creates is bounded by roughly one row's height at the block's own
    // body size - generous on purpose, since this is a real, understood,
    // and (per CLAUDE.md) deliberately conservative property of the
    // reservation, not slop in the test.
    const tolerance = 60;
    const within = (a, b) => typeof a === 'number' && typeof b === 'number' && Math.abs(a - b) <= tolerance;

    say(
      within(geom.canvas.headline.top, geom.editor.headline.top) && within(geom.canvas.headline.height, geom.editor.headline.height),
      'the editor headline sits where the canvas headline sits, within the row-reservation tolerance',
      `canvas top ${geom.canvas.headline.top.toFixed(1)} vs editor top ${geom.editor.headline.top.toFixed(1)}`,
    );
    say(
      within(geom.canvas.subheading.top, geom.editor.subheading.top),
      'the editor subheading sits where the canvas subheading sits',
      `canvas top ${geom.canvas.subheading.top.toFixed(1)} vs editor top ${geom.editor.subheading.top.toFixed(1)}`,
    );
    say(
      within(geom.canvas.body.top, geom.editor.body.top),
      'the editor body starts where the canvas body starts',
      `canvas top ${geom.canvas.body.top.toFixed(1)} vs editor top ${geom.editor.body.top.toFixed(1)}`,
    );
    // The one invariant that must hold exactly, in both places, with zero
    // tolerance: the reading order is headline, then subheading, then body -
    // never overlapping, never reordered.
    say(
      geom.canvas.headline.top < geom.canvas.subheading.top && geom.canvas.subheading.top < geom.canvas.body.top,
      'canvas order: headline, then subheading, then body',
    );
    say(
      geom.editor.headline.top < geom.editor.subheading.top && geom.editor.subheading.top < geom.editor.body.top,
      'editor order: headline, then subheading, then body',
    );
  }

  // ------------------------------------------------------- object selection ---
  //
  // One selection model (store.js's selectedPart), read by both the frame's
  // selection box and the Typography panel's highlighted field - clicking an
  // object in the Block Editor is direct manipulation, not "fill in a form
  // and hope it corresponds to something."
  {
    const partOf = () => page.evaluate(async () => (await import('/editor/store.js')).getState().selectedPart);

    await page.locator('#edHeadlineFrame').click();
    await page.waitForTimeout(250);
    say((await partOf()) === 'headline', 'clicking the headline frame selects the headline object');
    say(await page.locator('#edHeadlineFrame').evaluate((el) => el.classList.contains('frame-selected')),
      'the headline frame shows a selection box');
    say((await page.locator('#tySelectionLabel').innerText()).toLowerCase() === 'headline',
      'Typography panel says it is editing the headline');
    say(await page.locator('#tyHeadlineSize').evaluate((el) => el.closest('.form-group').classList.contains('form-group-targeted')),
      'and highlights the headline size field, not the subheading/body ones');

    await page.locator('#edSubheadingFrame').click();
    await page.waitForTimeout(250);
    say((await partOf()) === 'subheading', 'clicking the subheading frame selects the subheading object');
    say(!(await page.locator('#edHeadlineFrame').evaluate((el) => el.classList.contains('frame-selected'))),
      'and the headline is no longer shown selected');

    await page.locator('.ql-editor').click();
    await page.waitForTimeout(250);
    say((await partOf()) === 'body', 'clicking into the body selects the body object', await partOf());
    say(await page.locator('#edBodyFrame').evaluate((el) => el.classList.contains('frame-selected')),
      'the body frame shows a selection box');

    await page.keyboard.press('Escape');
    await page.waitForTimeout(250);
    say((await partOf()) === 'block', 'Escape backs out to the whole block being selected, not deselecting it entirely');
  }

  // ------------------------------------------- direct editing & block selection ---
  //
  // Stage 2: a single click now only SELECTS the headline/deck (no jump of
  // focus into the input elsewhere on the page); a double click is what
  // starts typing. And empty room on the page - inside the margins, outside
  // every frame - selects the block as a whole, the way clicking empty
  // canvas does in any page-layout tool.
  {
    const partOf = () => page.evaluate(async () => (await import('/editor/store.js')).getState().selectedPart);
    const focusedId = () => page.evaluate(() => document.activeElement?.id || '');

    await page.locator('.ext-editor-header').click(); // give focus away first
    await page.locator('#edHeadlineFrame').click();
    await page.waitForTimeout(200);
    say((await partOf()) === 'headline', 'a single click on the headline still selects it');
    say((await focusedId()) !== 'edStoryHeadline', 'but does not steal focus into the real input');

    await page.locator('#edHeadlineFrame').dblclick();
    await page.waitForTimeout(200);
    say((await focusedId()) === 'edStoryHeadline', 'a double click on the headline enters text editing');
    say((await partOf()) === 'headline', 'and the headline is still what is selected');

    say(await page.locator('#edHeadlineFrame').evaluate((el) => !el.querySelector('.pic-handle')),
      'the headline frame has no resize handles - the character grid decides its position, not a drag');
    say(await page.locator('#edBodyFrame').evaluate((el) => !el.querySelector('.pic-handle')),
      'neither does the body frame');

    // A point inside the page's own margin, outside every frame - the block
    // fixture is well over 100px screen-tall at this point, so a few pixels
    // in from the page's own top-left corner is safely in the gutter.
    await page.locator('#edFramePage').click({ position: { x: 2, y: 2 } });
    await page.waitForTimeout(250);
    say((await partOf()) === 'block', 'clicking empty room on the page selects the block as a whole');
    say(await page.locator('#edFramePage').evaluate((el) => el.classList.contains('frame-selected')),
      'and the page itself shows a selection box');
    say((await page.locator('#edSelectionLabel').innerText()).toLowerCase() === 'whole block',
      'the selection label reads "Whole block"');
  }

  // -------------------------------------------------------- image resize handles ---
  //
  // A real picture, placed through the same endpoint "Take from Reporter"
  // and the pictures panel already use (sectionImage.service.js's add()) -
  // not a fixture invented only for this test.
  {
    const partOf = () => page.evaluate(async () => (await import('/editor/store.js')).getState().selectedPart);
    const fetchImages = () => page.evaluate(async ([ed, key]) => {
      const pages = await fetch(`/api/newspapers/${ed}/pages`).then((r) => r.json());
      return { pageId: pages[0].id, images: await fetch(`/api/pages/${pages[0].id}/sections/${key}/images`).then((r) => r.json()) };
    }, [ED, KEY]);

    const added = await page.evaluate(async ([ed, key]) => {
      const pages = await fetch(`/api/newspapers/${ed}/pages`).then((r) => r.json());
      const images = await fetch(`/api/pages/${pages[0].id}/sections/${key}/images`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          url: '/uploads/1785497125079-aada20ab-f300-4300-a704-61d0a090f83c.png',
          filename: 'stage2-handle-test.png',
          x: 10, y: 10, width: 60, height: 60,
        }),
      }).then((r) => r.json());
      return images[images.length - 1];
    }, [ED, KEY]);
    say(Boolean(added?.id), 'a picture was placed on the block for this test');

    // The app only re-fetches a block's pictures on selectSection() - switch
    // away and back so it notices the one just added outside it.
    const otherKey = await page.evaluate(async ([ed, key]) => {
      const pages = await fetch(`/api/newspapers/${ed}/pages`).then((r) => r.json());
      return pages[0].sections.map((s) => s.section_key).find((k) => k !== key) || null;
    }, [ED, KEY]);
    if (otherKey) { await block(otherKey).click(); await page.waitForTimeout(500); }
    await block().click();
    await page.waitForTimeout(1200);

    const picFrame = () => page.locator(`.pic-frame[data-image-id="${added.id}"]`);
    await picFrame().click();
    await page.waitForTimeout(250);
    say((await partOf()) === 'image', 'clicking the picture selects the image object');
    say(await picFrame().evaluate((el) => el.classList.contains('is-selected')), 'the picture frame shows as selected');
    say((await picFrame().locator('.pic-handle').count()) === 4, 'a selected picture shows four resize handles');
    say(await page.locator('#edSelectionLabel').isHidden(),
      'no text label is drawn over a selected picture - the handles already say it is selected');

    // Drag the top-left handle inward. The OPPOSITE corner (bottom-right)
    // must stay exactly where it was - that is what "resize from a corner"
    // means, versus a resize that also silently repositions the picture.
    const before = await picFrame().boundingBox();
    const tlHandle = picFrame().locator('.pic-handle-tl');
    const hBox = await tlHandle.boundingBox();
    await page.mouse.move(hBox.x + hBox.width / 2, hBox.y + hBox.height / 2);
    await page.mouse.down();
    await page.mouse.move(hBox.x + 20, hBox.y + 20, { steps: 6 });
    await page.mouse.up();
    await page.waitForTimeout(700);
    const after = await picFrame().boundingBox();

    say(after.width < before.width && after.height < before.height,
      'dragging the top-left handle shrinks the picture',
      `${before.width.toFixed(0)}x${before.height.toFixed(0)} -> ${after.width.toFixed(0)}x${after.height.toFixed(0)}`);
    const brBefore = { x: before.x + before.width, y: before.y + before.height };
    const brAfter = { x: after.x + after.width, y: after.y + after.height };
    say(Math.abs(brBefore.x - brAfter.x) < 4 && Math.abs(brBefore.y - brAfter.y) < 4,
      'and the opposite (bottom-right) corner stays where it was',
      `${brBefore.x.toFixed(0)},${brBefore.y.toFixed(0)} -> ${brAfter.x.toFixed(0)},${brAfter.y.toFixed(0)}`);

    let { images: afterDrag } = await fetchImages();
    let row = afterDrag.find((r) => r.id === added.id);
    say(row && Number(row.width_px) < 60,
      "the resize is saved to the picture's own row, not just the screen", `width_px now ${row?.width_px}`);
    const resizedWidth = Number(row.width_px);

    // Alignment survives a relayout - the handle is a child of the same
    // frame the picture is, not a second coordinate system kept in sync by
    // hand, so this is really testing "did the frame itself relayout
    // correctly", not the handle specifically.
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.waitForTimeout(500);
    const frameAtResize = await picFrame().boundingBox();
    const tlAtResize = await picFrame().locator('.pic-handle-tl').boundingBox();
    say(
      frameAtResize && tlAtResize
      && Math.abs((tlAtResize.x + tlAtResize.width / 2) - frameAtResize.x) < 8
      && Math.abs((tlAtResize.y + tlAtResize.height / 2) - frameAtResize.y) < 8,
      'after a window resize, the handle is still exactly on the picture\'s own corner',
    );
    await page.setViewportSize({ width: 1512, height: 950 });
    await page.waitForTimeout(500);

    // Undo/redo through the SAME history stack text edits use (Stage 2's own
    // requirement) - not a second, separate undo mechanism for pictures.
    await page.locator('.ext-editor-header').click();
    await page.keyboard.press('Control+z');
    await page.waitForTimeout(700);
    let afterUndo = (await fetchImages()).images.find((r) => r.id === added.id);
    say(Number(afterUndo?.width_px) === 60, 'Ctrl+Z restores the picture to its size before the resize',
      `width_px ${afterUndo?.width_px}`);

    await page.keyboard.press('Control+Shift+z');
    await page.waitForTimeout(700);
    let afterRedo = (await fetchImages()).images.find((r) => r.id === added.id);
    say(Number(afterRedo?.width_px) === resizedWidth, 'Ctrl+Shift+Z redoes the resize',
      `width_px ${afterRedo?.width_px}`);

    // This picture only exists for this test. Removed the same way
    // resetBlock() clears pictures, then the block is switched away and back
    // so the running app's own picture list forgets it too, not just the
    // database - otherwise a stale frame for a deleted row would sit in the
    // DOM for the rest of this run.
    const { pageId } = await fetchImages();
    await page.evaluate(([pid, key, id]) => fetch(`/api/pages/${pid}/sections/${key}/images/${id}`, { method: 'DELETE' }), [pageId, KEY, added.id]);
    if (otherKey) { await block(otherKey).click(); await page.waitForTimeout(500); }
    await block().click();
    await page.waitForTimeout(1200);
  }

  // ------------------------------------------------------- keyboard shortcuts ---
  //
  // Undo/redo already existed (history.js) with toolbar buttons; what is new
  // is the keyboard layer, and specifically that it must not fight normal
  // text editing - Ctrl+Z while a field has focus has to be the browser's
  // own undo of the last few characters, never a jump in the editor's
  // history stack out from under a cursor mid-sentence.
  {
    const original = await page.inputValue('#edStoryHeadline');
    await page.fill('#edStoryHeadline', 'की-बोर्ड चाचणी मथळा');
    await page.waitForTimeout(700); // past history.js's COALESCE_MS, so this is its own undo step
    say((await page.inputValue('#edStoryHeadline')) === 'की-बोर्ड चाचणी मथळा', 'the test headline was actually typed');

    // Move focus OUT of the field first - Ctrl+Z's target is the editor, not the input.
    await page.locator('.ext-editor-header').click();
    await page.keyboard.press('Control+z');
    await page.waitForTimeout(400);
    say((await page.inputValue('#edStoryHeadline')) === original,
      'Ctrl+Z outside a text field undoes the last edit', await page.inputValue('#edStoryHeadline'));

    await page.keyboard.press('Control+Shift+z');
    await page.waitForTimeout(400);
    say((await page.inputValue('#edStoryHeadline')) === 'की-बोर्ड चाचणी मथळा',
      'Ctrl+Shift+Z redoes it', await page.inputValue('#edStoryHeadline'));

    // Ctrl+Z back INTO a focused field must not jump the editor's history -
    // only the field's own native undo should act, leaving the editor's
    // state exactly where it was.
    await page.click('#edStoryHeadline');
    await page.keyboard.type(' अ');
    const beforeFieldUndo = await page.inputValue('#edStoryHeadline');
    await page.keyboard.press('Control+z');
    await page.waitForTimeout(300);
    const afterFieldUndo = await page.inputValue('#edStoryHeadline');
    say(afterFieldUndo !== beforeFieldUndo && afterFieldUndo.startsWith('की-बोर्ड'),
      'Ctrl+Z while typing is the field\'s own undo, not the editor jumping history',
      `${beforeFieldUndo} -> ${afterFieldUndo}`);

    // Restore the headline this block started with - later checks in this
    // script (the reload section) depend on it, and this test's own
    // undo/redo dance is not something they should have to know about.
    await page.fill('#edStoryHeadline', original);
    await page.waitForTimeout(400);
  }

  // ------------------------------------------------------------- scrolling ---
  {
    const scrollers = await nestedScrollers();
    say(scrollers.length === 0, 'one page scroll: no second full-page scrollbar', scrollers.join(' | ') || '(none)');
    say(await page.evaluate(() => document.documentElement.scrollHeight > window.innerHeight),
      'one page scroll: the document is what scrolls');

    await page.evaluate(() => window.scrollTo(0, 0));
    await page.waitForTimeout(300);
    const stack = await page.evaluate(() => {
      // offsetTop up the chain: the toolbar is sticky, so a rect reading says
      // where it is pinned rather than where it sits in the document.
      const top = (sel) => {
        let el = document.querySelector(sel);
        if (!el) return null;
        let y = 0;
        while (el) { y += el.offsetTop; el = el.offsetParent; }
        return y;
      };
      return { toolbar: top('.workspace-toolbar'), canvas: top('.workspace-canvas-host'), editor: top('.workspace-external-editor') };
    });
    say(stack.toolbar <= stack.canvas && stack.canvas < stack.editor,
      'toolbar, then the newspaper, then the Block Editor', JSON.stringify(stack));

    // A sticky grid item is confined to its whole GRID, not its row - which is
    // how the settings rail once parked a font menu over the headline field.
    await page.evaluate(() => window.scrollTo(0, 470));
    await page.waitForTimeout(400);
    const overlap = await page.evaluate(() => {
      const rail = document.querySelector('#workspaceTools')?.getBoundingClientRect();
      const story = document.querySelector('.ext-write-col')?.getBoundingClientRect();
      if (!rail || !story) return null;
      return rail.bottom > story.top + 4 && rail.right > story.left + 4 && rail.top < story.bottom;
    });
    say(overlap === false, 'the settings rail never covers the Block Editor');
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.waitForTimeout(300);
  }

  // ------------------------------------------------- save, then reload ---
  await page.locator('#edSaveNow').click();
  await page.waitForTimeout(2500);
  const beforeReload = await blockText();
  await openEdition();
  await block().click();
  await page.waitForTimeout(1800);
  say(await page.inputValue('#edStoryHeadline') === HEADLINE, 'the headline survives a reload');
  say(await page.inputValue('#edStorySubheading') === SUBHEADING, 'the subheading survives a reload');
  say((await page.locator('.ql-editor').innerText()).includes('महामेट्रोने'), 'the body survives a reload');
  say((await blockText()).includes('पुणे मेट्रोचा'), 'and the newspaper shows the same', beforeReload.slice(0, 40));

  // --------------------------------------------------------- the panels ---
  {
    const groups = (await page.locator('.ext-group-title').allInnerTexts()).map((t) => t.replace(/\s+/g, ' ').trim());
    for (const wanted of ['story', 'ai', 'layout', 'smart cards']) {
      say(groups.some((g) => g.toLowerCase().includes(wanted)), `panel: ${wanted}`, groups.join(' | '));
    }
    say(await page.locator('#workspaceToolsPanel .ext-aside > summary').count() === 3,
      'Typography, Story details and History are beside the page');
    say(await page.locator('#edStoryToolbar #cmpAddImage').count() === 1,
      'the pictures are part of the writing surface');
    say(await page.locator('#aiFillRemaining').count() === 1
      && await page.locator('#aiFillRemaining.is-placeholder').count() === 0,
      'Fill remaining area is real, not a placeholder');
    say(await page.locator('#writeEmptyBtn').count() === 1, 'the toolbar can write a page of empty blocks');

    const bulk = await page.evaluate(async () => {
      const m = await import('/editor/external-editor/bulk-generate.js');
      const { ready } = m.candidatesOn({ sections: [
        { section_key: 'a', headline: 'h', body: '' },
        { section_key: 'b', headline: 'h', body: 'written' },
        { section_key: 'c', headline: '', body: '' },
      ] });
      return { concurrency: m.CONCURRENCY, ready: ready.map((r) => r.sectionKey) };
    });
    say(bulk.concurrency >= 2 && bulk.concurrency <= 3, 'bulk generation runs 2-3 at a time', String(bulk.concurrency));
    say(bulk.ready.length === 1 && bulk.ready[0] === 'a', 'and only writes a block with a headline and no copy');
  }

  // ------------------------------------------------------- a Smart Card ---
  {
    await page.locator('[data-smart-card="sudoku"]').click();
    await page.locator('#smartCardGenerate').click();
    await page.waitForTimeout(4000);
    const rows = await page.locator('#smartCardPreview .smart-card-grid-table tr').count();
    const cells = await page.locator('#smartCardPreview .smart-card-grid-table td').count();
    say(rows === 9 && cells === 81, 'a sudoku is reviewed as a real 9x9 grid', `${rows} rows, ${cells} cells`);
    say(!(await page.locator('#smartCardPreview').innerText()).includes('·'), 'a blank square is blank, not a dot');

    await page.locator('#smartCardAccept').click();
    await page.waitForTimeout(1500);
    say(await block().locator('.smart-card-grid-table td').count() === 81, 'and the same grid is on the newspaper');
    say(await page.locator('#edFrameCard .smart-card-grid-table td').count() === 81, 'and in the editor');
    await page.waitForTimeout(3000);

    await openEdition();
    await block().click();
    await page.waitForTimeout(1800);
    say(await block().locator('.smart-card-grid-table td').count() === 81, 'and it is still a grid after a reload');
    const stored = await page.evaluate((ed) => fetch(`/api/newspapers/${ed}/pages`).then((r) => r.json())
      .then((pages) => {
        const s = pages[0].sections.find((x) => x.section_key === (window.__sahasKey || 'third-lead'));
        return { key: s.smart_card_key, rows: s.smart_card_data?.grid?.length, solution: Array.isArray(s.smart_card_data?.solution) };
      }), ED);
    say(stored.key === 'sudoku' && stored.rows === 9 && stored.solution,
      'stored as data, with the solution text could never carry', JSON.stringify(stored));
  }

  // --------------------------------------------------------- print view ---
  await page.locator('#printViewBtn').click();
  await page.waitForTimeout(600);
  say(await page.evaluate(() => document.body.classList.contains('print-view')), 'print view toggles on');
  await page.locator('#printViewBtn').click();
  await page.waitForTimeout(500);
  say(await page.evaluate(() => !document.body.classList.contains('print-view')), 'and off again');

  // ----------------------------------------------------------- worklist ---
  await page.locator('#worklistBtn').click();
  await page.waitForTimeout(1200);
  say(await page.locator('#worklistPanel').count() === 1, "What's left opens");
  await page.locator('#worklistClose').click();
  await page.waitForTimeout(400);

  // --------------------------------------------------------- responsive ---
  for (const width of [1280, 1024, 900]) {
    await page.setViewportSize({ width, height: 900 });
    await page.waitForTimeout(900);
    const sideways = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    const scrollers = await nestedScrollers();
    say(sideways <= 0 && scrollers.length === 0, `${width}px: no sideways scroll, no nested page scroll`,
      `sideways ${sideways}px, nested ${scrollers.length}`);
  }

  // Narrow reorders rather than stacking as written: page, desk, settings.
  await page.setViewportSize({ width: 1024, height: 900 });
  await page.waitForTimeout(800);
  {
    const tops = await page.evaluate(() => {
      const t = (sel) => {
        const el = document.querySelector(sel);
        return el ? Math.round(el.getBoundingClientRect().top + window.scrollY) : null;
      };
      return { page: t('.workspace-canvas-host'), desk: t('.workspace-external-editor'), tools: t('#workspaceTools') };
    });
    say(tops.page < tops.desk && tops.desk < tops.tools,
      'narrow: page, then the desk, then the settings', JSON.stringify(tops));
  }
  await page.setViewportSize({ width: 1512, height: 950 });

  console.log('\nERRORS:', errors.length ? errors : '(none)');
  const failed = results.filter((r) => !r.ok);
  console.log(`${results.length - failed.length}/${results.length} passed`);
  if (failed.length) console.log('FAILED:', failed.map((f) => f.name).join(' | '));
  await browser.close();
  process.exit(failed.length || errors.length ? 1 : 0);
})().catch((error) => { console.error('CRASH', error.message); process.exit(1); });
