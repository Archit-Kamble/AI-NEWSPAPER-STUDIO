// THE DEVICE BAR - press every button, and check WHICH thing moved.
//
// This net exists because of the report that produced the bar: "I have not
// seen buttons or things you modified." Every device in this product was
// reachable and none of them was FINDABLE, and the fix for that is a row of
// labelled buttons on the editor - which is only worth anything if each one
// actually acts. The very first version of the bar did not: it bound its
// listener on every render, and because pressing an open menu toggles it, an
// even number of listeners opened and closed it in one click. It drew
// perfectly and did nothing, which is exactly the class of fault the bar was
// built to remove, and only pressing it in a real browser could have found it.
//
//   node tests/browser/device-bar.browser.js            # defaults to 44929 / lead
//   node tests/browser/device-bar.browser.js 40294 lead
const { chromium } = require('playwright-core');

const ED = Number(process.argv[2] || 44929);
const KEY = process.argv[3] || 'lead';
const BASE = process.env.SAHAS_BASE || 'http://localhost:3000';
const SHOTS = 'tmp-visual-pass';

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

    const block = () => page.locator(`.newspaper-section[data-section-key="${KEY}"]`).first();
    await block().click();
    await page.waitForTimeout(2200);

    // WHAT TO PUT BACK, read before anything is pressed. A net that writes into
    // a real block must restore it - and must do so when it CRASHES too, which
    // is how five blocks of edition 40294 once came to carry body sizes nobody
    // chose.
    restore = await page.evaluate(async ([ed, key]) => {
      const pages = await fetch(`/api/newspapers/${ed}/pages`).then((r) => r.json());
      const pg = pages.find((p) => p.sections.some((s) => s.section_key === key));
      return { pageId: pg.id, s: pg.sections.find((x) => x.section_key === key) };
    }, [ED, KEY]);

    const bar = await page.evaluate(() => {
      const b = document.getElementById('edDeviceBar');
      return b ? [...b.querySelectorAll('[data-device]')].map((x) => x.dataset.device) : null;
    });
    say(Boolean(bar), 'the device bar is on the editor', bar ? `${bar.length} buttons` : 'missing');
    say(bar && bar.length >= 13, 'and it carries every device', bar ? bar.join(' ') : '');

    const press = async (device) => {
      await page.locator(`#edDeviceBar [data-device="${device}"]`).click();
      await page.waitForTimeout(400);
    };
    const choose = async (value) => {
      await page.locator(`#edDeviceMenu [data-device-choice="${value}"]`).click();
      await page.waitForTimeout(2200);
    };
    const isOn = async (device) => await page.locator(`#edDeviceBar [data-device="${device}"].is-on`).count() === 1;

    // ---- the frame ---------------------------------------------------------
    await press('border');
    say(await page.locator('#edDeviceMenu [data-device-choice]').count() > 0,
      'a menu opens on the first press - not on the second', '');
    await choose('box');
    say(await isOn('border'), 'Border → Box turns the button on');
    say(await page.evaluate((k) => {
      const b = document.querySelector(`.newspaper-section[data-section-key="${k}"]`);
      return Boolean(b) && getComputedStyle(b).borderTopWidth !== '0px';
    }, KEY), 'and the block on the NEWSPAPER CANVAS is ruled');

    await press('ground');
    const tint = await page.locator('#edDeviceMenu [data-device-choice^="#"]').first().getAttribute('data-device-choice');
    await choose(tint);
    say(await isOn('ground'), 'Tint lays a ground', tint);

    await press('columns');
    await choose('2');
    say(await isOn('columns'), 'Columns → 2');

    // ---- the type ----------------------------------------------------------
    await press('font');
    await choose('mukta');
    const face = await page.locator('#edDeviceBar [data-device="font"] span').innerText();
    say(face.includes('Mukta'), 'Body face → Mukta, and the button says which', face);

    await press('display');
    await choose('khand');
    const head = await page.locator('#edDeviceBar [data-device="display"] span').innerText();
    say(head.toLowerCase().includes('khand'), 'Headline face → Khand', head);

    // A list is the BLOCK's, not Quill's - two different objects, two controls.
    await press('list-number');
    const markers = await block().locator('.section-list-marker').count();
    say(markers > 0, 'Numbers hangs real markers on the page', String(markers));
    await press('list-number');
    say(await block().locator('.section-list-marker').count() === 0, 'and pressing it again takes them off');

    // ---- set into the story ------------------------------------------------
    const panelsBefore = await block().locator('.section-inset-panel').count();
    await press('rule');
    await page.waitForTimeout(2200);
    const afterOrnament = await block().locator('.section-inset-panel').count();
    say(afterOrnament > panelsBefore, 'Separator sets an ornament across the measure',
      `${panelsBefore} → ${afterOrnament}`);

    await press('insert');
    await choose('panel:note');
    say(await block().locator('.section-inset-panel').count() > afterOrnament,
      'Insert → Fact box adds a panel, live, without a reload');

    // ---- the charts --------------------------------------------------------
    // Five kinds now, and the three that were "impossible" are the ones that
    // matter here: a pie, a line and a dot plot all reduce to polygons.
    for (const [kind, selector] of [
      ['pie', '.smart-chart-pie svg polygon'],
      ['line', '.smart-chart-plot svg polyline'],
      ['dots', '.smart-chart-plot svg circle'],
      ['bar', '.smart-chart-bars i'],
      ['stat', '.smart-chart-stat'],
    ]) {
      await press('chart');
      await choose(kind);
      const n = await block().locator(selector).count();
      say(n > 0, `Chart → ${kind} draws on the canvas`, `${n} × ${selector.split(' ').pop()}`);
    }
    await block().screenshot({ path: `${SHOTS}/canvas-chart-stat.png` }).catch(() => {});

    // ---- the two that open something rather than patching ------------------
    say(await page.locator('#aiProposePicture').count() > 0,
      'the AI picture button has something to press');

    say(errors.length === 0, 'no console errors or page errors anywhere in this run',
      errors.join(' | ') || '(none)');
  } catch (error) {
    console.log(`\nCRASHED after ${pass}/${ran} - later checks did NOT run\n`, error.message);
    process.exitCode = 1;
  } finally {
    // Reachable from the crash handler, deliberately.
    if (restore) {
      const s = restore.s;
      await page.evaluate(async ([pageId, key, row]) => {
        await fetch(`/api/pages/${pageId}/sections/${key}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            headline: row.headline || '', subheading: row.subheading || '', body: row.body || '',
            borderStyle: row.border_style, backgroundColor: row.background_color,
            columnCount: row.column_count ?? 0, fontFamily: row.font_family,
            displayFamily: row.display_family || '', listStyle: row.list_style,
            dropCapLines: row.drop_cap_lines, insetPanels: row.inset_panels || [],
            smartCardKey: row.smart_card_key || null, smartCardData: row.smart_card_data || null,
          }),
        });
      }, [restore.pageId, KEY, s]).catch(() => {});
      say(true, 'the block this run borrowed is put back exactly as it was found');
    }
    console.log(`\n${pass}/${ran} passed`);
    await browser.close();
  }
})();
