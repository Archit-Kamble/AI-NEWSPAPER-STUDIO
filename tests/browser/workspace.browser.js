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

  // The headline and subheading fields are contenteditable, not <input> - a
  // headline carries the desk's own marks (story-editor.js's own note), so it
  // cannot be a string in a value attribute. `fill()` still drives them;
  // `inputValue()` cannot read them.
  const fieldText = async (id) => (await page.locator(`#${id}`).innerText()).replace(/\s+/g, ' ').trim();

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
        // A SHADOW is a second copy of the block's state under a
        // surface-specific name ("canvasHeadline", "editorBody"). Anchored on
        // a capital after the prefix, or the pattern also catches ordinary
        // fields that merely begin with those letters - `editorialPriority`
        // and `editorialPresentation` are real, single-copy draft fields and
        // were reported as shadows for as long as this check has existed.
        shadows: Object.keys(d).filter((k) => /^(canvas|editor|external)[A-Z]/.test(k)),
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
      // TWO renderings to cope with, and the composed one is now the normal
      // one. Once the publication font has loaded, the canvas draws the exact
      // composition - absolutely positioned `.section-composed` spans, one per
      // LINE, with no `.section-content` wrapper at all (section-thumb.js).
      // Reading only the old normal-flow DOM found nothing, so every canvas
      // rectangle came back null and this whole section crashed on the first
      // `.top` - taking the twenty checks after it with it, silently, for as
      // long as the fonts have been loading reliably.
      const composed = canvasBlock.querySelector('.section-composed');
      const first = (selector) => {
        const all = [...canvasBlock.querySelectorAll(selector)];
        if (!all.length) return null;
        return all.reduce((top, el) => (el.getBoundingClientRect().top < top.getBoundingClientRect().top ? el : top));
      };
      const cOrigin = composed
        ? normRect(canvasBlock, canvasScale)
        : normRect(canvasBlock.querySelector('.section-content'), canvasScale);
      const cHeadline = normRect(first('.section-headline'), canvasScale);
      const cSubheading = normRect(first('.section-subheading'), canvasScale);
      const cBody = normRect(first(composed ? '.section-body-line' : '.section-body'), canvasScale);

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
    say((await focusedId()) !== 'edStoryHeadline', 'but does not steal focus into the field below the page');

    await page.locator('#edHeadlineFrame').dblclick();
    await page.waitForTimeout(200);
    // The FRAME itself is now the edit surface (block-frame.js's
    // beginInlineTextEdit()), not the #edStoryHeadline field below - it is
    // filled with the full semantic headline and made contenteditable
    // directly, because the canonical rendering is one <span> PER LINE and
    // could only ever give back a third of a three-line headline's real text
    // if editing happened on a rendered fragment instead of the frame that
    // spans the whole band. The input still receives the committed value on
    // blur (unchanged - see the "did not steal focus" assertions below).
    say((await focusedId()) === 'edHeadlineFrame', 'a double click on the headline enters text editing');
    // Rich, not "plaintext-only": a sub-editor marks a word inside a headline
    // (display-marks.js), and this is the surface where the headline is
    // visible at its real size while they do it.
    say(await page.locator('#edHeadlineFrame').evaluate((el) => el.getAttribute('contenteditable') === 'true'),
      'the headline frame itself becomes the edit surface, and a rich one');
    say((await partOf()) === 'headline', 'and the headline is still what is selected');

    say(await page.locator('#edHeadlineFrame').evaluate((el) => !el.querySelector('.pic-handle')),
      'the headline frame has no resize handles - the character grid decides its position, not a drag');
    say(await page.locator('#edBodyFrame').evaluate((el) => !el.querySelector('.pic-handle')),
      'neither does the body frame');

    // A point that is genuinely empty room, FOUND rather than assumed.
    //
    // This used to click 2 px in from the page's own top-left corner, on the
    // reasoning that the block's inset was a comfortable target. It is not any
    // more and should not be: the inset is the block's real printed one and
    // that is now 0.5 mm (schema.sql's margin_px - the page grid owns the
    // gutter, not the block), so at this fixture's scale the corner is about
    // two screen pixels of margin and the hit test can land either side of it.
    // A test that depends on which side is testing the rounding, not the
    // product. The empty room a desk actually clicks in is the space BETWEEN
    // the bands - tens of pixels of it - so the point is measured from the
    // frames themselves.
    const emptyPoint = await page.evaluate(() => {
      const page_ = document.getElementById('edFramePage');
      const box = page_.getBoundingClientRect();
      const head = document.getElementById('edHeadlineFrame').getBoundingClientRect();
      const deck = document.getElementById('edSubheadingFrame').getBoundingClientRect();
      return { x: box.width / 2, y: (head.bottom + deck.top) / 2 - box.top };
    });
    await page.locator('#edFramePage').click({ position: emptyPoint });
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
    // EIGHT: four corners (independent X/Y, Shift locks the aspect) and four
    // edges (one axis only). This asserted four for as long as the edge
    // handles have existed - image-resize.js's RESIZE_HANDLES is the catalog.
    say((await picFrame().locator('.pic-handle').count()) === 8, 'a selected picture shows its eight resize handles');
    say(await page.locator('#edSelectionLabel').isHidden(),
      'no text label is drawn over a selected picture - the handles already say it is selected');

    // Drag the top-left handle inward. The OPPOSITE corner (bottom-right)
    // must stay exactly where it was - that is what "resize from a corner"
    // means, versus a resize that also silently repositions the picture.
    const before = await picFrame().boundingBox();
    // 'nw', not 'tl' - image-resize.js names the corners by compass point since the
    // four EDGE handles were added, and n/s/e/w only work that way.
    const tlHandle = picFrame().locator('.pic-handle-nw');
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
    const tlAtResize = await picFrame().locator('.pic-handle-nw').boundingBox();
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

  // ------------------------------------------------------------- multi-selection ---
  //
  // Stage 7: Shift+click builds a selection of several pictures in the open
  // block; Align/Remove-all act on all of them at once. Blocks and text have
  // no freely-movable geometry to align (see external-editor/align.js's own
  // note), so pictures are the one place this applies.
  {
    const fetchImages = () => page.evaluate(async ([ed, key]) => {
      const pages = await fetch(`/api/newspapers/${ed}/pages`).then((r) => r.json());
      return { pageId: pages[0].id, images: await fetch(`/api/pages/${pages[0].id}/sections/${key}/images`).then((r) => r.json()) };
    }, [ED, KEY]);

    // Two DIFFERENT uploaded files, not the same one twice: the images
    // endpoint finds-or-creates a media asset by exact URL and a section can
    // hold only one placement per asset (a real DB constraint,
    // section_images' own UNIQUE(page_section_id, media_asset_id) - POSTing
    // the same URL a second time updates the existing row instead of adding
    // a second one, discovered the hard way while writing this test).
    const URL_A = '/uploads/1785497125079-aada20ab-f300-4300-a704-61d0a090f83c.png';
    const URL_B = '/uploads/1785495695928-8f0cdf12-b61d-4140-bc06-68384fbad89a.png';
    const addPicture = (url, rect) => page.evaluate(async ([ed, key, u, r]) => {
      const pages = await fetch(`/api/newspapers/${ed}/pages`).then((r2) => r2.json());
      const images = await fetch(`/api/pages/${pages[0].id}/sections/${key}/images`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: u, filename: 'stage7-multiselect-test.png', ...r }),
      }).then((res) => res.json());
      return images[images.length - 1];
    }, [ED, KEY, url, rect]);

    // A clean slate: a picture left behind by an earlier, interrupted run of
    // this same suite (or the block's own single-picture test above, if IT
    // was interrupted before its own cleanup ran) would otherwise collide
    // with addPicture() above via that same find-or-create-by-URL behaviour.
    let { pageId, images: leftover } = await fetchImages();
    for (const row of leftover) {
      await page.evaluate(([pid, key, id]) => fetch(`/api/pages/${pid}/sections/${key}/images/${id}`, { method: 'DELETE' }), [pageId, KEY, row.id]);
    }

    // The app only re-fetches a block's pictures on selectSection() - the
    // same fact the single-picture test above already found. Switching away
    // and back is how every test in this file makes a raw API change visible
    // to the running app, not just the database.
    const otherKey = await page.evaluate(async ([ed, key]) => {
      const pages = await fetch(`/api/newspapers/${ed}/pages`).then((r) => r.json());
      return pages[0].sections.map((s) => s.section_key).find((k) => k !== key) || null;
    }, [ED, KEY]);
    const reopen = async () => {
      if (otherKey) { await block(otherKey).click(); await page.waitForTimeout(500); }
      await block().click();
      await page.waitForTimeout(1200);
    };

    const picA = await addPicture(URL_A, { x: 10, y: 10, width: 60, height: 40 });
    const picB = await addPicture(URL_B, { x: 100, y: 60, width: 40, height: 60 });
    say(picA.id !== picB.id, 'two different uploads make two different picture rows, not one reused row',
      `${picA.id} vs ${picB.id}`);
    await reopen();

    const frameA = () => page.locator(`.pic-frame[data-image-id="${picA.id}"]`);
    const frameB = () => page.locator(`.pic-frame[data-image-id="${picB.id}"]`);
    const align = (kind) => page.locator(`[data-picture-align="${kind}"]`);

    await frameA().click();
    await page.waitForTimeout(250);
    say(await frameA().evaluate((el) => el.classList.contains('is-selected')), 'a plain click selects one picture');
    say(!(await frameB().evaluate((el) => el.classList.contains('is-selected'))), 'and only that one');

    await frameB().click({ modifiers: ['Shift'] });
    await page.waitForTimeout(250);
    say(await frameA().evaluate((el) => el.classList.contains('is-selected')) && await frameB().evaluate((el) => el.classList.contains('is-selected')),
      'Shift+click adds a second picture without dropping the first');
    say((await align('left').count()) === 1, 'the align toolbar appears once two pictures are selected');
    say((await page.locator('.picture-controls-head strong').textContent()) === '2 pictures selected',
      'and says how many', await page.locator('.picture-controls-head strong').textContent());

    await align('left').click();
    await page.waitForTimeout(500);
    let rows = (await fetchImages()).images;
    let a = rows.find((r) => r.id === picA.id);
    let b = rows.find((r) => r.id === picB.id);
    say(Number(a.x_px) === 10 && Number(b.x_px) === 10, 'Align left moves both pictures to the selection\'s own left edge',
      `a.x_px ${a.x_px}, b.x_px ${b.x_px}`);

    // Aligning BOTH axes to the same corner necessarily makes the two
    // rectangles overlap near it (they now share a top-left point) - real
    // geometry, not a bug. Playwright's mouse click, even forced, still
    // dispatches at a real screen point and the BROWSER's own hit-testing
    // (not Playwright's actionability checks, which force:true skips)
    // routes it to whichever frame is physically on top there - not
    // necessarily the one this test means to click. dispatchEvent bypasses
    // hit-testing entirely by firing the event straight at the target
    // element, which is what the rest of this test uses from here on; the
    // plain clicks above (before any overlap exists) keep using the real
    // mouse, since that is what proves an ordinary click actually works.
    const shiftClick = (locator) => locator.dispatchEvent('pointerdown', { bubbles: true, button: 0, shiftKey: true });
    // A plain (non-shift) pointerdown on a picture frame also arms a
    // possible drag (window pointermove/pointerup listeners) - completing it
    // with a real pointerup, even though nothing moved, is what lets that
    // drag's own cleanup run and remove those listeners, rather than leaving
    // them attached to fire on whatever real mouse movement this suite does
    // next, elsewhere in the page, applying a phantom PATCH to this picture.
    const plainClick = async (locator) => {
      await locator.dispatchEvent('pointerdown', { bubbles: true, button: 0 });
      await page.evaluate(() => window.dispatchEvent(new PointerEvent('pointerup', { bubbles: true })));
    };

    await align('top').click();
    await page.waitForTimeout(500);
    rows = (await fetchImages()).images;
    a = rows.find((r) => r.id === picA.id);
    b = rows.find((r) => r.id === picB.id);
    say(Number(a.y_px) === 10 && Number(b.y_px) === 10, 'Align top moves both pictures to the selection\'s own top edge',
      `a.y_px ${a.y_px}, b.y_px ${b.y_px}`);

    say(await page.evaluate(() => document.querySelector('.pic-frame.is-dragging') === null),
      'an align never leaves a picture mid-drag');

    // Shift+click the same picture again removes it from the selection.
    await shiftClick(frameB());
    await page.waitForTimeout(250);
    say((await align('left').count()) === 0,
      'Shift+click on an already-selected picture drops it - back to the single-picture panel');
    say(await frameA().evaluate((el) => el.classList.contains('is-selected')), 'the picture left in the selection stays selected');

    // Escape collapses the multi-selection before it reaches "block".
    await shiftClick(frameB());
    await page.waitForTimeout(250);
    say((await align('left').count()) === 1, 'both selected again, for the Escape check');
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);
    say((await align('left').count()) === 0,
      'Escape collapses a multi-selection to its primary picture first');
    say(await page.evaluate(() => document.querySelectorAll('.pic-frame.is-selected').length) === 1,
      'exactly one picture is still shown selected, not zero');

    // Bulk nudge: select both again, arrow-move them together, one history
    // step. Escape just above collapsed the pair down to B (the primary -
    // whichever was added to the selection last) - Shift+click A, the one
    // NOT currently selected, to rebuild the pair; Shift+clicking B again
    // would instead drop the only picture still selected.
    await shiftClick(frameA());
    await page.waitForTimeout(250);
    const beforeNudge = (await fetchImages()).images;
    const ax0 = Number(beforeNudge.find((r) => r.id === picA.id).x_px);
    const bx0 = Number(beforeNudge.find((r) => r.id === picB.id).x_px);
    await page.keyboard.press('ArrowRight');
    await page.waitForTimeout(500);
    rows = (await fetchImages()).images;
    a = rows.find((r) => r.id === picA.id);
    b = rows.find((r) => r.id === picB.id);
    say(Number(a.x_px) === ax0 + 1 && Number(b.x_px) === bx0 + 1,
      'an arrow key with two pictures selected moves BOTH by the same step', `a.x_px ${a.x_px}, b.x_px ${b.x_px}`);

    // Bulk delete via "Remove all".
    await plainClick(frameA());
    await page.waitForTimeout(250);
    await shiftClick(frameB());
    await page.waitForTimeout(250);
    await page.locator('[data-picture-do="remove-selected"]').click();
    await page.waitForTimeout(700);
    rows = (await fetchImages()).images;
    say(!rows.some((r) => r.id === picA.id) && !rows.some((r) => r.id === picB.id),
      '"Remove all" deletes every selected picture', `${rows.length} left`);

    // -------- front/back z-order, on a fresh single picture --------
    const picC = await addPicture(URL_A, { x: 5, y: 5, width: 30, height: 30 });
    const picD = await addPicture(URL_B, { x: 40, y: 5, width: 30, height: 30 });
    await reopen();

    await page.locator(`.pic-frame[data-image-id="${picC.id}"]`).click();
    await page.waitForTimeout(250);
    await page.locator('[data-picture-do="front"]').click();
    await page.waitForTimeout(500);
    rows = (await fetchImages()).images;
    let c = rows.find((r) => r.id === picC.id);
    let d = rows.find((r) => r.id === picD.id);
    say(Number(c.z_index) > Number(d.z_index), '"Bring to front" puts this picture above every other on the block',
      `C z_index ${c.z_index}, D z_index ${d.z_index}`);

    await page.locator('[data-picture-do="back"]').click();
    await page.waitForTimeout(500);
    rows = (await fetchImages()).images;
    c = rows.find((r) => r.id === picC.id);
    say(Number(c.z_index) === 0, '"Send to back" returns it to the floor', `z_index ${c.z_index}`);

    // Cleanup - these pictures only exist for this test. Same pageId as
    // above - it does not change while this block stays open.
    for (const id of [picC.id, picD.id]) {
      await page.evaluate(([pid, key, imgId]) => fetch(`/api/pages/${pid}/sections/${key}/images/${imgId}`, { method: 'DELETE' }), [pageId, KEY, id]);
    }
    await reopen();

    // ---- Bug #1/#3 (PROJECT_STATUS.md): the copy really does run around ----
    //
    // A picture placed low enough that it reaches into the BODY's own rows
    // (not just the headline/deck bands, which dodge it live) is the case
    // Quill cannot show. It does not have to: the block a desk LOOKS at is
    // the exact composition, drawn by the same renderer the newspaper page
    // uses (block-frame.js's own header), and Quill sits below it as a
    // writing surface only.
    //
    // This used to drive a "see the accurate preview" toggle, which no longer
    // exists anywhere in the application - the canonical layer replaced it and
    // made it redundant. Twenty-five lines of this file went on driving a
    // button that had been deleted, which is why everything after it never
    // ran. What is checked now is the property that button existed to prove.
    //
    // A genuine clean slate, not an assumption that the z-order test's own
    // cleanup above left nothing - the same reasoning as the multi-selection
    // block's own opening cleanup.
    for (const row of (await fetchImages()).images) {
      await page.evaluate(([pid, key, imgId]) => fetch(`/api/pages/${pid}/sections/${key}/images/${imgId}`, { method: 'DELETE' }), [pageId, KEY, row.id]);
    }
    await reopen();
    const bare = await page.evaluate(() => [...document.querySelectorAll('#edCanonicalContent .section-body-line')]
      .map((el) => Math.round(parseFloat(el.style.left))));

    // A tall picture on the left, guaranteed to still be standing once the
    // block's own headline/subheading rows have passed.
    const picF = await addPicture(URL_A, { x: 5, y: 5, width: 50, height: 200 });
    await reopen();
    const around = await page.evaluate(() => [...document.querySelectorAll('#edCanonicalContent .section-body-line')]
      .map((el) => Math.round(parseFloat(el.style.left))));

    say(bare.length > 0 && around.length > 0, 'the block sets copy both with and without the picture',
      `${bare.length} lines -> ${around.length}`);
    say(around.some((left, i) => left !== bare[i]),
      'and the copy really moves out of the picture\'s way in the Block Editor itself',
      `left edges ${bare.slice(0, 4).join(',')} -> ${around.slice(0, 4).join(',')}`);
    say(await page.locator('.ql-editor').isVisible(), 'while Quill stays the writing surface below it');

    // Typing must still work normally after all this toggling - the preview
    // is display-only, never a second copy of the story. Restored with
    // Quill's own undo (not a plain-text round-trip), so any bold/italic
    // marks already in this fixture's copy survive the test intact.
    await page.click('.ql-editor');
    await page.keyboard.press('End');
    await page.keyboard.type(' चाचणी-शब्द');
    await page.waitForTimeout(700);
    say((await page.locator('.ql-editor').innerText()).includes('चाचणी-शब्द'), 'typing in the body still works with the toggle on the page');
    await page.keyboard.press('Control+z');
    await page.waitForTimeout(400);
    say(!(await page.locator('.ql-editor').innerText()).includes('चाचणी-शब्द'), 'and undoes cleanly, same as before the toggle existed');

    for (const id of [picF.id]) {
      await page.evaluate(([pid, key, imgId]) => fetch(`/api/pages/${pid}/sections/${key}/images/${imgId}`, { method: 'DELETE' }), [pageId, KEY, id]);
    }
    await reopen();
  }

  // ------------------------------------------------------- properties inspector ---
  //
  // Stage 3: the settings rail's new Properties panel. What it shows has to
  // be REAL - a column that is both persisted and actually rendered
  // somewhere (properties-panel.js's own note explains why crop_x_px etc.
  // and an "opacity" field are deliberately absent). Image geometry is the
  // priority: real X/Y/Width/Height, editable, going through the same
  // history stack Stage 2 already wired pictures into.
  {
    const partOf = () => page.evaluate(async () => (await import('/editor/store.js')).getState().selectedPart);
    const fetchImages = () => page.evaluate(async ([ed, key]) => {
      const pages = await fetch(`/api/newspapers/${ed}/pages`).then((r) => r.json());
      return { pageId: pages[0].id, images: await fetch(`/api/pages/${pages[0].id}/sections/${key}/images`).then((r) => r.json()) };
    }, [ED, KEY]);

    // ---- block and text: no fake geometry ----
    await page.locator('#edFramePage').click({ position: { x: 2, y: 2 } });
    await page.waitForTimeout(250);
    say((await partOf()) === 'block', 'block is selected for this check');
    say((await page.locator('#propSelectionLabel').innerText()).toLowerCase() === 'whole block',
      'Properties panel says "Whole block"');
    say((await page.locator('#edPropertiesGroup').innerText()).toLowerCase().includes('article'),
      'and shows the real block type');
    say((await page.locator('#edPropertiesGroup').innerText()).includes(`${150} × ${264}`)
      || /\d+\s*×\s*\d+\s*px/.test(await page.locator('#edPropertiesGroup').innerText()),
      'and the real block size', await page.locator('#edPropertiesGroup').innerText());
    say((await page.locator('#edPropertiesGroup input[type="number"]').count()) === 0,
      'no numeric geometry fields for the block - it has none to edit here');

    await page.locator('#edHeadlineFrame').click();
    await page.waitForTimeout(250);
    say((await partOf()) === 'headline', 'headline is selected for this check');
    say((await page.locator('#propSelectionLabel').innerText()).toLowerCase() === 'headline',
      'Properties panel follows the selection to "Headline"');
    say((await page.locator('#edPropertiesGroup input[type="number"]').count()) === 0,
      'text objects show no fake X/Y/W/H - text-flow position is not a coordinate');
    say(/text-flow|grid/i.test(await page.locator('#edPropertiesGroup').innerText()),
      'and says so honestly, pointing at what actually decides its position');

    // Typography's own per-object scoping (Stage 1) must still work - the
    // properties panel is additive, not a replacement that could regress it.
    say((await page.locator('#tySelectionLabel').innerText()).toLowerCase() === 'headline',
      'Typography panel is still correctly scoped to Headline alongside Properties');

    await page.locator('.ql-editor').click();
    await page.waitForTimeout(250);
    say((await partOf()) === 'body', 'body is selected for this check');
    say((await page.locator('#edPropertiesGroup input[type="number"]').count()) === 0,
      'the body shows no fake X/Y/W/H either');

    // ---- image: the real thing ----
    const added = await page.evaluate(async ([ed, key]) => {
      const pages = await fetch(`/api/newspapers/${ed}/pages`).then((r) => r.json());
      const images = await fetch(`/api/pages/${pages[0].id}/sections/${key}/images`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          url: '/uploads/1785497125079-aada20ab-f300-4300-a704-61d0a090f83c.png',
          filename: 'stage3-properties-test.png',
          x: 10, y: 10, width: 60, height: 60,
        }),
      }).then((r) => r.json());
      return images[images.length - 1];
    }, [ED, KEY]);
    say(Boolean(added?.id), 'a picture was placed for the properties test');

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
    say((await partOf()) === 'image', 'the picture is selected for the properties test');
    say((await page.locator('#propSelectionLabel').innerText()).toLowerCase() === 'picture',
      'Properties panel follows the selection to "Picture"');

    say((await page.inputValue('#propImgX')) === '10', 'the inspector shows the real X');
    say((await page.inputValue('#propImgY')) === '10', 'the inspector shows the real Y');
    say((await page.inputValue('#propImgWidth')) === '60', 'the inspector shows the real Width');
    say((await page.inputValue('#propImgHeight')) === '60', 'the inspector shows the real Height');

    // No request-per-keystroke: typing three digits into a field before
    // committing must not send three PATCHes.
    const requests = [];
    const onRequest = (req) => { if (req.method() === 'PATCH' && /\/images\/\d+$/.test(req.url())) requests.push(req.url()); };
    page.on('request', onRequest);
    // The block is 150px wide and the picture is 60px wide here, so the
    // valid X range is 0-90 (clampToBlock's own existing rule, reused rather
    // than duplicated) - 45 is comfortably inside it.
    await page.click('#propImgX');
    await page.keyboard.press('Control+a');
    await page.keyboard.type('45', { delay: 30 }); // two real keystrokes, not a paste
    await page.waitForTimeout(200);
    say(requests.length === 0, 'typing into a numeric field before committing sends no request yet',
      `${requests.length} request(s) so far`);
    await page.keyboard.press('Tab');
    await page.waitForTimeout(700);
    say(requests.length === 1, 'committing (blur/Enter) sends exactly one request, not one per digit',
      `${requests.length} request(s)`);
    page.off('request', onRequest);

    let row = (await fetchImages()).images.find((r) => r.id === added.id);
    say(Number(row?.x_px) === 45, 'the X change is saved to the picture\'s own row', `x_px ${row?.x_px}`);
    const canvasAfterX = await picFrame().boundingBox();

    // Y
    await page.fill('#propImgY', '35');
    await page.keyboard.press('Tab');
    await page.waitForTimeout(700);
    row = (await fetchImages()).images.find((r) => r.id === added.id);
    say(Number(row?.y_px) === 35, 'changing Y moves the picture and saves it', `y_px ${row?.y_px}`);

    // Width
    await page.fill('#propImgWidth', '90');
    await page.keyboard.press('Tab');
    await page.waitForTimeout(700);
    row = (await fetchImages()).images.find((r) => r.id === added.id);
    say(Number(row?.width_px) === 90, 'changing Width resizes the picture and saves it', `width_px ${row?.width_px}`);
    const canvasAfterWidth = await picFrame().boundingBox();
    say(canvasAfterWidth.width > canvasAfterX.width, 'the canvas picture is visibly wider after the Width change');

    // Height
    await page.fill('#propImgHeight', '70');
    await page.keyboard.press('Tab');
    await page.waitForTimeout(700);
    row = (await fetchImages()).images.find((r) => r.id === added.id);
    say(Number(row?.height_px) === 70, 'changing Height resizes the picture and saves it', `height_px ${row?.height_px}`);

    // A direct drag (Stage 2's own mechanism) must still update Properties -
    // the inspector cannot go stale relative to the canvas.
    // 'nw', not 'tl' - image-resize.js names the corners by compass point since the
    // four EDGE handles were added, and n/s/e/w only work that way.
    const tlHandle = picFrame().locator('.pic-handle-nw');
    const hBox = await tlHandle.boundingBox();
    await page.mouse.move(hBox.x + hBox.width / 2, hBox.y + hBox.height / 2);
    await page.mouse.down();
    await page.mouse.move(hBox.x + 15, hBox.y + 15, { steps: 5 });
    await page.mouse.up();
    await page.waitForTimeout(700);
    row = (await fetchImages()).images.find((r) => r.id === added.id);
    say(await page.inputValue('#propImgWidth') === String(row.width_px),
      'a direct drag on the canvas updates the Properties panel\'s Width field',
      `field ${await page.inputValue('#propImgWidth')} vs row ${row.width_px}`);
    say(await page.inputValue('#propImgHeight') === String(row.height_px),
      'and its Height field', `field ${await page.inputValue('#propImgHeight')} vs row ${row.height_px}`);

    // Reject invalid geometry rather than sending it.
    await page.fill('#propImgWidth', '0');
    await page.keyboard.press('Tab');
    await page.waitForTimeout(400);
    say(Number(await page.inputValue('#propImgWidth')) > 0,
      'Width <= 0 is rejected - the field reverts instead of saving a hole with no picture in it');

    // Undo/redo through the SAME history stack Stage 2 wired pictures into -
    // not a second one for "properties changes" specifically. The rejected
    // Width=0 attempt above sent no request and recorded no history step, so
    // this Ctrl+Z steps back through the last REAL change (the direct drag) -
    // proving a properties-panel edit and a drag share one undo stack.
    const widthBeforeUndo = Number((await fetchImages()).images.find((r) => r.id === added.id).width_px);
    await page.locator('.ext-editor-header').click();
    await page.keyboard.press('Control+z');
    await page.waitForTimeout(700);
    row = (await fetchImages()).images.find((r) => r.id === added.id);
    say(Number(row?.width_px) !== widthBeforeUndo, 'Ctrl+Z steps the picture back through the shared history stack');
    await page.keyboard.press('Control+Shift+z');
    await page.waitForTimeout(700);
    row = (await fetchImages()).images.find((r) => r.id === added.id);
    say(Number(row?.width_px) === widthBeforeUndo, 'Ctrl+Shift+Z redoes it', `width_px ${row?.width_px}`);

    // Zoom (a window resize, which relayouts the Block Editor) must not
    // change what a property IS - only how big it looks on screen.
    const widthField = Number(await page.inputValue('#propImgWidth'));
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.waitForTimeout(500);
    say(Number(await page.inputValue('#propImgWidth')) === widthField,
      'the Width property is unchanged by a viewport/zoom change - it is editor pixels, not screen pixels');
    await page.setViewportSize({ width: 1512, height: 950 });
    await page.waitForTimeout(500);

    // Reload persistence.
    await openEdition();
    await block().click();
    await page.waitForTimeout(1500);
    await picFrame().click();
    await page.waitForTimeout(300);
    const persisted = (await fetchImages()).images.find((r) => r.id === added.id);
    say(await page.inputValue('#propImgX') === String(persisted.x_px), 'X survives a reload');
    say(await page.inputValue('#propImgY') === String(persisted.y_px), 'Y survives a reload');
    say(await page.inputValue('#propImgWidth') === String(persisted.width_px), 'Width survives a reload');
    say(await page.inputValue('#propImgHeight') === String(persisted.height_px), 'Height survives a reload');

    const scrollers = await nestedScrollers();
    say(scrollers.length === 0, 'the Properties panel introduces no second full-page scrollbar');

    // Cleanup.
    const { pageId } = await fetchImages();
    await page.evaluate(([pid, key, id]) => fetch(`/api/pages/${pid}/sections/${key}/images/${id}`, { method: 'DELETE' }), [pageId, KEY, added.id]);
    if (otherKey) { await block(otherKey).click(); await page.waitForTimeout(500); }
    await block().click();
    await page.waitForTimeout(1200);
  }

  // ------------------------------------------------------------ rulers + guides ---
  //
  // Stage 4: rulers show PAGE coordinates (never screen or zoom-scaled ones),
  // and dragging off either one creates a persisted, page-level guide - a
  // reference line, not yet a snap target (Stage 5). Page-scoped, so this
  // block does not touch KEY's own selection state except at the very end,
  // where it checks a guide never steals an ordinary click.
  {
    const pageIdOf = () => page.evaluate(async (ed) => (await fetch(`/api/newspapers/${ed}/pages`).then((r) => r.json()))[0].id, ED);
    const fetchGuides = (pid) => page.evaluate((p) => fetch(`/api/pages/${p}/guides`).then((r) => r.json()), pid);
    const pid = await pageIdOf();

    // A clean slate - any guide left by a previous run would confuse the
    // "multiple guides coexist" / "crossing guides" counts below.
    for (const g of await fetchGuides(pid)) {
      await page.evaluate(([p, id]) => fetch(`/api/pages/${p}/guides/${id}`, { method: 'DELETE' }), [pid, g.id]);
    }

    say((await page.locator('#canvasRulerH').count()) === 1, 'a horizontal ruler exists');
    say((await page.locator('#canvasRulerV').count()) === 1, 'a vertical ruler exists');

    const majorCount = await page.locator('#rulerTicksH .ruler-tick-major').count();
    const allCount = await page.locator('#rulerTicksH .ruler-tick').count();
    say(majorCount >= 2, 'the horizontal ruler has labelled major ticks', String(majorCount));
    say(allCount > majorCount, 'and minor ticks between them', `${allCount} total, ${majorCount} major`);

    const alignment = await page.evaluate(() => {
      const pageRect = document.getElementById('canvasSurface').getBoundingClientRect();
      const major = document.querySelector('#rulerTicksH .ruler-tick-major');
      const tickRect = major?.getBoundingClientRect();
      return {
        aligned: tickRect ? Math.abs(tickRect.left - pageRect.left) <= 1 : false,
        label: major?.querySelector('.ruler-tick-label')?.textContent,
      };
    });
    say(alignment.aligned, 'the ruler\'s own zero tick sits exactly on the page\'s left edge, not an assumed offset');
    say(alignment.label === '0', 'and its label reads the real editor coordinate', alignment.label);

    // ---- creating guides by dragging off each ruler ----
    // The canvas is well down the one-page scroll by this point (earlier
    // Block Editor interactions scroll the document, same as clicking a
    // block on the canvas already needs it in view) - the sticky toolbar
    // would otherwise sit over the ruler exactly as it would over any other
    // canvas control a desk hasn't scrolled back to first.
    await page.evaluate(() => document.getElementById('canvasRulerH')?.scrollIntoView({ block: 'center' }));
    await page.waitForTimeout(300);

    const rulerHBox = await page.locator('#canvasRulerH').boundingBox();
    const rulerVBox = await page.locator('#canvasRulerV').boundingBox();
    const pageBox = await page.locator('#canvasSurface').boundingBox();
    // The page's real, unscaled size - so a drop's expected PAGE-pixel
    // position can be computed from its screen delta, whatever the current
    // fit/zoom scale happens to be (it varies with how much room the
    // settings rail and Block Editor are taking, which earlier tests in
    // this run have already changed).
    const newspaperPx = await page.evaluate((ed) => fetch(`/api/newspapers/${ed}`).then((r) => r.json()), ED);
    const scale = pageBox.height / Number(newspaperPx.page_height_px);

    const createRequests = [];
    const onCreateRequest = (req) => { if (req.method() === 'POST' && /\/guides$/.test(req.url())) createRequests.push(req.url()); };
    page.on('request', onCreateRequest);

    await page.mouse.move(rulerHBox.x + 100, rulerHBox.y + rulerHBox.height / 2);
    await page.mouse.down();
    await page.mouse.move(pageBox.x + 100, pageBox.y + 40, { steps: 5 });
    await page.mouse.move(pageBox.x + 100, pageBox.y + 80, { steps: 5 }); // several moves - must not fire a request each
    await page.mouse.move(pageBox.x + 100, pageBox.y + 120, { steps: 5 });
    say(createRequests.length === 0, 'dragging to create a guide sends no request until it is dropped');
    await page.mouse.up();
    await page.waitForTimeout(500);
    say(createRequests.length === 1, 'releasing on the page sends exactly one create request', `${createRequests.length}`);
    page.off('request', onCreateRequest);

    await page.mouse.move(rulerVBox.x + rulerVBox.width / 2, rulerVBox.y + 100);
    await page.mouse.down();
    await page.mouse.move(pageBox.x + 60, pageBox.y + 100, { steps: 8 });
    await page.mouse.up();
    await page.waitForTimeout(500);

    let guides = await fetchGuides(pid);
    say(guides.length === 2, 'both guides exist - multiple guides coexist', String(guides.length));
    const hGuide = guides.find((g) => g.orientation === 'horizontal');
    const vGuide = guides.find((g) => g.orientation === 'vertical');
    say(Boolean(hGuide), 'dragging from the horizontal ruler created a HORIZONTAL guide');
    say(Boolean(vGuide), 'dragging from the vertical ruler created a VERTICAL guide');
    const expectedH = 120 / scale; // dropped at pageBox.y + 120 SCREEN px
    say(Math.abs(hGuide.position_px - expectedH) <= 3, 'its position is in page pixels, not screen pixels',
      `position_px ${hGuide.position_px}, expected ~${expectedH.toFixed(1)} at scale ${scale.toFixed(3)}`);
    say((await page.locator('.page-guide').count()) === 2, 'both are drawn on the page');
    say((await page.locator(`.page-guide[data-guide-id="${hGuide.id}"].page-guide-h`).count()) === 1,
      'the horizontal guide carries the horizontal class');
    say((await page.locator(`.page-guide[data-guide-id="${vGuide.id}"].page-guide-v`).count()) === 1,
      'the vertical guide carries the vertical class');

    // ---- moving a guide: visual during drag, one persist on release ----
    const moveRequests = [];
    const onMoveRequest = (req) => { if (req.method() === 'PATCH' && /\/guides\/\d+$/.test(req.url())) moveRequests.push(req.url()); };
    page.on('request', onMoveRequest);

    const hHit = page.locator(`.page-guide[data-guide-id="${hGuide.id}"] .page-guide-hit`);
    const hBox = await hHit.boundingBox();
    await page.mouse.move(hBox.x + hBox.width / 2, hBox.y + hBox.height / 2);
    await page.mouse.down();
    await page.mouse.move(pageBox.x + 100, pageBox.y + 200, { steps: 4 });
    await page.mouse.move(pageBox.x + 100, pageBox.y + 250, { steps: 4 });
    say(moveRequests.length === 0, 'dragging an existing guide sends no request until release');
    await page.mouse.up();
    await page.waitForTimeout(500);
    say(moveRequests.length === 1, 'releasing sends exactly one move request, not one per mousemove', `${moveRequests.length}`);
    page.off('request', onMoveRequest);

    guides = await fetchGuides(pid);
    const movedH = guides.find((g) => g.id === hGuide.id);
    const expectedMoved = 250 / scale; // dropped at pageBox.y + 250 SCREEN px
    say(movedH.position_px !== hGuide.position_px && Math.abs(movedH.position_px - expectedMoved) <= 3,
      'the moved guide\'s new position is saved', `now ${movedH.position_px}, expected ~${expectedMoved.toFixed(1)}`);

    // ---- deleting: drag off the page (onto the ruler), the primary gesture ----
    const vHit = page.locator(`.page-guide[data-guide-id="${vGuide.id}"] .page-guide-hit`);
    const vBox = await vHit.boundingBox();
    await page.mouse.move(vBox.x + vBox.width / 2, vBox.y + vBox.height / 2);
    await page.mouse.down();
    await page.mouse.move(rulerVBox.x + 5, rulerVBox.y + 100, { steps: 8 });
    await page.mouse.up();
    await page.waitForTimeout(500);
    guides = await fetchGuides(pid);
    say(guides.length === 1 && !guides.some((g) => g.id === vGuide.id),
      'dragging a guide off the page deletes it', `${guides.length} left`);
    say(guides.some((g) => g.id === hGuide.id),
      'and the OTHER guide is untouched - crossing/coexisting guides stay independent');

    // ---- visibility: hides, never deletes ----
    await page.click('#guidesToggleBtn');
    await page.waitForTimeout(250);
    say(await page.locator('#pageGuides').evaluate((el) => el.classList.contains('guides-hidden')),
      'turning Guides off hides the layer');
    say((await fetchGuides(pid)).length === 1, 'but the guide still exists in the database while hidden');
    await page.click('#guidesToggleBtn');
    await page.waitForTimeout(250);
    say(!(await page.locator('#pageGuides').evaluate((el) => el.classList.contains('guides-hidden'))),
      'turning Guides back on restores the layer');
    say((await page.locator('.page-guide').count()) === 1, 'and the same guide is drawn again, not recreated');

    // ---- zoom: the stored value never changes, only where it draws ----
    const beforeZoom = (await fetchGuides(pid))[0].position_px;
    await page.selectOption('#zoomSelect', '2');
    await page.waitForTimeout(500);
    say((await fetchGuides(pid))[0].position_px === beforeZoom, 'zooming to 200% does not change the stored position');
    const guideRectAt200 = await page.locator(`.page-guide[data-guide-id="${movedH.id}"]`).boundingBox();
    const surfaceAt200 = await page.locator('#canvasSurface').boundingBox();
    say(Math.abs((guideRectAt200.y - surfaceAt200.y) - beforeZoom * 2) <= 3,
      'but its ON-SCREEN position scales with zoom, as it should',
      `screen offset ${(guideRectAt200.y - surfaceAt200.y).toFixed(1)} vs expected ~${beforeZoom * 2}`);

    // ---- window resize: still aligned, coordinate unchanged ----
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.waitForTimeout(500);
    say((await fetchGuides(pid))[0].position_px === beforeZoom, 'a window resize does not change the stored position');
    const alignedAfterResize = await page.evaluate(() => {
      const pageRect = document.getElementById('canvasSurface').getBoundingClientRect();
      const tickRect = document.querySelector('#rulerTicksH .ruler-tick-major')?.getBoundingClientRect();
      return tickRect ? Math.abs(tickRect.left - pageRect.left) <= 1 : false;
    });
    say(alignedAfterResize, 'and the ruler is still exactly aligned with the page after the resize');
    await page.setViewportSize({ width: 1512, height: 950 });
    await page.selectOption('#zoomSelect', 'fit');
    await page.waitForTimeout(500);

    // ---- reload persistence ----
    await openEdition();
    await page.waitForTimeout(1200);
    const afterReload = await fetchGuides(pid);
    say(afterReload.length === 1 && afterReload[0].position_px === beforeZoom,
      'the guide survives a reload, at the exact position it was left');
    say((await page.locator('.page-guide').count()) === 1, 'and is drawn on the page again');

    // ---- a guide never steals an ordinary click meant for a block ----
    await block().click();
    await page.waitForTimeout(800);
    say(await block().evaluate((el) => el.classList.contains('active')),
      'clicking a block still selects it normally with a guide present on the page');

    const scrollers = await nestedScrollers();
    say(scrollers.length === 0, 'rulers and guides introduce no second full-page scrollbar');
    say((await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 2)),
      'and no horizontal page overflow');

    // Cleanup.
    for (const g of await fetchGuides(pid)) {
      await page.evaluate(([p, id]) => fetch(`/api/pages/${p}/guides/${id}`, { method: 'DELETE' }), [pid, g.id]);
    }
  }

  // ------------------------------------------------------------ guide snapping ---
  //
  // Stage 5: a block being dragged or resized magnetically snaps to a user
  // guide, live, while the pointer is moving. Blocks are the only object
  // that shares the guide's page-coordinate space - pictures are positioned
  // only inside the Block Editor's own separate block-pixel frame, which has
  // no rulers or guides at all - so this is the one place Stage 5's
  // snapping genuinely applies.
  //
  // A real finding from inspecting the persistence path, not assumed: every
  // block geometry write (pageSection.service.js's moveSection(), called by
  // both a plain drag and a resize) runs the body through snapGeometry()
  // UNCONDITIONALLY - "Snapping on the server as well as in the browser
  // means a page is always printable whatever sent the request" is that
  // function's own comment. The server re-snaps x onto a column start and y
  // onto the 8px baseline no matter what the client sends, which is exactly
  // the same reason the PRE-EXISTING align-guides.js neighbour-alignment
  // nudge has also always been a live, in-drag visual only: a fractional
  // offset never survives the save either way, by deliberate print-safety
  // design, not by omission. So the tests below check what the drag ACTUALLY
  // does - the block visually tracks the guide while the pointer moves, and
  // the guide is highlighted as the current target - and separately confirm
  // the final persisted position always lands on a legal grid/baseline
  // value, exactly as it did before this stage.
  {
    const pageIdOf = () => page.evaluate(async (ed) => (await fetch(`/api/newspapers/${ed}/pages`).then((r) => r.json()))[0].id, ED);
    const fetchGuides = (pid) => page.evaluate((p) => fetch(`/api/pages/${p}/guides`).then((r) => r.json()), pid);
    // Guide mutations below go straight to the REST API (not the ruler-drag
    // UI, already covered in the previous block) so each subtest can place a
    // guide at an exact page pixel - but the running app only learns about a
    // guide through its own createGuide/moveGuide/deleteGuide, which call
    // canvas.js's refreshGuides(). A raw API call bypasses that, so the
    // in-browser module state (what section-drag.js actually reads at drag
    // time) would otherwise go stale; syncGuides() below calls the exact
    // same page-guides.js function the app itself calls on every real
        // mutation, so the test drives the app into a state it could reach
    // through ordinary use, not a fabricated one.
    const syncGuides = (pid) => page.evaluate(async (p) => {
      const mod = await import('/editor/canvas/page-guides.js');
      const guides = await fetch(`/api/pages/${p}/guides`).then((r) => r.json());
      mod.renderGuides(guides);
    }, pid);
    const createGuide = async (pid, orientation, positionPx) => {
      const list = await page.evaluate(
        ([p, o, pos]) => fetch(`/api/pages/${p}/guides`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ orientation: o, positionPx: pos }),
        }).then((r) => r.json()),
        [pid, orientation, positionPx],
      );
      await syncGuides(pid);
      return list[list.length - 1];
    };
    const deleteGuide = async (pid, id) => {
      await page.evaluate(([p, gid]) => fetch(`/api/pages/${p}/guides/${gid}`, { method: 'DELETE' }), [pid, id]);
      await syncGuides(pid);
    };
    const fetchSection = async (key) => {
      const pages = await page.evaluate((ed) => fetch(`/api/newspapers/${ed}/pages`).then((r) => r.json()), ED);
      return pages[0].sections.find((s) => s.section_key === key);
    };
    // Like the guide sync above: a raw PATCH updates the database, but the
    // running app's own in-memory page (what section-drag.js reads element
    // positions from at the next drag's beginDrag()) only updates when told
    // to, via store.js's own replacePage() - the exact call moveSection()
    // itself makes with the PATCH response. Skipping this left the DOM
    // showing the previous drag's committed position while the database had
    // already moved on, which is what made an early version of this test
    // flaky - not the product, the test's own bypassed state.
    const restoreGeometry = (pid, key, rect) => page.evaluate(
      async ([p, k, r]) => {
        const updated = await fetch(`/api/pages/${p}/sections/${encodeURIComponent(k)}/geometry`, {
          method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(r),
        }).then((res) => res.json());
        const store = await import('/editor/store.js');
        store.replacePage(updated, { structural: true });
      },
      [pid, key, rect],
    );

    const pid = await pageIdOf();
    for (const g of await fetchGuides(pid)) await deleteGuide(pid, g.id);

    const before = await fetchSection(KEY);
    const original = { x: Number(before.x_px), y: Number(before.y_px), width: Number(before.width_px), height: Number(before.height_px) };
    const newspaperPx = await page.evaluate((ed) => fetch(`/api/newspapers/${ed}`).then((r) => r.json()), ED);
    const geometry = await page.evaluate(() => fetch('/api/geometry').then((r) => r.json()));

    // At "fit" zoom the page renders at under 30% scale (194px wide for a
    // 660px page), where a 4px snap threshold is under 2 screen px - too
    // fine for a simulated mouse to land reliably. Zoomed to 200%, the same
    // page-pixel distances are comfortably large on screen; the guide's
    // stored position and the snap threshold are unchanged either way,
    // since both are defined in page pixels, never screen ones.
    await page.selectOption('#zoomSelect', '2');
    await page.waitForTimeout(400);

    await block().scrollIntoViewIfNeeded();
    await block().click();
    await page.waitForTimeout(500);
    say(await block().evaluate((el) => el.classList.contains('active')), 'the block is selected before dragging it');

    async function scaleOf() {
      const pageBox = await page.locator('#canvasSurface').boundingBox();
      return pageBox.height / Number(newspaperPx.page_height_px);
    }

    // Moves the block by a page-pixel delta and stops MID-DRAG (pointer still
    // down) so the caller can read the live, in-flight style and the active
    // snap indicator before anything is committed.
    async function dragBlockToMidway(dxPagePx, dyPagePx) {
      await block().scrollIntoViewIfNeeded();
      await page.waitForTimeout(200);
      const box = await block().boundingBox();
      const scale = await scaleOf();
      const startX = box.x + box.width / 2;
      const startY = box.y + box.height / 2;
      await page.mouse.move(startX, startY);
      await page.mouse.down();
      await page.mouse.move(startX + (dxPagePx * scale) / 2, startY + (dyPagePx * scale) / 2, { steps: 5 });
      await page.mouse.move(startX + dxPagePx * scale, startY + dyPagePx * scale, { steps: 5 });
    }

    async function releaseDrag() {
      await page.mouse.up();
      await page.waitForTimeout(500);
    }

    async function dragHandleToMidway(handle, dxPagePx, dyPagePx) {
      await block().scrollIntoViewIfNeeded();
      const handleBox = await page.locator(`.section-handle.handle-${handle}`).boundingBox();
      const scale = await scaleOf();
      const startX = handleBox.x + handleBox.width / 2;
      const startY = handleBox.y + handleBox.height / 2;
      await page.mouse.move(startX, startY);
      await page.mouse.down();
      await page.mouse.move(startX + (dxPagePx * scale) / 2, startY + (dyPagePx * scale) / 2, { steps: 5 });
      await page.mouse.move(startX + dxPagePx * scale, startY + dyPagePx * scale, { steps: 5 });
    }

    async function liveRect() {
      return block().evaluate((el) => ({
        left: parseFloat(el.style.left) || 0,
        top: parseFloat(el.style.top) || 0,
        width: parseFloat(el.style.width) || 0,
        height: parseFloat(el.style.height) || 0,
      }));
    }

    async function activeGuideIds() {
      return page.locator('.page-guide.is-target').evaluateAll((els) => els.map((el) => Number(el.dataset.guideId)));
    }

    async function resetToOriginal() {
      await restoreGeometry(pid, KEY, original);
      await page.waitForTimeout(500);
    }

    // ---- vertical guide magnetically snaps the left edge, live ----
    // dx=+15 keeps the raw drag inside the same column's snap zone (the next
    // column start is ~39px away, so anything under ~19.5px stays put), so
    // the grid alone would leave the left edge at original.x - only the
    // guide, 4px further on, pulls it the rest of the way while dragging.
    let vGuide = await createGuide(pid, 'vertical', original.x + 4);
    await dragBlockToMidway(15, 0);
    let live = await liveRect();
    say(live.left === original.x + 4,
      'dragging the block\'s left edge within threshold snaps it, live, onto the vertical guide',
      `style.left ${live.left}, guide at ${original.x + 4}`);
    say(Math.abs(live.top - original.y) <= 1, 'and the untouched Y axis is not disturbed by an X-only drag',
      `style.top ${live.top}, original.y ${original.y}`);
    say((await activeGuideIds()).includes(vGuide.id), 'the guide itself is highlighted as the active snap target while dragging');
    await releaseDrag();
    say((await page.locator('.page-guide.is-target').count()) === 0, 'the snap indicator clears once the drag ends');
    say(await block().evaluate((el) => el.classList.contains('active')), 'the block, not the guide, remains selected after a snap');
    say((await fetchGuides(pid)).find((g) => g.id === vGuide.id).position_px === vGuide.position_px,
      'the guide\'s own stored position never changes because an object snapped to it');
    let sec = await fetchSection(KEY);
    say(geometry.snapLeftPx.includes(Number(sec.x_px)),
      'the persisted position still lands on a legal grid column - the print-safety rule the server enforces on every save',
      `x_px ${sec.x_px}`);
    await resetToOriginal();

    // ---- horizontal guide magnetically snaps the top edge, live ----
    // dy=+8 (one full baseline step) is unambiguous under the grid's own
    // baseline rounding - then the guide, 4px further on, pulls the rest of
    // the way while dragging. The vertical guide from the previous subtest
    // is gone first - left in play, it would keep pulling X on every drag
    // regardless of a Y-only intent, which is a fact about how independent
    // per-axis snapping works, not something this "Y-only" test wants to
    // exercise.
    await deleteGuide(pid, vGuide.id);
    let hGuide = await createGuide(pid, 'horizontal', original.y + 8 + 4);
    await dragBlockToMidway(0, 8);
    live = await liveRect();
    say(live.top === original.y + 8 + 4,
      'dragging the block\'s top edge within threshold snaps it, live, onto the horizontal guide',
      `style.top ${live.top}, guide at ${original.y + 8 + 4}`);
    say(Math.abs(live.left - original.x) <= 1, 'and the untouched X axis is not disturbed by a Y-only drag');
    await releaseDrag();
    await resetToOriginal();

    // ---- both axes can snap live in the same drag ----
    vGuide = await createGuide(pid, 'vertical', original.x + 4);
    await dragBlockToMidway(15, 8);
    live = await liveRect();
    say(live.left === original.x + 4 && live.top === original.y + 8 + 4,
      'horizontal and vertical snapping happen independently, live, in the same drag',
      `style.left ${live.left}, style.top ${live.top}`);
    await releaseDrag();
    await resetToOriginal();
    await deleteGuide(pid, hGuide.id);
    await deleteGuide(pid, vGuide.id);

    // ---- closest guide wins when two are in range ----
    const nearGuide = await createGuide(pid, 'vertical', original.x + 2);
    const farGuide = await createGuide(pid, 'vertical', original.x + 5);
    await dragBlockToMidway(15, 0);
    live = await liveRect();
    say(live.left === original.x + 2,
      'when two guides are both in range, the block snaps, live, to the CLOSER one', `style.left ${live.left}`);
    await releaseDrag();
    await resetToOriginal();
    await deleteGuide(pid, nearGuide.id);
    await deleteGuide(pid, farGuide.id);

    // ---- outside the threshold, no snap ----
    const farAwayGuide = await createGuide(pid, 'vertical', original.x + 20);
    await dragBlockToMidway(15, 0);
    live = await liveRect();
    say(live.left === original.x,
      'a guide well outside the threshold is not a snap target - the grid result stands untouched', `style.left ${live.left}`);
    await releaseDrag();
    await resetToOriginal();

    // ---- hidden guide: no snap; shown again: snap resumes ----
    await page.click('#guidesToggleBtn');
    await page.waitForTimeout(250);
    await deleteGuide(pid, farAwayGuide.id);
    const hiddenGuide = await createGuide(pid, 'vertical', original.x + 4);
    await dragBlockToMidway(15, 0);
    live = await liveRect();
    say(live.left === original.x, 'a guide is not a snap target while Guides is turned off', `style.left ${live.left}`);
    await releaseDrag();
    await resetToOriginal();
    await page.click('#guidesToggleBtn');
    await page.waitForTimeout(250);
    await dragBlockToMidway(15, 0);
    live = await liveRect();
    say(live.left === original.x + 4, 'turning Guides back on makes it a snap target again', `style.left ${live.left}`);
    await releaseDrag();
    await resetToOriginal();

    // ---- deleted guide is no longer a snap target ----
    await deleteGuide(pid, hiddenGuide.id);
    await dragBlockToMidway(15, 0);
    live = await liveRect();
    say(live.left === original.x, 'a deleted guide leaves no stale snap target', `style.left ${live.left}`);
    await releaseDrag();
    await resetToOriginal();

    // ---- resize: the dragged edge snaps live, the opposite edge stays put ----
    const resizeGuide = await createGuide(pid, 'vertical', original.x + original.width + 39 + 4);
    // The 'e' handle grows the right edge; +34 raw px lands the grid-snapped
    // right edge on the next column boundary (~39px away), then the guide,
    // 4px further on, pulls it the rest of the way while dragging - the left
    // edge, under no handle, must not move at all.
    await block().scrollIntoViewIfNeeded();
    await block().click();
    await page.waitForTimeout(400);
    await dragHandleToMidway('e', 34, 0);
    live = await liveRect();
    say(live.left === original.x, 'resizing from the right leaves the left (opposite) edge exactly where it was, live');
    say(live.left + live.width === original.x + original.width + 39 + 4,
      'and the resized right edge snaps, live, exactly onto the guide',
      `right edge ${live.left + live.width}, guide at ${original.x + original.width + 39 + 4}`);
    await releaseDrag();
    await resetToOriginal();
    await deleteGuide(pid, resizeGuide.id);

    // ---- network: nothing during the drag, exactly one PATCH on release ----
    const geometryGuide = await createGuide(pid, 'vertical', original.x + 4);
    const geometryRequests = [];
    const onGeometryRequest = (req) => { if (req.method() === 'PATCH' && /\/geometry$/.test(req.url())) geometryRequests.push(req.url()); };
    page.on('request', onGeometryRequest);
    await dragBlockToMidway(15, 0);
    say(geometryRequests.length === 0, 'no geometry request is sent while a snapped drag is still in progress');
    await releaseDrag();
    say(geometryRequests.length === 1, 'exactly one geometry request is sent when the drag ends', `${geometryRequests.length}`);
    page.off('request', onGeometryRequest);
    await resetToOriginal();
    await deleteGuide(pid, geometryGuide.id);

    // ---- a snap never creates a new guide ----
    const snapGuide = await createGuide(pid, 'vertical', original.x + 4);
    const beforeCount = (await fetchGuides(pid)).length;
    await dragBlockToMidway(15, 0);
    await releaseDrag();
    await resetToOriginal();
    say((await fetchGuides(pid)).length === beforeCount, 'snapping to a guide never creates another one');
    await deleteGuide(pid, snapGuide.id);

    // ---- ordinary grid snapping (no guides at all) is unaffected ----
    await dragBlockToMidway(75, 0);
    await releaseDrag();
    sec = await fetchSection(KEY);
    say(geometry.snapLeftPx.includes(Number(sec.x_px)),
      'with no guides on the page, an ordinary drag still lands on a column start', `x_px ${sec.x_px}`);
    await resetToOriginal();

    say((await fetchGuides(pid)).length === 0, 'no guides are left over from this block');

    await page.selectOption('#zoomSelect', 'fit');
    await page.waitForTimeout(400);
  }

  // ------------------------------------------------------- keyboard shortcuts ---
  //
  // Undo/redo already existed (history.js) with toolbar buttons; what is new
  // is the keyboard layer, and specifically that it must not fight normal
  // text editing - Ctrl+Z while a field has focus has to be the browser's
  // own undo of the last few characters, never a jump in the editor's
  // history stack out from under a cursor mid-sentence.
  {
    const original = await fieldText('edStoryHeadline');
    await page.fill('#edStoryHeadline', 'की-बोर्ड चाचणी मथळा');
    await page.waitForTimeout(700); // past history.js's COALESCE_MS, so this is its own undo step
    say((await fieldText('edStoryHeadline')) === 'की-बोर्ड चाचणी मथळा', 'the test headline was actually typed');

    // Move focus OUT of the field first - Ctrl+Z's target is the editor, not the input.
    await page.locator('.ext-editor-header').click();
    await page.keyboard.press('Control+z');
    await page.waitForTimeout(400);
    say((await fieldText('edStoryHeadline')) === original,
      'Ctrl+Z outside a text field undoes the last edit', await fieldText('edStoryHeadline'));

    await page.keyboard.press('Control+Shift+z');
    await page.waitForTimeout(400);
    say((await fieldText('edStoryHeadline')) === 'की-बोर्ड चाचणी मथळा',
      'Ctrl+Shift+Z redoes it', await fieldText('edStoryHeadline'));

    // Ctrl+Z back INTO a focused field must not jump the editor's history -
    // only the field's own native undo should act, leaving the editor's
    // state exactly where it was.
    await page.click('#edStoryHeadline');
    await page.keyboard.type(' अ');
    const beforeFieldUndo = await fieldText('edStoryHeadline');
    await page.keyboard.press('Control+z');
    await page.waitForTimeout(300);
    const afterFieldUndo = await fieldText('edStoryHeadline');
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
  say(await fieldText('edStoryHeadline') === HEADLINE, 'the headline survives a reload');
  say(await fieldText('edStorySubheading') === SUBHEADING, 'the subheading survives a reload');
  say((await page.locator('.ql-editor').innerText()).includes('महामेट्रोने'), 'the body survives a reload');
  say((await blockText()).includes('पुणे मेट्रोचा'), 'and the newspaper shows the same', beforeReload.slice(0, 40));

  // --------------------------------------------------------- the panels ---
  {
    const groups = (await page.locator('.ext-group-title').allInnerTexts()).map((t) => t.replace(/\s+/g, ' ').trim());
    for (const wanted of ['story', 'ai', 'layout', 'smart cards']) {
      say(groups.some((g) => g.toLowerCase().includes(wanted)), `panel: ${wanted}`, groups.join(' | '));
    }
    say(await page.locator('#workspaceToolsPanel .ext-aside > summary').count() === 4,
      'Properties, Typography, Story details and History are beside the page');
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
    // Inside the canonical composed layer, not a `#edFrameCard` of its own -
    // that element was removed when the Block Editor started drawing the same
    // composition the page draws (block-frame.js's layoutCard()), and this
    // check went on looking for it.
    say(await page.locator('#edCanonicalContent .smart-card-grid-table td').count() === 81, 'and in the editor');

    // The card's own headline ("आजचे सुडोकू", set by the accept handler
    // alongside smartCardKey/smartCardData - smart-card-panel.js) and the
    // card itself must not overlap. .section-feature used to be
    // position:absolute;inset:0, drawing the card over whatever headline
    // the flex column above it had already set - found live on a real
    // generated page (Project A, PROJECT_STATUS.md), not hypothetical: this
    // is the exact block this test already puts a card and a headline on.
    // The whole headline BAND, not one element: the composed renderer draws
    // one span per line, so a two-line card headline ("आजचे / सुडोकू") is two
    // `.section-headline` spans and a bare locator resolves to both. The
    // question here is whether the card overlaps the headline at all, which is
    // asked of the band's own union.
    const headlineBox = await block().evaluate((el) => {
      const spans = [...el.querySelectorAll('.section-headline')];
      if (!spans.length) return null;
      const boxes = spans.map((span) => span.getBoundingClientRect());
      const y = Math.min(...boxes.map((b) => b.y));
      return { y, height: Math.max(...boxes.map((b) => b.bottom)) - y };
    });
    const cardBox = await block().locator('.smart-card').boundingBox();
    if (headlineBox && cardBox) {
      const verticalOverlap = Math.min(headlineBox.y + headlineBox.height, cardBox.y + cardBox.height)
        - Math.max(headlineBox.y, cardBox.y);
      say(verticalOverlap <= 0, 'the Smart Card does not draw over its own block\'s headline',
        `overlap ${verticalOverlap.toFixed(1)}px`);
    } else {
      say(false, 'the Smart Card does not draw over its own block\'s headline', 'headline or card not found');
    }

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
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
  say(await page.locator('#worklistPanel').count() === 0, 'Stage 8: Escape closes a panel, same as its own × button');
  await page.locator('#worklistBtn').click();
  await page.waitForTimeout(1200);
  await page.locator('#worklistClose').click();
  await page.waitForTimeout(400);

  // ------------------------------------------------- Stage 8: XSS hardening ---
  // A reporter's own title/category/reporter_name used to reach the Story
  // Explorer drawer's innerHTML unescaped - a malicious submission would run
  // in whichever desk opened the drawer. Rendered directly against the real
  // module with a crafted record; no need to write it to the database first.
  {
    const outcome = await page.evaluate(async () => {
      const mod = await import('/editor/story-explorer.js');
      const host = document.createElement('div');
      host.id = 'xssTestHost';
      document.body.appendChild(host);
      host.innerHTML = mod.renderStoryExplorerMarkup([]);
      const malicious = {
        id: 999999, title: '<img src=x onerror="window.__xssFired = true">',
        reporter_name: '<b>hacker</b>', category: 'news', status: 'approved',
        created_at: new Date().toISOString(), image_urls: [],
      };
      mod.bindStoryExplorer([malicious], () => {});
      const card = document.querySelector('.story-card strong');
      const result = {
        rendersLiveImg: !!document.querySelector('#xssTestHost img[src="x"]'),
        cardText: card ? card.textContent : null,
        xssFired: window.__xssFired === true,
      };
      host.remove();
      delete window.__xssFired;
      return result;
    });
    say(outcome.rendersLiveImg === false, 'Story Explorer: a malicious title creates no live <img> element');
    say(outcome.xssFired === false, 'Story Explorer: the onerror handler never runs - it is text, not markup');
    say(outcome.cardText === '<img src=x onerror="window.__xssFired = true">',
      'and the card shows the literal characters, not a parsed tag', outcome.cardText);
  }

  // --------------------------------------------------- Stage 8: load failure ---
  // The workspace used to have no error handling around its initial load - a
  // dropped connection or a stale edition link left the desk staring at a
  // half-cleared screen with no message and no way back. A newspaper id that
  // does not exist 404s exactly like a dropped connection would.
  {
    // A 404 and the resulting console.error are the point of this block, not
    // a regression - snapshot errors[] and restore it after, the same way a
    // desk's own eyes would tell "the load failed, and it was handled" apart
    // from "something broke".
    const before = errors.length;
    const outcome = await page.evaluate(async () => {
      const mod = await import('/editor/workspace.js');
      await mod.renderWorkspace(999999999);
      return {
        errorShown: !!document.querySelector('.workspace-load-error'),
        hasRetry: !!document.getElementById('workspaceLoadRetry'),
      };
    });
    say(outcome.errorShown, 'Stage 8: a failed edition load shows a clear message, not a blank screen');
    say(outcome.hasRetry, 'and offers a way to try again');
    errors.length = before;
  }
  // Leave the workspace back on the real edition for anything appended after this.
  await openEdition();
  await block().click();
  await page.waitForTimeout(1200);

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
