// EDITING THE STORY WHERE IT PRINTS - the caret, the selection, the gestures.
//
//   node tests/browser/body-editing.browser.js [editionId] [sectionKey]
//
// WHY THIS EXISTS. The desk's report was four sentences and every one of them
// was true:
//
//   "double click on editor the font size changing automatically"
//   "after double clicking on body some time it shows body copy some time not"
//   "body inside editor is not editable"
//   "i select a text and try to change the font but I can change only those
//    option sizes above, it also should have drop down"
//
// None of it could be reproduced by reading code. A double click really did
// focus Quill, a drag really did call setSelection(), typing really did reach
// the copy - and driving the running app and photographing the page showed
// what was actually happening:
//
//   * the composed page drew NO CARET and NO SELECTION at all, so a desk was
//     typing at a cursor that did not exist and marking words it could not
//     see (measured: Quill reported 12 characters selected, the screenshot
//     showed no highlight anywhere);
//   * the box labelled "Body copy" collapsed to height 0 on that double click,
//     so the writing surface vanished and the column jumped ~340px;
//   * the size <select> above the page silently retargets with the selection,
//     so double-clicking a headline moved it from 6.4 to 24 - editor BLOCK
//     pixels, a unit no printer sets in - with only a tooltip to say which
//     object it now meant;
//   * the only size control for a marked run was four fixed buttons.
//
// So this net presses the gestures and checks the two things a screenshot
// would: WHERE the caret is, and WHAT is highlighted. It resets the block it
// drives and puts it back afterwards.

const { chromium } = require('playwright-core');
const { DESK_EMAIL, DESK_PASSWORD } = require('./helpers/desk-login');

const CHROME = process.env.CHROME_PATH || '/usr/bin/google-chrome';
const BASE = process.env.BASE_URL || 'http://localhost:3000';
const ED = Number(process.argv[2] || 40294);
const KEY = process.argv[3] || 'anchor';

let pass = 0;
let ran = 0;
// Reachable from the crash handler: a run that dies half way must not leave a
// real block carrying its test copy.
let putBack = async () => {};
const say = (ok, what, detail = '') => {
  ran += 1;
  if (ok) pass += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${what}${detail ? ' :: ' + String(detail).slice(0, 140) : ''}`);
};

(async () => {
  const browser = await chromium.launch({ executablePath: CHROME, args: ['--no-sandbox'] });
  // Tall on purpose: the Block Editor page is ~880px and the body's own frame
  // is 630 of them, so on a short viewport half the story is below the fold
  // and a click aimed at it lands outside the window entirely. That is a
  // property of the harness, not of the product - but it cost an hour of
  // wrong diagnosis, so it is written down here.
  const page = await (await browser.newContext({ viewport: { width: 1700, height: 2200 } })).newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message.slice(0, 180)}`));
  page.on('console', (m) => m.type() === 'error' && errors.push(`console: ${m.text().slice(0, 180)}`));

  async function openEdition() {
    await page.goto(BASE);
    await page.waitForTimeout(900);
    if (await page.locator('#email').count()) {
      await page.fill('#email', DESK_EMAIL);
      await page.fill('#password', DESK_PASSWORD);
      await page.click('#loginBtn');
    }
    await page.waitForSelector('.edition-row', { timeout: 20000 });
    const when = await page.evaluate((ed) => fetch(`/api/newspapers/${ed}`).then((r) => r.json())
      .then((n) => String(n.publication_date).slice(0, 10)), ED);
    await page.fill('#editionSearch', when);
    await page.waitForTimeout(700);
    await page.locator(`.edition-row[data-edition-id="${ED}"] .edition-open`).click();
    await page.waitForSelector('#canvasSurface', { timeout: 25000 });
    await page.waitForTimeout(2500);
    // The block may not be on page one - `centre-column`, the block the desk
    // reported the headline fault on, is on page two. Walk the page pills
    // until the canvas is showing it.
    for (const pill of await page.locator('.page-pill').all()) {
      if (await page.locator(`.newspaper-section[data-section-key="${KEY}"]`).count()) break;
      await pill.click();
      await page.waitForTimeout(2200);
    }
    await page.locator(`.newspaper-section[data-section-key="${KEY}"]`).first().click();
    await page.waitForTimeout(2200);
    await page.evaluate(() => document.getElementById('edFramePage')?.scrollIntoView({ block: 'center' }));
    await page.waitForTimeout(500);
  }

  // What this run borrowed, so it can be given back. This net writes into a
  // REAL block on a REAL edition, and an earlier one that did not restore left
  // its test copy standing on five blocks of the edition a desk was looking at.
  let borrowed = null;
  const keepBlock = async () => {
    borrowed = await page.evaluate(async ([ed, key]) => {
      const pages = await fetch(`/api/newspapers/${ed}/pages`).then((r) => r.json());
      const pg = pages.find((p) => p.sections.some((s) => s.section_key === key));
      const s = pg.sections.find((x) => x.section_key === key);
      return { pageId: pg.id, fields: { headline: s.headline || '', subheading: s.subheading || '', body: s.body || '' } };
    }, [ED, KEY]);
  };
  // AND IT HAS TO WIN THE RACE WITH AUTOSAVE. This net types into the block,
  // so a save can still be in flight when the restore lands - and the block is
  // then left carrying the test copy, or blank. Measured: a scratch edition's
  // anchor came back with its headline restored and an empty body. So the
  // restore is written, read back, and written again until the copy is really
  // the copy this run borrowed.
  putBack = async () => giveBlockBack();
  const giveBlockBack = async () => {
    if (!borrowed) return true;
    for (let attempt = 0; attempt < 4; attempt += 1) {
      await page.waitForTimeout(900);
      const back = await page.evaluate(async ([ed, key, kept]) => {
        await fetch(`/api/pages/${kept.pageId}/sections/${key}`, {
          method: 'PUT', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(kept.fields),
        });
        const pages = await fetch(`/api/newspapers/${ed}/pages`).then((r) => r.json());
        for (const p of pages) {
          const s = p.sections.find((x) => x.section_key === key);
          if (s) return (s.body || '') === kept.fields.body && (s.headline || '') === kept.fields.headline;
        }
        return false;
      }, [ED, KEY, borrowed]);
      if (back) return true;
    }
    return false;
  };

  const q = () => page.evaluate(() => {
    const Q = window.Quill?.find(document.querySelector('#edQuill'));
    const r = Q ? Q.getSelection() : null;
    return { index: r ? r.index : null, length: r ? r.length : null,
      text: r && r.length ? Q.getText(r.index, r.length) : '' };
  });

  const drawn = () => page.evaluate(() => {
    const caret = document.querySelector('.body-caret');
    const bands = [...document.querySelectorAll('.body-selection-band')];
    const box = caret?.getBoundingClientRect();
    return {
      caret: Boolean(caret),
      caretAt: box ? { x: Math.round(box.left), y: Math.round(box.top), h: Math.round(box.height) } : null,
      bands: bands.length,
      bandWidth: Math.round(bands.reduce((sum, b) => sum + b.getBoundingClientRect().width, 0)),
    };
  });

  // A CLICK POINT IS COMPUTED AFTER SCROLLING, AND THE LINE IS BROUGHT TO THE
  // MIDDLE FIRST.
  //
  // `getBoundingClientRect()` is viewport-relative and `page.mouse.*` takes raw
  // viewport coordinates, so a line below the fold is pressed at a point
  // outside the window: the press lands on nothing and it reads as "the story
  // will not open" when the product is fine. This net already scrolls the page
  // once at setup, and that was enough only while nothing moved afterwards -
  // section 10 scrolls the display band to centre, so by the time section 11
  // asked for line 4 the story had moved out from under it.
  //
  // The scroll happens BEFORE the measurement and before the press, so the
  // rect, the click and the caret `drawn()` reads back are all in one frame.
  const lineAt = async (i) => {
    await page.evaluate((k) => {
      const nodes = [...document.querySelectorAll('#edCanonicalContent .section-body-line')];
      nodes[Math.min(k, nodes.length - 1)]?.scrollIntoView({ block: 'center' });
    }, i);
    await page.waitForTimeout(250);
    return page.evaluate((k) => {
      const nodes = [...document.querySelectorAll('#edCanonicalContent .section-body-line')];
      const node = nodes[Math.min(k, nodes.length - 1)];
      const r = node.getBoundingClientRect();
      return { x: r.left + 24, y: r.top + r.height / 2, left: r.left, right: r.right,
        top: r.top, bottom: r.bottom, at: Number(node.dataset.at) };
    }, i);
  };

  await openEdition();
  await keepBlock();

  // ===================== 1. the composed lines carry their own offsets =====
  {
    const tagged = await page.evaluate(() => {
      const nodes = [...document.querySelectorAll('#edCanonicalContent .section-body-line')];
      return { total: nodes.length, withAt: nodes.filter((n) => n.dataset.at !== undefined).length };
    });
    say(tagged.total > 0 && tagged.withAt === tagged.total,
      'every composed body line carries the compositor’s own source offset', JSON.stringify(tagged));
  }

  // ===================== 2. a double click puts a REAL caret on the page ===
  const line = await lineAt(3);
  await page.mouse.dblclick(line.x, line.y);
  await page.waitForTimeout(900);
  {
    const shown = await drawn();
    const sel = await q();
    say(shown.caret, 'double-clicking the story draws a caret on the page');
    say(shown.caretAt && Math.abs(shown.caretAt.y + shown.caretAt.h / 2 - line.y) < 24,
      'and it stands on the line that was clicked', JSON.stringify({ caret: shown.caretAt, wanted: Math.round(line.y) }));
    // A double click on text takes the WORD under it - that is the gesture in
    // every editor, and it is what the first press (which placed the caret)
    // plus the second (which found the body already open) add up to here.
    say(sel.index !== null && sel.length > 0 && !/\s/.test(sel.text),
      'and it takes the word under the pointer, like any editor', JSON.stringify(sel));
  }

  // ===================== 3. the writing box does NOT vanish ================
  {
    const box = await page.evaluate(() => {
      const ws = document.getElementById('edWritingSurface');
      return { height: Math.round(ws.getBoundingClientRect().height),
        label: document.getElementById('edWritingLabel')?.textContent || '' };
    });
    say(box.height > 100, 'the body writing box stays on screen while the page is being typed into', JSON.stringify(box));
    say(/typing on the page/i.test(box.label), 'and says which of the story’s two views has the caret', box.label);
  }

  // ===================== 4. typing lands where the caret is ================
  {
    const before = await q();
    await page.keyboard.type('QQ');
    await page.waitForTimeout(1200);
    const landed = await page.evaluate((at) => {
      const Q = window.Quill.find(document.querySelector('#edQuill'));
      return { atCaret: Q.getText(at, 2), onPage: [...document.querySelectorAll('#edCanonicalContent .section-body-line')]
        .map((n) => n.textContent).join('').includes('QQ') };
    }, before.index);
    say(landed.atCaret === 'QQ', 'a keystroke lands exactly at the caret, not at the start of the story', JSON.stringify(landed));
    say(landed.onPage, 'and appears on the composed page');
    await page.keyboard.press('Backspace');
    await page.keyboard.press('Backspace');
    await page.waitForTimeout(900);
  }

  // ===================== 5. a single click MOVES the caret ==================
  {
    const first = await q();
    const other = await lineAt(6);
    await page.mouse.click(other.x + 120, other.y);
    await page.waitForTimeout(600);
    const moved = await q();
    say(moved.index !== null && moved.index !== first.index,
      'a single click inside the open story moves the caret', JSON.stringify({ from: first.index, to: moved.index }));
    const shown = await drawn();
    say(shown.caret && shown.caretAt && Math.abs(shown.caretAt.y + shown.caretAt.h / 2 - other.y) < 24,
      'and the drawn caret follows it', JSON.stringify(shown.caretAt));
  }

  // ===================== 6. a drag selects, and the page SHOWS it ===========
  {
    const row = await lineAt(4);
    await page.mouse.move(row.x, row.y);
    await page.mouse.down();
    await page.mouse.move(row.x + 240, row.y, { steps: 12 });
    await page.mouse.up();
    await page.waitForTimeout(700);
    const sel = await q();
    const shown = await drawn();
    say(sel.length > 3, 'a drag across the story selects a range', JSON.stringify(sel));
    say(shown.bands > 0 && shown.bandWidth > 60,
      'and the page draws the selection - the desk can see what it marked', JSON.stringify(shown));
    say(!/�/.test(sel.text) && sel.text === sel.text.normalize(),
      'the selection is whole aksharas', JSON.stringify(sel.text));
  }

  // ===================== 7. double click takes a word, triple a paragraph ===
  {
    const row = await lineAt(5);
    await page.mouse.dblclick(row.x + 60, row.y);
    await page.waitForTimeout(600);
    const word = await q();
    say(word.length > 0 && !/\s/.test(word.text),
      'a second double click takes the word under the pointer', JSON.stringify(word));
    await page.mouse.click(row.x + 60, row.y, { clickCount: 3 });
    await page.waitForTimeout(700);
    const para = await q();
    say(para.length > word.length && !/\n/.test(para.text),
      'and a third takes the whole paragraph', JSON.stringify({ word: word.length, paragraph: para.length }));
  }

  // ===================== 8. the size controls, in points, each named ========
  {
    const controls = await page.evaluate(() => ({
      objectTarget: document.getElementById('edStorySizeTarget')?.textContent,
      objectSize: document.getElementById('edStorySize')?.selectedOptions[0]?.textContent,
      selectionSize: document.getElementById('edQuillSizeSelect')?.selectedOptions[0]?.textContent,
      rungs: document.getElementById('edQuillSizeSelect')?.options.length || 0,
      objectRungs: document.getElementById('edStorySize')?.options.length || 0,
    }));
    say(/pt$|pt /.test(controls.objectSize || ''), 'the object’s size is offered in points', controls.objectSize);
    say(controls.rungs > 20, 'the selection’s size is a dropdown, not four fixed steps', `${controls.rungs} rungs`);
    say(controls.objectRungs > 20 && controls.objectTarget === 'Body',
      'and the object control names the object it acts on', JSON.stringify(controls));
  }

  // ===================== 9. it retargets VISIBLY, not silently ==============
  {
    const before = await page.evaluate(() => ({
      target: document.getElementById('edStorySizeTarget')?.textContent,
      size: document.getElementById('edStorySize')?.value,
    }));
    const head = await page.evaluate(() => {
      const r = document.querySelector('#edCanonicalContent .section-headline').getBoundingClientRect();
      return { x: r.left + 40, y: r.top + r.height / 2 };
    });
    await page.mouse.dblclick(head.x, head.y);
    await page.waitForTimeout(1000);
    const after = await page.evaluate(() => ({
      target: document.getElementById('edStorySizeTarget')?.textContent,
      size: document.getElementById('edStorySize')?.value,
    }));
    say(after.size !== before.size && after.target === 'Headline' && before.target === 'Body',
      'selecting the headline retargets the size control AND says so on screen',
      JSON.stringify({ before, after }));
    say(!(await drawn()).caret, 'and the body caret is taken off the page when the body is left');
  }

  // ===================== 10. a size mark on the selected words ==============
  {
    const row = await lineAt(4);
    await page.mouse.dblclick(row.x, row.y);
    await page.waitForTimeout(800);
    await page.mouse.move(row.x, row.y);
    await page.mouse.down();
    await page.mouse.move(row.x + 200, row.y, { steps: 10 });
    await page.mouse.up();
    await page.waitForTimeout(600);
    const value = await page.evaluate(() => [...document.getElementById('edQuillSizeSelect').options]
      .find((o) => o.textContent.startsWith('14 pt'))?.value);
    await page.locator('#edQuillSize .ed-quill-size-select').selectOption(value);
    await page.waitForTimeout(1400);
    const stored = await page.evaluate(([ed, key]) => fetch(`/api/newspapers/${ed}/pages`).then((r) => r.json())
      .then((pages) => {
        for (const p of pages) {
          const s = p.sections.find((x) => x.section_key === key);
          if (s) return s.body || '';
        }
        return '';
      }), [ED, KEY]);
    const px = String(parseFloat(value));
    say(stored.includes(`data-sahas-size="${px}"`),
      'a size chosen from the dropdown is stored on the marked words, in block pixels',
      `${value} -> ${(stored.match(/data-sahas-size="[^"]*"/g) || []).slice(0, 2)}`);
  }

  // ===================== 10b. the headline opens AS IT IS SET ==============
  //
  // The desk's report: "I tested सौरऊर्जा प्रकल्पाचे भूमिपूजन - after double
  // clicking this headline in editor it changes". It did: photographed on a
  // real 229x480 block, the last word vanished the instant the frame opened.
  // The row asks for 21px, fitDisplayFlow() SETS at 20, and the editing frame
  // was styled from the request - 5% wide of its own measure, which on a
  // headline that fills its line is one word pushed onto a second line and cut
  // off by the frame's own overflow. Nothing was lost from the copy; it just
  // could not be seen, which is worse.
  for (const part of ['headline', 'subheading']) {
    const shown = await page.evaluate((flow) => {
      const line = document.querySelector(`#edCanonicalContent .section-${flow === 'headline' ? 'headline' : 'subheading'}`);
      if (!line) return null;
      const box = line.getBoundingClientRect();
      return { text: line.textContent, size: line.style.fontSize,
        x: Math.round(box.left), y: Math.round(box.top) };
    }, part);
    if (!shown) { say(true, `this block has no ${part} to open`, ''); continue; }
    // Bring the band into view BEFORE taking its coordinates. `mouse.dblclick`
    // takes VIEWPORT coordinates, and a band below the fold gives a y outside
    // the window, so the press lands on nothing and the frame never opens -
    // which reads as "the subheading opened empty" when the product is fine.
    // A desk scrolls to what they are about to double-click; so does this.
    const point = await page.evaluate((flow) => {
      const el = document.querySelector(`#edCanonicalContent .section-${flow === 'headline' ? 'headline' : 'subheading'}`);
      el.scrollIntoView({ block: 'center' });
      const r = el.getBoundingClientRect();
      return { x: r.left + 24, y: r.top + r.height / 2 };
    }, part);
    await page.waitForTimeout(400);
    await page.mouse.dblclick(point.x, point.y);
    await page.waitForTimeout(1300);
    const open = await page.evaluate((flow) => {
      const frame = document.getElementById(flow === 'headline' ? 'edHeadlineFrame' : 'edSubheadingFrame');
      const style = getComputedStyle(frame);
      return { text: frame.textContent, size: style.fontSize, align: style.textAlign,
        clipped: frame.scrollHeight > frame.clientHeight + 1 };
    }, part);
    say(open.text === shown.text, `the ${part} opens with every word it had`,
      JSON.stringify({ was: shown.text, now: open.text }));
    say(Math.abs(parseFloat(open.size) * (await page.evaluate(() => {
      const p = document.getElementById('edFramePage');
      return (Number(document.querySelector('.frame-canonical-content').style.width.replace('px', ''))) / p.getBoundingClientRect().width;
    })) - parseFloat(shown.size)) < 0.25,
      `and set in the size the compositor RESOLVED, not the size the row asked for`,
      JSON.stringify({ composed: shown.size, editing: open.size }));
    say(!open.clipped, `and nothing is cut off by the frame it is editing in`);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(700);
    const back = await page.evaluate((flow) => {
      const line = document.querySelector(`#edCanonicalContent .section-${flow === 'headline' ? 'headline' : 'subheading'}`);
      const box = line.getBoundingClientRect();
      return { text: line.textContent, size: line.style.fontSize, x: Math.round(box.left), y: Math.round(box.top) };
    }, part);
    say(back.text === shown.text && back.size === shown.size,
      `and it is put back exactly as it was when the edit closes`,
      JSON.stringify({ was: shown, now: back }));
  }

  // ===================== 11. Escape leaves the story, by keyboard ==========
  {
    const row = await lineAt(4);
    await page.mouse.dblclick(row.x, row.y);
    await page.waitForTimeout(800);
    say((await drawn()).caret, 'the story is open again');
    await page.keyboard.press('Escape');
    await page.waitForTimeout(800);
    const after = await page.evaluate(() => ({
      caret: Boolean(document.querySelector('.body-caret')),
      editing: Boolean(document.querySelector('#edBodyFrame.is-direct-body-editing')),
      label: document.getElementById('edWritingLabel')?.textContent || '',
    }));
    say(!after.caret && !after.editing && !/typing on the page/i.test(after.label),
      'Escape leaves the story, the way it already left a headline', JSON.stringify(after));
  }

  // ===================== 12. an UNWRITTEN block still shows a caret =========
  //
  // Writing a block from nothing is the commonest job there is, and an empty
  // block composes to no lines at all - so there was nothing for the caret to
  // be measured against and none was drawn.
  {
    await page.evaluate(async ([key, kept]) => {
      await fetch(`/api/pages/${kept.pageId}/sections/${key}`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ headline: '', subheading: '', body: '', status: 'empty' }),
      });
    }, [KEY, borrowed]);
    await openEdition();
    const frame = await page.evaluate(() => {
      const r = document.getElementById('edBodyFrame').getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + 20, top: Math.round(r.top), left: Math.round(r.left) };
    });
    await page.mouse.dblclick(frame.x, frame.y);
    await page.waitForTimeout(1000);
    const shown = await drawn();
    say(shown.caret, 'an unwritten block draws a caret where its first word will be set');
    // Read the frame AGAIN, now, rather than comparing the caret against a
    // rectangle captured before the double click. Both are viewport
    // coordinates, so a few pixels of scroll between the two measurements is
    // enough to fail a 6px tolerance - which is what happened the moment the
    // workspace stopped letting the browser re-anchor the page under it.
    const frameNow = await page.evaluate(() => {
      const r = document.getElementById('edBodyFrame').getBoundingClientRect();
      return { top: Math.round(r.top), left: Math.round(r.left) };
    });
    say(shown.caretAt && Math.abs(shown.caretAt.x - frameNow.left) < 6 && Math.abs(shown.caretAt.y - frameNow.top) < 6,
      'and it stands at the head of the body frame', JSON.stringify({ caret: shown.caretAt, frame: frameNow }));
    await page.keyboard.type('AB');
    await page.waitForTimeout(1400);
    say(await page.evaluate(() => [...document.querySelectorAll('#edCanonicalContent .section-body-line')]
      .map((n) => n.textContent).join('').includes('AB')),
      'and typing on an unwritten block reaches the page');
  }

  say(await giveBlockBack(), 'the block this run borrowed is put back exactly as it was found');

  console.log(`\n${pass}/${ran} passed`);
  console.log('ERRORS:', errors.length ? JSON.stringify(errors) : '(none)');
  await browser.close();
  process.exit(pass === ran && !errors.length ? 0 : 1);
})().catch(async (error) => {
  console.log(`\n${pass}/${ran} passed before it crashed - LATER CHECKS DID NOT RUN`);
  console.error(error);
  await putBack().catch(() => {});
  process.exit(1);
});
