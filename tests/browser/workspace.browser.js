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
