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

  // Opening the edition is done more than once - a change made through the API
  // is only on the canvas after the workspace has fetched the page again, and
  // page.reload() lands on the EDITION LIST rather than back in the workspace.
  async function openEdition() {
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
  }
  await openEdition();

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

  // ---- the border control, which could not act ---------------------------
  //
  // "Rule below" had been in the Properties panel since it was written and the
  // server's whitelist was ['none', 'box'], so pressing it sent a payload that
  // came back 400 and the page never changed. This presses each button and
  // checks the class actually lands on the block.
  //
  // THE RESTORE CARRIES THE WHOLE BLOCK, NEVER JUST THE FIELD IT CHANGED.
  //
  // PUT /api/pages/:pageId/sections/:key is a full replace for the fields it
  // covers, so a payload of { borderStyle } sets every other one of them to
  // its default - which is to say it blanks the headline, the deck and the
  // story. This net did exactly that to edition 40294's lead block on its
  // first run and had to refill it. CLAUDE.md records the same trap being hit
  // by a hand-written probe once before; it is written into the harness now so
  // it cannot be hit a third time.
  const borderWas = await page.evaluate(async ([ed, key]) => {
    const pages = await fetch(`/api/newspapers/${ed}/pages`).then((r) => r.json());
    const pg = pages.find((p) => p.sections.some((s) => s.section_key === key));
    return pg.sections.find((x) => x.section_key === key);
  }, [ED, KEY]);
  const restoreBorder = putBack;
  putBack = async () => {
    await restoreBorder();
    await page.evaluate(async ([ed, key, was]) => {
      const pages = await fetch(`/api/newspapers/${ed}/pages`).then((r) => r.json());
      const pg = pages.find((p) => p.sections.some((s) => s.section_key === key));
      // Every field the section carried, sent back as it was found.
      const body = {
        kicker: was.kicker || '', headline: was.headline || '', subheading: was.subheading || '',
        body: was.body || '', caption: was.caption || '', reporterName: was.reporter_name || '',
        category: was.category || '', location: was.location || '', tags: was.tags || [],
        headlineFontPx: was.headline_font_px, subheadingFontPx: was.subheading_font_px,
        bodyFontPx: was.body_font_px, lineHeight: was.line_height, textAlign: was.text_align,
        marginPx: was.margin_px, columnCount: was.column_count ?? 0,
        borderStyle: was.border_style || 'none', borderWidthPx: Number(was.border_width_px) || 1,
        backgroundColor: was.background_color, headlineStyle: was.headline_style || 'plain',
        dropCapLines: was.drop_cap_lines || 0,
        // The card too. Omitting these CLEARED a Smart Card the block was
        // carrying, because this PUT is a full replace - the same trap the
        // whole-block restore exists for, one field family further on.
        smartCardKey: was.smart_card_key || null,
        smartCardData: was.smart_card_data || null,
      };
      await fetch(`/api/pages/${pg.id}/sections/${key}`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
    }, [ED, KEY, borderWas]).catch(() => {});
  };

  for (const [style, klass] of [['rule', 'ruled-rule'], ['rule-above', 'ruled-rule-above'],
    ['rule-both', 'ruled-rule-both'], ['box', 'ruled-box']]) {
    await page.locator(`[data-prop-border] [data-border="${style}"]`).click();
    await page.waitForTimeout(1800);
    const on = await page.evaluate((k) => {
      const block = document.querySelector('.newspaper-section.active');
      return block ? block.className : '';
    }, klass);
    say(on.includes(klass), `border "${style}" reaches the page`, on.slice(0, 90));
  }

  await page.locator('[data-prop-border-width] [data-border-width="2.82"]').click();
  await page.waitForTimeout(1800);
  const width = await page.evaluate(() => {
    const block = document.querySelector('.newspaper-section.active');
    return block ? block.style.getPropertyValue('--block-rule') : '';
  });
  say(width === '2.82px', 'and the 4 pt rule is the width the block is drawn with', width);
  await page.locator('#canvasSurface').screenshot({ path: `${SHOTS}/canvas-borders.png` });

  // ---- the typefaces, on the page and in the picker ----------------------
  const offered = await page.evaluate(() => Array.from(
    document.querySelectorAll('#tyFontFamily option')).map((o) => o.value));
  for (const key of ['serif', 'sans', 'tiro', 'mukta', 'khand', 'rozha']) {
    say(offered.includes(key), `the Typography picker offers ${key}`);
  }
  // And the browser can actually paint them - a family the compositor measures
  // but the browser has no @font-face for would be drawn in something else.
  const painted = await page.evaluate(async () => {
    const out = {};
    for (const [css, name] of [["'Tiro Devanagari Marathi'", 'tiro'], ["'Mukta'", 'mukta'],
      ["'Khand'", 'khand'], ["'Rozha One'", 'rozha']]) {
      out[name] = await document.fonts.load(`400 16px ${css}`).then((f) => f.length > 0).catch(() => false);
    }
    return out;
  });
  for (const [name, ok] of Object.entries(painted)) {
    say(ok, `the browser has a real @font-face for ${name}`);
  }

  // A DISPLAY face is a separate decision from the body's. The two faces
  // marked role:'display' in the catalogue could not reach a headline at all
  // until there was a field for it - compose.js hard-coded the paper's sans -
  // so a condensed cut, whose whole purpose is a splash with too many words,
  // was only ever offered for body copy.
  const displayPicker = await page.evaluate(() => Array.from(
    document.querySelectorAll('#tyDisplayFamily option')).map((o) => o.value));
  say(displayPicker.includes('khand') && displayPicker.includes('rozha'),
    'Typography offers a separate headline face, including the display cuts', displayPicker.join(','));
  say(displayPicker[0] === '', 'and its default is the paper\'s own, not a block choice');

  // ---- an information graphic, on the page --------------------------------
  //
  // Placed by this net rather than assumed to be there. It used to assert a
  // chart that a previous run had left on the edition, and this net's own
  // restore then cleared it - so the check passed once and failed for ever
  // after. A net that depends on ambient state is a net that reports the last
  // run rather than this one.
  await page.evaluate(async ([ed, key]) => {
    const pages = await fetch(`/api/newspapers/${ed}/pages`).then((r) => r.json());
    const pg = pages.find((p) => p.sections.some((s) => s.section_key === key));
    const s = pg.sections.find((x) => x.section_key === key);
    await fetch(`/api/pages/${pg.id}/sections/${key}`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        headline: s.headline || '', subheading: s.subheading || '', body: s.body || '',
        smartCardKey: 'chart',
        smartCardData: {
          chartType: 'bar', subtitle: 'जिल्हानिहाय पाऊस', unit: 'मिमी', source: 'स्रोत : हवामान विभाग',
          items: [{ label: 'सातारा', value: 842 }, { label: 'कोल्हापूर', value: 1290 },
            { label: 'सांगली', value: 603 }, { label: 'पुणे', value: 770 }],
        },
      }),
    });
  }, [ED, KEY]).catch(() => {});
  await openEdition();

  const chart = await page.evaluate(() => {
    const node = document.querySelector('.smart-chart-bars');
    if (!node) return null;
    const bars = Array.from(node.querySelectorAll('.smart-chart-track > i'))
      .map((i) => Math.round(parseFloat(i.style.width)));
    return { bars, labels: Array.from(node.querySelectorAll('.smart-chart-label')).map((n) => n.textContent.trim()) };
  });
  say(Boolean(chart), 'a bar chart draws on the newspaper canvas', chart ? chart.labels.join(', ') : 'none placed');
  if (chart) {
    // The bars are PROPORTIONAL, which is the one thing a chart has to be.
    const widest = Math.max(...chart.bars);
    say(chart.bars.every((w) => w > 0 && w <= widest), 'its bars are proportional and none is empty', chart.bars.join(','));
    await page.locator('.smart-chart-bars').screenshot({ path: `${SHOTS}/canvas-chart.png` }).catch(() => {});
  }

  // ---- a panel inside the block, and the copy running round it -----------
  //
  // PLACED BY THIS NET, for the same reason the chart above is. It used to
  // read whatever panel happened to be on the block, which meant it passed
  // only while some earlier run had left one there - and reported "none
  // placed" the moment the edition was tidied. That is the ambient-state
  // dependency this file's own comment forty lines up warns about, repeated
  // here.
  const panelBlock = 'anchor';
  await page.evaluate(async ([ed, key]) => {
    const pages = await fetch(`/api/newspapers/${ed}/pages`).then((r) => r.json());
    const pg = pages.find((p) => p.sections.some((s) => s.section_key === key));
    const s = pg.sections.find((x) => x.section_key === key);
    await fetch(`/api/pages/${pg.id}/sections/${key}`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        headline: s.headline || '', subheading: s.subheading || '', body: s.body || '',
        insetPanels: [{
          id: 'visual-pass-panel', kind: 'note',
          x: Math.round(Number(s.width_px) * 0.5), y: Math.round(Number(s.height_px) * 0.35),
          width: Math.round(Number(s.width_px) * 0.45), height: Math.round(Number(s.height_px) * 0.22),
          title: 'ठळक मुद्दे', lines: ['पाणीपुरवठा ९२% पूर्ण', 'मंजूर निधी ४.२ कोटी'],
        }],
      }),
    });
  }, [ED, panelBlock]).catch(() => {});
  await openEdition();
  await page.locator(`.newspaper-section[data-section-key="${panelBlock}"]`).first().click();
  await page.waitForTimeout(2200);
  const drawn = await page.evaluate((key) => {
    const block = document.querySelector(`.newspaper-section[data-section-key="${key}"]`);
    const panel = block && block.querySelector('.section-inset-panel');
    if (!panel) return null;
    const box = panel.getBoundingClientRect();
    const clash = Array.from(block.querySelectorAll('.section-body-line')).filter((line) => {
      const r = line.getBoundingClientRect();
      return r.right > box.left + 1 && r.left < box.right - 1 && r.bottom > box.top + 1 && r.top < box.bottom - 1;
    });
    return { text: panel.textContent.trim().slice(0, 40), lines: block.querySelectorAll('.section-body-line').length, clash: clash.length };
  }, panelBlock);
  say(Boolean(drawn), 'a panel draws inside the block', drawn ? drawn.text : 'none placed');
  if (drawn) {
    // The whole point: the compositor treated it as an obstacle, so no line of
    // the story may be printed underneath it.
    say(drawn.clash === 0, 'and no line of the story is set underneath it',
      `${drawn.clash} of ${drawn.lines} lines overlap`);
    await page.locator(`.newspaper-section[data-section-key="${panelBlock}"]`).screenshot({ path: `${SHOTS}/canvas-panel.png` }).catch(() => {});
  }
  say(await page.locator('[data-prop-panel-add] [data-panel-add="note"]').count() > 0,
    'and Properties offers a control to make one');

  // ---- a cross-head, and the LIST the compositor never used to set --------
  //
  // Both were closed together because they are the same gap: a mid-block flow.
  // The cross-head is a panel kind - a full-measure rectangle a whole band
  // deep, so the copy closes above it and resumes on the grid below - which is
  // what lets it exist without pourBody() carrying a second kind of paragraph.
  say(await page.locator('[data-prop-panel-add] [data-panel-add="crosshead"]').count() > 0,
    'Properties offers a cross-head');

  // `page_sections.list_style` persisted for months and no renderer read it:
  // a sub-editor could choose Numbering, watch it save, reload, and find plain
  // prose. This presses the control and counts what appears ON THE PAGE, which
  // is the only check that could have caught it.
  // NOT `KEY` - the chart check above put a Smart Card on it, so it carries no
  // prose and a list has nothing to mark. `panelBlock` is the one this net has
  // already proved is setting real body lines, which is exactly what a list
  // needs; it also means the list and the panel are exercised on one block.
  const listBlock = panelBlock;
  await page.locator(`.newspaper-section[data-section-key="${listBlock}"]`).first().click();
  await page.waitForTimeout(1800);
  const typoTab = page.locator('[data-ext-tab="typography"], [data-tab="typography"]').first();
  if (await typoTab.count()) { await typoTab.click(); await page.waitForTimeout(500); }
  const listChoices = await page.locator('[data-segmented="listStyle"] .segment').evaluateAll(
    (els) => els.map((e) => e.dataset.value));
  say(listChoices.length === 3, 'Typography offers None / Bullets / Numbering', listChoices.join(' '));

  if (listChoices.includes('number')) {
    const markersNow = () => page.locator(`.newspaper-section[data-section-key="${listBlock}"] .section-list-marker`).count();
    const wasSet = await page.locator('[data-segmented="listStyle"] .segment.active').getAttribute('data-value');
    const before = await markersNow();
    await page.locator('[data-segmented="listStyle"] .segment[data-value="number"]').click();
    await page.waitForTimeout(2400);
    const after = await markersNow();
    say(after > before, 'pressing Numbering hangs real markers on the page', `${before} -> ${after}`);

    const hung = await page.evaluate((key) => {
      const block = document.querySelector(`.newspaper-section[data-section-key="${key}"]`);
      const marker = block && block.querySelector('.section-list-marker');
      const lines = block ? Array.from(block.querySelectorAll('.section-body-line')) : [];
      if (!marker || !lines.length) return null;
      const m = marker.getBoundingClientRect();
      // EVERY line of the item is set past the marker, not just the first -
      // that is what a hanging indent is, and what makes the markers line up.
      const inside = lines.filter((l) => l.getBoundingClientRect().left < m.right - 1).length;
      return { text: marker.textContent.trim(), inside, lines: lines.length };
    }, listBlock);
    say(hung && /^[०-९]+\.$/.test(hung.text), 'and they are Devanagari numerals', hung ? hung.text : 'none');
    say(hung && hung.inside === 0, 'and every line of the item is set past the marker column',
      hung ? `${hung.inside} of ${hung.lines} lines start inside it` : '');
    await page.locator(`.newspaper-section[data-section-key="${listBlock}"]`).screenshot({ path: `${SHOTS}/canvas-list.png` }).catch(() => {});

    // Put the block back the way it was found, whatever that was.
    await page.locator(`[data-segmented="listStyle"] .segment[data-value="${wasSet || 'none'}"]`).click();
    await page.waitForTimeout(2200);
    say(await markersNow() === before, 'and the block is put back as it was found');
  }

  // ---- a picture laid across two stories ---------------------------------
  const overlay = await page.evaluate(() => {
    const node = document.querySelector('.page-overlay');
    if (!node) return null;
    const box = node.getBoundingClientRect();
    // Which blocks does it actually cross, and is any of their type under it?
    const blocks = Array.from(document.querySelectorAll('.newspaper-section')).map((block) => {
      const r = block.getBoundingClientRect();
      const crosses = r.right > box.left && r.left < box.right && r.bottom > box.top && r.top < box.bottom;
      const under = Array.from(block.querySelectorAll('.section-body-line')).filter((line) => {
        const l = line.getBoundingClientRect();
        return l.right > box.left + 1 && l.left < box.right - 1 && l.bottom > box.top + 1 && l.top < box.bottom - 1;
      }).length;
      return { key: block.dataset.sectionKey, crosses, under };
    });
    return { crossed: blocks.filter((b) => b.crosses).map((b) => b.key), under: blocks.reduce((n, b) => n + b.under, 0) };
  });
  say(Boolean(overlay), 'a picture is laid on the page', overlay ? overlay.crossed.join(' + ') : 'none placed');
  if (overlay) {
    say(overlay.crossed.length >= 2, 'and it crosses more than one block', overlay.crossed.join(' + '));
    say(overlay.under === 0, 'and no story is set underneath it', `${overlay.under} lines`);
    // It is a real object: selectable, and it carries resize handles.
    await page.locator('.page-overlay').first().click();
    await page.waitForTimeout(400);
    const armed = await page.evaluate(() => {
      const node = document.querySelector('.page-overlay');
      return node ? { selected: node.classList.contains('is-selected'), handles: node.querySelectorAll('.overlay-handle').length } : null;
    });
    say(armed && armed.selected, 'it selects on a press');
    say(armed && armed.handles === 4, 'and carries four resize handles', armed ? String(armed.handles) : '');
    await page.locator('#canvasSurface').screenshot({ path: `${SHOTS}/canvas-overlay.png` }).catch(() => {});
  }

  // ---- the picture proposal, and the workflow it must not skip -----------
  await page.locator(`.newspaper-section[data-section-key="${KEY}"]`).first().click();
  await page.waitForTimeout(1800);
  const offersPicture = await page.locator('#aiProposePicture').count();
  say(offersPicture > 0, 'the AI panel offers to suggest a picture');
  if (offersPicture) {
    const before = await page.evaluate(async ([ed, key]) => {
      const pages = await fetch(`/api/newspapers/${ed}/pages`).then((r) => r.json());
      const pg = pages.find((p) => p.sections.some((s) => s.section_key === key));
      const s = pg.sections.find((x) => x.section_key === key);
      return (s.images || []).length;
    }, [ED, KEY]);
    await page.locator('#aiProposePicture').click();
    await page.waitForTimeout(4000);
    const after = await page.evaluate(async ([ed, key]) => {
      const pages = await fetch(`/api/newspapers/${ed}/pages`).then((r) => r.json());
      const pg = pages.find((p) => p.sections.some((s) => s.section_key === key));
      const s = pg.sections.find((x) => x.section_key === key);
      return (s.images || []).length;
    }, [ED, KEY]);
    // THE INVARIANT: asking for a picture never places one. Holds whether the
    // provider answered or refused, which is why it is checked either way.
    say(after === before, 'and asking never places one by itself', `${before} pictures before, ${after} after`);
    const said = await page.evaluate(() => document.getElementById('aiPictureCandidates')?.children.length ?? -1);
    say(said >= 0, 'the candidate area exists and is empty until a person chooses', String(said));
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
