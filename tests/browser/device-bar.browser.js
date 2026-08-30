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
    await page.locator(`.edition-row[data-edition-id="${ED}"] .edition-open`).click();
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
    say(bar && bar.length >= 15, 'and it carries every device', bar ? bar.join(' ') : '');

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

    // AND IT CAN BE SEEN. Counting the choices was all this used to do, and a
    // menu's buttons exist whether or not anything is visible: putting
    // `overflow-x: auto` on the bar - to stop it wrapping - clipped the menu,
    // which is a child of the bar and opens downwards out of it. Every menu
    // device drew into a hidden region and read as a dead button, and this net
    // reported 46/46. A rectangle is the question worth asking.
    const menuBox = await page.locator('#edDeviceMenu').boundingBox();
    const barBox = await page.locator('#edDeviceBar').boundingBox();
    say(Boolean(menuBox) && menuBox.height > 8 && menuBox.width > 8,
      'and it is actually on screen, not clipped away by the bar it hangs from',
      menuBox ? `${Math.round(menuBox.width)}x${Math.round(menuBox.height)}` : 'no box');
    say(Boolean(menuBox) && Boolean(barBox) && menuBox.y + menuBox.height > barBox.y + barBox.height,
      'and it hangs BELOW the bar, where a dropdown belongs',
      menuBox && barBox ? `menu ends ${Math.round(menuBox.y + menuBox.height)}, bar ends ${Math.round(barBox.y + barBox.height)}` : '-');
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
    await choose('orn:diamond');
    const afterOrnament = await block().locator('.section-inset-panel').count();
    // ONE ORNAMENT, NOT "one more panel than before". Choosing a separator
    // REPLACES any separator already on the block (that is what makes the
    // vocabulary a vocabulary rather than a stack), so a block that arrives
    // carrying one legitimately ends with the same panel count. Asserting the
    // count grew made this check depend on ambient fixture state - the trap
    // this file's own restore exists to avoid, and the one visual-pass was
    // caught by earlier.
    say(await block().locator('.section-inset-ornament').count() === 1,
      'Separator sets an ornament across the measure',
      `${panelsBefore} → ${afterOrnament} panels, 1 ornament`);
    // A VOCABULARY, not one fixed mark. The button produced exactly one thing
    // before - ◆ between two hairlines - which is one separator, not a device.
    const markOf = async () => (await block().locator('.section-inset-ornament span').first()
      .innerText().catch(() => '')).trim();
    say(await markOf() === '\u25c6', 'and it is the one that was chosen', await markOf());
    await press('rule');
    await choose('orn:squares');
    say(await markOf() === '\u25aa \u25aa \u25aa', 'a different separator REPLACES it, never stacks',
      `${await markOf()} · ${await block().locator('.section-inset-ornament').count()} on the block`);

    // EVERY ORNAMENT IN THE VOCABULARY, because the one that was broken was
    // the one nothing had pressed. `plain` is two rules and nothing between
    // them - the first entry and the one a printed paper sets most often - so
    // it carries no mark, and panelOf() judged a panel with neither a title
    // nor a line empty and threw it away. The draft stored it, the menu lit
    // its own "Remove the separator", and the page, the Block Editor, the
    // obstacle set and all four exports drew NOTHING. Two checks would not
    // have caught it; pressing all seven does.
    await press('rule');
    const vocabulary = await page.evaluate(() => [...document.querySelectorAll('#edDeviceMenu [data-device-choice]')]
      .map((b) => b.dataset.deviceChoice).filter((v) => v.startsWith('orn:') && v !== 'orn:remove'));
    await page.keyboard.press('Escape');
    say(vocabulary.length >= 5, 'the Separator offers a vocabulary', vocabulary.join(' '));
    for (const orn of vocabulary) {
      await press('rule');
      await choose(orn);
      const drawn = await block().locator('.section-inset-ornament').count();
      const inEditor = await page.locator('#edFramePage .section-inset-ornament').count();
      say(drawn === 1 && inEditor === 1, `${orn} is DRAWN, on both surfaces`,
        `canvas ${drawn}, Block Editor ${inEditor}`);
    }
    // And leave the block as this section found it, so the checks below (and
    // the next run) start where they expect to.
    await press('rule');
    await choose('orn:diamond');

    await press('insert');
    await choose('panel:note');
    say(await block().locator('.section-inset-panel').count() > afterOrnament,
      'Insert → Fact box adds a panel, live, without a reload');

    // ---- the charts --------------------------------------------------------
    //
    // A chart is no longer one press. Pressing a kind used to write a seed card
    // - the same four districts, the whole block, always red - which is what
    // the desk meant by "showing only same graph and pie charts which is
    // useless". It now opens a dialog that asks the two questions the seed
    // answered by guessing: how much room, and what is in it.
    const fillChart = async ({ room = 'block', ink = null, rows = [['सातारा', '842'], ['कोल्हापूर', '1290'], ['सांगली', '603']] } = {}) => {
      await page.locator(`.chart-dialog [data-chart-room="${room}"]`).click();
      await page.waitForTimeout(150);
      if (ink) { await page.locator(`.chart-dialog [data-chart-ink="${ink}"]`).click(); await page.waitForTimeout(150); }
      // One row exists; add the rest, then type into all of them.
      const have = await page.locator('.chart-dialog .chart-row').count();
      for (let i = have; i < rows.length; i += 1) {
        await page.locator('.chart-dialog [data-chart-add]').click();
        await page.waitForTimeout(80);
      }
      for (const [i, [label, value]] of rows.entries()) {
        await page.locator(`.chart-dialog .chart-row[data-row="${i}"] .chart-row-label`).fill(label);
        await page.locator(`.chart-dialog .chart-row[data-row="${i}"] .chart-row-value`).fill(value);
      }
      await page.locator('.chart-dialog [data-chart-apply]').click();
      await page.waitForTimeout(2400);
    };

    for (const [kind, selector] of [
      ['pie', '.smart-chart-pie svg polygon'],
      ['line', '.smart-chart-plot svg polyline'],
      ['dots', '.smart-chart-plot svg circle'],
      ['bar', '.smart-chart-bars i'],
      ['stat', '.smart-chart-stat'],
    ]) {
      await press('chart');
      await choose(kind);
      say(await page.locator('.chart-dialog').count() === 1,
        `Chart → ${kind} asks for its room and its data first`);
      await fillChart();
      const n = await block().locator(selector).count();
      say(n > 0, `Chart → ${kind} draws on the canvas`, `${n} × ${selector.split(' ').pop()}`);
    }

    // THE DATA IS THE DESK'S, not the seed's. The whole complaint.
    say(await block().locator('.smart-chart-stat').first().innerText()
      .then((t) => t.includes('सातारा')).catch(() => false),
      'and it draws the readings that were typed, not a built-in example');

    // A CHART IN A PANEL - the "take space in news block" step, which did not
    // exist at all: a card took the whole block or nothing.
    await press('chart');
    await choose('pie');
    await fillChart({ room: 'half', ink: '#17458f' });
    const panelChart = await block().locator('.section-inset-chart .smart-chart-pie').count();
    say(panelChart > 0, 'a chart can take a PANEL inside the block, copy running round it',
      `${panelChart} × chart panel`);
    const blueSlice = await block().locator('.section-inset-chart svg polygon').first()
      .getAttribute('fill').catch(() => null);
    say(Boolean(blueSlice) && blueSlice.toLowerCase() !== '#c8102e',
      'and it prints in the ink the desk chose, not the paper red', String(blueSlice));
    say(await block().locator('.section-feature-card .smart-chart').count() === 0,
      'moving a chart into a panel clears the whole-block card, so the two cannot both draw');
    await block().screenshot({ path: `${SHOTS}/canvas-chart-panel.png` }).catch(() => {});

    // AND IT COMES OFF AGAIN. "Everytime we are able to add we should able to
    // remove" - the first of the eleven, and it was true of four devices.
    await press('chart');
    await choose('remove');
    say(await block().locator('.smart-chart').count() === 0, 'Chart → Remove takes it off');
    say(!(await isOn('chart')), 'and the button goes out with it');

    // ---- the three type sizes, on the bar -----------------------------------
    const sizeOf = async (field) => Number(
      await page.locator(`#edDeviceBar [data-size-out="${field}"]`).innerText());
    for (const field of ['headlineFontPx', 'subheadingFontPx', 'bodyFontPx']) {
      const before = await sizeOf(field);
      await page.locator(`#edDeviceBar [data-size-field="${field}"] [data-size-step="up"]`).click();
      await page.waitForTimeout(1600);
      const after = await sizeOf(field);
      say(after > before, `${field} steps up on the bar`, `${before} → ${after}`);
      await page.locator(`#edDeviceBar [data-size-field="${field}"] [data-size-step="down"]`).click();
      await page.waitForTimeout(1600);
      say(await sizeOf(field) === before, `and back down again`, String(before));
    }

    // A DISPLAY SIZE IS A REQUEST UNTIL IT IS LOCKED, and the read-out says
    // which. The desk's report was "if we increase/decrease headline size it
    // is not reflecting in editor" - true, because the compositor fits display
    // type and the stored number is what was ASKED for.
    const headlineDrawnPx = async () => page.evaluate((k) => {
      const b = document.querySelector(`.newspaper-section[data-section-key="${k}"]`);
      const line = b && b.querySelector('.section-headline-line, .section-display-line, [class*="headline"]');
      return line ? Math.round(parseFloat(getComputedStyle(line).fontSize)) : null;
    }, KEY);
    const before = await headlineDrawnPx();
    // Three steps up, each of which locks - so the last one is honoured exactly.
    for (let i = 0; i < 3; i += 1) {
      await page.locator('#edDeviceBar [data-size-field="headlineFontPx"] [data-size-step="up"]').click();
      await page.waitForTimeout(1400);
    }
    const after = await headlineDrawnPx();
    say(before === null || after === null || after > before,
      'stepping the headline size changes the type ON THE PAGE, not just the number',
      `${before} → ${after}`);
    say(await page.locator('#edDeviceBar [data-size-lock="headlineLocked"].is-on').count() === 1,
      'and the size is held, because a desk reaching for it is asking for it');
    await page.locator('#edDeviceBar [data-size-lock="headlineLocked"]').click();
    await page.waitForTimeout(1600);
    say(await page.locator('#edDeviceBar [data-size-lock="headlineLocked"].is-on').count() === 0,
      'pressing the letter hands the size back to the compositor');

    // ---- justify, and the dateline ------------------------------------------
    // These two repaint the whole page rather than one attribute, so they are
    // given the same settling time the menu choices are - measured at 400ms the
    // patch had reached the database and the bar had not yet been redrawn.
    const toggle = async (device) => { await press(device); await page.waitForTimeout(1800); };

    await toggle('justify');
    say(await isOn('justify'), 'Justify sets the copy flush to both edges');
    await toggle('justify');
    say(!(await isOn('justify')), 'and takes it off again');

    // JUSTIFY ALL LINES - and that it really fills the measure, not just that
    // the button lights. `justify` stands down below JUSTIFY_MIN_EM, which is
    // 55% of this paper's columns, so "the setting is stored" proves nothing
    // about what the page does; the composition is asked instead.
    await toggle('justify-all');
    say(await isOn('justify-all'), 'Justify lines sets the block');
    say(!(await isOn('justify')), 'and the two settings of one field never light together');
    const filled = await page.evaluate(async (k) => {
      const st = await import('/editor/store.js');
      const a = await import('/editor/compose/section-adapter.js');
      const c = a.composeSection(st.getSection(k), st.getDraft());
      const lines = c.bodyLines.filter((l) => !l.dateline);
      const gaps = (l) => (String(l.text).trim().match(/\s+/g) || []).length;
      // THE TWO PATHS REPORT WIDTH DIFFERENTLY, on purpose (compose.js says so
      // where it does it): a line the balancer set TIGHT carries a negative
      // word space and has already had the squeeze folded into `width`, while
      // an expanded line's `width` deliberately understates by the spacing it
      // gained. Adding a negative spacing to an already-squeezed width
      // subtracts it twice and reports a flush line as 3% short.
      const drawn = (l) => (l.wordSpacingPx > 0 ? l.width + l.wordSpacingPx * gaps(l) : l.width);
      // A paragraph's LAST line is meant to be short, and a line with no word
      // space in it cannot be justified by anybody - there is nothing to
      // distribute. Both are the reference block's own exceptions.
      const interior = lines.filter((l, i) => i < lines.length - 1
        && !(lines[i + 1] || {}).paragraphBreak && gaps(l) > 0);
      const fills = interior.map((l) => drawn(l) / l.measure);
      const ems = interior.map((l) => Number(((l.wordSpacingPx || 0) / l.fontPx).toFixed(2)));
      return { n: interior.length, short: fills.filter((f) => f < 0.97).length,
        worst: fills.length ? Math.min(...fills) : 1, spread: new Set(ems).size };
    }, KEY);
    say(filled.n >= 3, 'the block sets enough interior lines to judge', `${filled.n}`);
    say(filled.short === 0, 'every interior line reaches its measure',
      `${filled.short} of ${filled.n} short, worst ${(filled.worst * 100).toFixed(1)}%`);
    say(filled.spread > 1, 'and the word gaps differ line to line, as the reference does',
      `${filled.spread} distinct gaps`);
    await toggle('justify-all');
    say(!(await isOn('justify-all')), 'and it comes off again');

    // THE FIXTURE BLOCK HAS NO LOCATION, so there was no dateline for this to
    // turn off and the check read false both times - a test passing on the
    // absence of the thing it is testing. One is set first, and the restore
    // below puts the block's own (empty) location back.
    const datelineShowing = async () => await page.evaluate((k) => {
      const b = document.querySelector(`.newspaper-section[data-section-key="${k}"]`);
      return Boolean(b) && b.textContent.includes('\u25a0');
    }, KEY);
    // Set through the field's OWN input event rather than with a click: Story
    // details is deliberately folded away (it is a panel editors open rarely),
    // so a visible-element fill cannot reach it. This is the same handler a
    // desk's keystroke runs.
    await page.evaluate(() => {
      const field = document.getElementById('edLocation');
      if (!field) return;
      field.value = '\u0938\u093e\u0924\u093e\u0930\u093e';
      field.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await page.waitForTimeout(2400);
    const hadDateline = await datelineShowing();
    say(hadDateline, 'a block with a location opens with its dateline');
    await toggle('dateline');
    say(await datelineShowing() !== hadDateline, 'the Dateline button turns ■ location, reporter on and off');
    await toggle('dateline');
    say(await datelineShowing() === hadDateline, 'and puts it back');

    // ---- and a separator comes off again ------------------------------------
    const ornaments = () => block().locator('.section-inset-ornament').count();
    const hadOrnament = await ornaments();
    await press('rule');
    await choose('orn:remove');
    say(await ornaments() < hadOrnament, 'Separator → Remove takes it off',
      `${hadOrnament} → ${await ornaments()}`);

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
            // Added when the bar grew these devices. A restore that does not
            // mention a column leaves this run's value in the fixture - which
            // is how a later run of this very net came to start from a
            // justified block and read its own toggle backwards.
            textAlign: row.text_align, showDateline: row.show_dateline !== false,
            headlineLocked: row.headline_locked === true, subheadingLocked: row.subheading_locked === true,
            location: row.location || '', reporterName: row.reporter_name || '',
            headlineFontPx: row.headline_font_px, subheadingFontPx: row.subheading_font_px,
            bodyFontPx: row.body_font_px,
          }),
        });
      }, [restore.pageId, KEY, s]).catch(() => {});
      say(true, 'the block this run borrowed is put back exactly as it was found');
    }
    console.log(`\n${pass}/${ran} passed`);
    await browser.close();
  }
})();
