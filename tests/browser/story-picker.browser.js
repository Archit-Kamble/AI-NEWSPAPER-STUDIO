// TAKE FROM REPORTER - the drawer, the search, and the fill.
//
// This net exists because nothing drove this path and a real bug was sitting
// in it. An editor does not type most of a paper: they take a reporter's
// filing and edit it, which is the workflow VISION.md puts at the centre of
// the desk. The only coverage was an XSS check on the explorer's markup.
//
// What it found: taking a story that carries no body left the canvas setting
// the dateline alone and the Block Editor still setting the PREVIOUS story,
// permanently. pick() treated '' as "the desk has not said" and fell through
// to the row - right for a font family, wrong for the words. The same fault
// answers Ctrl+A/Delete in the body, which is the version a desk meets daily.
// See section-adapter.js's pickText().
//
//   node tests/browser/story-picker.browser.js            # defaults to 40294 / brief-two
//   node tests/browser/story-picker.browser.js 40294 lead
const { chromium } = require('playwright-core');

const ED = Number(process.argv[2] || 40294);
const KEY = process.argv[3] || 'brief-two';
const BASE = process.env.SAHAS_BASE || 'http://localhost:3000';

let pass = 0;
let ran = 0;
const say = (ok, name, detail = '') => {
  ran += 1;
  if (ok) pass += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` :: ${detail}` : ''}`);
};

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || '/usr/bin/google-chrome' });
  const page = await browser.newPage({ viewport: { width: 1800, height: 1300 }, deviceScaleFactor: 2 });
  const errors = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(`console: ${m.text()}`); });

  let restore = null;
  try {
    await page.goto(BASE);
    await page.waitForTimeout(900);
    if (await page.locator('#email').count()) {
      await page.fill('#email', 'admin@esahas.com');
      await page.fill('#password', 'admin123');
      await page.click('#loginBtn');
    }
    await page.waitForSelector('.edition-row', { timeout: 20000 });
    const when = await page.evaluate(
      (ed) => fetch(`/api/newspapers/${ed}`).then((r) => r.json()).then((n) => String(n.publication_date).slice(0, 10)), ED,
    );
    await page.fill('#editionSearch', when);
    await page.waitForTimeout(700);
    await page.locator(`.edition-row[data-edition-id="${ED}"] button`).click();
    await page.waitForSelector('#canvasSurface', { timeout: 20000 });
    await page.waitForTimeout(2500);

    await page.locator(`.newspaper-section[data-section-key="${KEY}"]`).first().click();
    await page.waitForTimeout(2200);

    // Everything this net writes goes back, and from the crash handler too.
    restore = await page.evaluate(async ([ed, key]) => {
      const pages = await fetch(`/api/newspapers/${ed}/pages`).then((r) => r.json());
      const pg = pages.find((p) => p.sections.some((s) => s.section_key === key));
      return { pageId: pg.id, s: pg.sections.find((x) => x.section_key === key) };
    }, [ED, KEY]);

    const draft = () => page.evaluate(async () => (window.__st || (window.__st = await import('/editor/store.js'))).getDraft());
    const bothSurfaces = () => page.evaluate((k) => {
      const el = document.querySelector(`.newspaper-section[data-section-key="${k}"]`);
      const text = (node) => (node ? node.textContent.trim().slice(0, 22) : '');
      return {
        canvas: el.querySelectorAll('.section-body-line').length,
        editor: document.querySelectorAll('#edFramePage .section-body-line').length,
        canvasFirst: text(el.querySelector('.section-body-line')),
        editorFirst: text(document.querySelector('#edFramePage .section-body-line')),
      };
    }, KEY);

    // ---- clearing a story --------------------------------------------------
    //
    // The same fault by the route a desk takes daily, and it runs FIRST because
    // it needs a block that has copy in it - after the take above, this block
    // may hold a filing with no body at all, and an empty body frame has no
    // box to press.
    //
    // The toolbar is sticky, so a frame scrolled under it swallows the press.
    await page.evaluate(() => document.getElementById('edFramePage')?.scrollIntoView({ block: 'center' }));
    await page.waitForTimeout(600);
    const hadCopy = ((await draft()).body || '').length;
    say(hadCopy > 0, 'the block starts with a story in it', `${hadCopy} characters`);
    if (hadCopy > 0) {
      await page.locator('#edBodyFrame').click({ position: { x: 30, y: 20 } });
      await page.waitForTimeout(500);
      await page.locator('#edBodyFrame').dblclick({ position: { x: 30, y: 20 } });
      await page.waitForTimeout(1200);
      await page.keyboard.press('Control+a');
      await page.waitForTimeout(300);
      await page.keyboard.press('Delete');
      await page.waitForTimeout(3000);

      const cleared = await bothSurfaces();
      say((await draft()).body === '', 'Ctrl+A and Delete clears the story');
      say(cleared.canvas === cleared.editor,
        'and the deleted copy is gone from BOTH surfaces, not just the canvas',
        `canvas ${cleared.canvas}, Block Editor ${cleared.editor}`);
      // The block is deliberately left empty for the drawer section below: the
      // whole point of taking a filing is to fill a block that has no story,
      // and everything this net writes goes back in `finally`.
    }

    // ---- the drawer --------------------------------------------------------
    const bar = page.locator('#edChooseStory, #edChangeStory');
    say(await bar.count() > 0, 'the "Take from Reporter" bar is on the writing panel');
    await bar.first().click();
    await page.waitForTimeout(1600);

    const drawer = await page.evaluate(() => {
      const d = document.querySelector('.story-explorer');
      if (!d) return null;
      // It opens by CLASS on #sidebarLeft, not by being added to the DOM - the
      // markup is written once and shown. Asserting it was removed is how this
      // check was wrong the first time it was written.
      const open = document.getElementById('sidebarLeft')?.classList.contains('open');
      return {
        open,
        results: document.querySelectorAll('#storyExplorerResults [data-story-id]').length,
        filters: document.querySelectorAll('.story-explorer-filters select, #storySearch').length,
      };
    });
    say(Boolean(drawer), 'the Story Explorer drawer opens');
    say(drawer && drawer.open, 'and the sidebar is open', String(drawer?.open));
    say(drawer && drawer.filters >= 4, 'it carries its search and its filters', `${drawer?.filters}`);
    say(drawer && drawer.results > 0, 'and it lists the reporters\' copy', `${drawer?.results} filings`);

    // ---- search ------------------------------------------------------------
    const firstWord = await page.evaluate(() => {
      const c = document.querySelector('#storyExplorerResults [data-story-id] .story-card-body');
      return (c?.textContent || '').trim().split(/\s+/)[0] || '';
    });
    await page.fill('#storySearch', firstWord);
    await page.waitForTimeout(1200);
    const narrowed = await page.evaluate(() => document.querySelectorAll('#storyExplorerResults [data-story-id]').length);
    say(narrowed > 0 && narrowed <= drawer.results, 'search narrows the list',
      `${drawer.results} → ${narrowed} for "${firstWord}"`);
    await page.fill('#storySearch', '');
    await page.waitForTimeout(1000);

    // ---- taking one --------------------------------------------------------
    const before = await draft();
    await page.locator('#storyExplorerResults [data-story-id]').first().click();
    await page.waitForTimeout(3000);

    const after = await draft();
    say(after.headline !== before.headline || after.body !== before.body,
      'taking a story fills the block', `headline ${JSON.stringify(String(after.headline).slice(0, 24))}`);
    say(Boolean(after.newsItemId), 'and the block records which story it came from', String(after.newsItemId));
    say(await page.evaluate(() => !document.getElementById('sidebarLeft')?.classList.contains('open')),
      'and the drawer closes');

    // THE CHECK THIS NET WAS WRITTEN FOR. A story with no body must leave BOTH
    // surfaces setting the same thing - which they did not: the canvas set the
    // dateline alone and the Block Editor went on setting the story that was
    // there before.
    const set = await bothSurfaces();
    say(set.canvas === set.editor, 'the canvas and the Block Editor set the same number of lines',
      `${set.canvas} vs ${set.editor}`);
    say(set.canvasFirst === set.editorFirst, 'and the same first line - the dateline included',
      `${JSON.stringify(set.canvasFirst)} vs ${JSON.stringify(set.editorFirst)}`);

  } catch (err) {
    console.log(`CRASH after ${pass}/${ran}: ${err.message}`);
    console.log(err.stack.split('\n').slice(0, 4).join('\n'));
  } finally {
    if (restore) {
      await page.evaluate(async ([pageId, s]) => {
        await fetch(`/api/pages/${pageId}/sections/${s.section_key}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            headline: s.headline, subheading: s.subheading, body: s.body, kicker: s.kicker,
            newsItemId: s.news_item_id, reporterName: s.reporter_name, location: s.location,
            category: s.category, headlineFontPx: s.headline_font_px,
            subheadingFontPx: s.subheading_font_px, bodyFontPx: s.body_font_px,
            textAlign: s.text_align, borderStyle: s.border_style, backgroundColor: s.background_color,
            columnCount: s.column_count ?? 0, dropCapLines: s.drop_cap_lines, fontFamily: s.font_family,
            listStyle: s.list_style, showDateline: s.show_dateline, insetPanels: s.inset_panels || [],
            marginPx: s.margin_px, lineHeight: s.line_height, paragraphSpacingPx: s.paragraph_spacing_px,
          }),
        });
      }, [restore.pageId, restore.s]).catch(() => {});
    }
    console.log(`\n${pass}/${ran} passed`);
    if (errors.length) console.log(`\nBROWSER ERRORS (${errors.length}):\n${[...new Set(errors)].slice(0, 6).join('\n')}`);
    await browser.close();
  }
})();
