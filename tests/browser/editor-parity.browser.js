// The Block Editor and the newspaper canvas are ONE block, and every control
// acts on both.
//
//   node tests/browser/editor-parity.browser.js [editionId] [sectionKey]
//
// WHY THIS EXISTS. The desk's report was "in editor and in layout different
// things are showing, and the editor is not editable". Neither could be
// reproduced by reading code: the two surfaces already draw from the same
// composeSection() call, and the fields already patch the same draft. It took
// driving the running app to find what was actually true - an EMPTY block
// composes to nothing, so the Block Editor page was a blank white rectangle
// with no prompt, and because a band with no lines has no box, the headline
// and deck frames were 0x0 and could not be clicked at all. The block a desk
// opens most often was the one block that could not be written on.
//
// So this net does two things on every control it presses: it checks the
// control DID what it says, and it compares the newspaper canvas against the
// Block Editor's page line for line. Both, or a control that quietly writes to
// one surface passes.
//
// It resets the block it drives first, so it can be run repeatedly.

const { chromium } = require('playwright-core');

const CHROME = process.env.CHROME_PATH || '/usr/bin/google-chrome';
const BASE = process.env.BASE_URL || 'http://localhost:3000';
const ED = Number(process.argv[2] || 40294);
const KEY = process.argv[3] || 'anchor';

let pass = 0;
let ran = 0;
const say = (ok, what, detail = '') => {
  ran += 1;
  if (ok) pass += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${what}${detail ? ' :: ' + String(detail).slice(0, 120) : ''}`);
};

(async () => {
  const browser = await chromium.launch({ executablePath: CHROME, args: ['--no-sandbox'] });
  const page = await (await browser.newContext({ viewport: { width: 1700, height: 1300 } })).newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message.slice(0, 180)}`));
  page.on('console', (m) => m.type() === 'error' && errors.push(`console: ${m.text().slice(0, 180)}`));

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
    await page.waitForTimeout(2500);
  }

  // A repeatable starting point. The marks a previous run left behind are the
  // reason this exists: a test that presses "bold" on an already-bold headline
  // reads as a failure that is entirely its own doing.
  async function resetBlock(fields) {
    await page.evaluate(async ([ed, key, patch]) => {
      const pages = await fetch(`/api/newspapers/${ed}/pages`).then((r) => r.json());
      const pg = pages.find((p) => p.sections.some((s) => s.section_key === key));
      const section = pg.sections.find((s) => s.section_key === key);
      await fetch(`/api/pages/${pg.id}/sections/${key}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      });
      // And the PICTURE. Bigger/Smaller walk it towards their clamps, so a run
      // that did not put it back left the next run pressing "Smaller" on a
      // picture already at the 20px floor - a failure entirely of the test's
      // own making.
      const images = await fetch(`/api/pages/${pg.id}/sections/${key}/images`).then((r) => r.json());
      for (const image of images) {
        await fetch(`/api/pages/${pg.id}/sections/${key}/images/${image.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            x: Math.round(Number(section.width_px) * 0.55),
            y: Math.round(Number(section.height_px) * 0.35),
            width: Math.round(Number(section.width_px) * 0.35),
            height: Math.round(Number(section.height_px) * 0.22),
          }),
        });
      }
    }, [ED, KEY, fields]);
  }

  const snap = () => page.evaluate(([key]) => {
    const lines = (root) => (root ? [...root.querySelectorAll('.section-composed')].map((s) => `${s.className
      .replace('section-composed ', '').trim()}|${Math.round(parseFloat(s.style.left) || 0)},${Math
      .round(parseFloat(s.style.top) || 0)},${Math.round(parseFloat(s.style.width) || 0)}|${s.style.fontSize}|${s.innerHTML}`) : null);
    const canvas = document.querySelector(`.newspaper-section[data-section-key="${key}"]`);
    const editor = document.getElementById('edCanonicalContent');
    const pic = canvas?.querySelector('img');
    const box = pic ? pic.parentElement.getBoundingClientRect() : null;
    const ePic = document.querySelector('#edFramePictures img');
    const only = (ls, re) => (ls || []).filter((l) => re.test(l)).join('');
    const c = lines(canvas);
    return {
      c, e: lines(editor),
      head: only(c, /headline/), body: only(c, /body/),
      // The MARKS in the body, not its line breaks. A larger headline
      // legitimately re-flows the copy under it, so comparing composed body
      // lines would call every display-size change a stray body edit; what
      // must not change is which marks the body carries.
      bodyMarks: (only(c, /body/).match(/<(\w+)[^>]*>/g) || [])
        .map((t) => t.replace(/\s+/g, ' ')).sort().join(','),
      ground: canvas ? getComputedStyle(canvas).backgroundColor : null,
      border: canvas ? getComputedStyle(canvas).borderTopStyle : null,
      pic: box ? {
        x: Math.round(box.x), y: Math.round(box.y), w: Math.round(box.width), h: Math.round(box.height),
        src: pic.getAttribute('src'), fit: getComputedStyle(pic).objectFit, tr: getComputedStyle(pic).transform,
      } : null,
      ePicSrc: ePic ? ePic.getAttribute('src') : null,
      reverse: Boolean(canvas?.querySelector('.section-headline-reverse')),
      columns: [...document.querySelectorAll('[data-prop-columns] [data-columns]')]
        .filter((b) => b.classList.contains('active')).map((b) => b.dataset.columns || 'auto')[0] || null,
      fitLocked: [...document.querySelectorAll('[data-picture-fit]')].filter((b) => b.disabled)
        .map((b) => b.dataset.pictureFit),
      prompts: [...document.querySelectorAll('#edFramePlaceholders .frame-placeholder')].map((e) => e.textContent),
    };
  }, [KEY]);

  const parity = (s, what) => {
    if (!s.c || !s.e) return say(false, `${what} — both surfaces present`);
    const n = Math.max(s.c.length, s.e.length);
    const bad = [];
    for (let i = 0; i < n; i += 1) if (s.c[i] !== s.e[i]) bad.push(i);
    const picOk = (!s.pic && !s.ePicSrc) || (s.pic && s.pic.src === s.ePicSrc);
    return say(bad.length === 0 && picOk, `  ↳ ${what} — layout and Block Editor identical`,
      bad.length ? `${bad.length}/${n} lines differ, first at ${bad[0]}` : `${n} lines${s.pic ? ' + picture' : ''}`);
  };

  const settle = (ms = 1400) => page.waitForTimeout(ms);
  const show = async (sel) => {
    const l = page.locator(sel).first();
    if (!(await l.count())) return null;
    await l.scrollIntoViewIfNeeded().catch(() => {});
    // The dock re-renders on every draft change, so the thing just scrolled to
    // can still be settling when the click is dispatched.
    await page.waitForTimeout(250);
    return l;
  };
  // A direct body edit holds the page's own frame; leaving it is what a desk
  // does before reaching for anything else, and it is what makes the next
  // click land where it was aimed.
  const leaveBodyEdit = async () => {
    await page.keyboard.press('Escape').catch(() => {});
    await page.locator(`.newspaper-section[data-section-key="${KEY}"]`).first().click().catch(() => {});
    await page.waitForTimeout(900);
  };
  const selectBlock = async () => {
    await page.locator(`.newspaper-section[data-section-key="${KEY}"]`).first().click();
    await settle(1200);
  };
  // Focused rather than clicked. The dock is ~2900px tall and re-renders on
  // every draft change, so a field 800px below the fold moves between the
  // scroll and the click; focusing is what Tab does anyway, and the app binds
  // `focusin` precisely so that keyboard arrival selects the object too.
  // The dock re-renders on every draft and selection change, and a field
  // focused mid-render is replaced a moment later - the marks toolbar then
  // aims at a node that is no longer in the document. Wait until the element
  // stops being swapped before focusing it.
  const dockIdle = async (id) => {
    for (let i = 0; i < 20; i += 1) {
      const stable = await page.evaluate(async (elementId) => {
        const first = document.getElementById(elementId);
        await new Promise((r) => setTimeout(r, 220));
        return first && first === document.getElementById(elementId) && first.isConnected;
      }, id);
      if (stable) return true;
    }
    return false;
  };
  const selectAllIn = async (id) => {
    const f = await show(`#${id}`);
    if (!f) return false;
    await dockIdle(id);
    await f.evaluate((el) => el.focus());
    await page.waitForTimeout(250);
    await page.keyboard.down('Control'); await page.keyboard.press('a'); await page.keyboard.up('Control');
    return true;
  };
  const press = async (sel, what, check) => {
    const button = await show(sel);
    if (!button) return say(false, `${what} — the control is there`, sel);
    const before = await snap();
    await button.click({ timeout: 6000 }).catch((e) => say(false, `${what} — clickable`, e.message.slice(0, 50)));
    await settle();
    const after = await snap();
    say(check(before, after), what);
    parity(after, what);
    return after;
  };

  await openEdition();

  // ============================ 1. an EMPTY block can be written on ========
  // Reset, then CHECK the reset landed before anything is judged. An autosave
  // still in flight from a previous run can otherwise write the old copy back
  // underneath this one, and every mark check after it then reads a headline
  // that already carries the mark it is about to press.
  for (let attempt = 0; attempt < 3; attempt += 1) {
    await resetBlock({ headline: '', subheading: '', body: '', status: 'empty' });
    await page.waitForTimeout(600);
    const row = await page.evaluate(async ([ed, key]) => {
      const pages = await fetch(`/api/newspapers/${ed}/pages`).then((r) => r.json());
      for (const p of pages) {
        const sec = p.sections.find((x) => x.section_key === key);
        if (sec) return `${sec.headline || ''}${sec.subheading || ''}${sec.body || ''}`;
      }
      return '';
    }, [ED, KEY]);
    if (!row) break;
  }
  await openEdition();
  await selectBlock();

  let s = await snap();
  say(s.prompts.length === 3, 'an empty block names the three things it is waiting for', JSON.stringify(s.prompts));
  say(!/Headline|Subheading|Write the story/.test((s.c || []).join('')),
    'and those prompts are never in the printable block');
  parity(s, 'empty block');

  const frameBox = async (id) => page.locator(`#${id}`).boundingBox();
  const head = await frameBox('edHeadlineFrame');
  say(Boolean(head) && head.height > 10, 'the headline frame can be clicked before a headline exists',
    JSON.stringify(head && { w: Math.round(head.width), h: Math.round(head.height) }));

  await page.mouse.dblclick(head.x + head.width / 2, head.y + head.height / 2);
  await settle(700);
  await page.keyboard.type('COUNCIL APPROVES THE PLAN', { delay: 30 });
  await page.keyboard.press('Enter');
  await settle(1500);
  s = await snap();
  say(/COUNCIL/.test(s.head), 'a headline typed on the page reaches the layout', s.head.slice(0, 60));
  parity(s, 'headline written on the page');

  const bodyFrame = await frameBox('edBodyFrame');
  await page.mouse.dblclick(bodyFrame.x + bodyFrame.width / 2, bodyFrame.y + 20);
  await settle(800);
  await page.keyboard.type('The council met and passed the water scheme.', { delay: 20 });
  await settle(1600);
  s = await snap();
  say(/council/.test(s.body), 'a story typed on the page reaches the layout', s.body.slice(0, 70));
  parity(s, 'story written on the page');
  say(s.prompts.length === 0, 'the prompts go once the block is written', JSON.stringify(s.prompts));
  await leaveBodyEdit();

  // ============================ 2. the three fields ========================
  await selectAllIn('edStoryHeadline');
  await page.keyboard.type('WATER SCHEME CLEARED', { delay: 20 });
  await settle();
  s = await snap();
  say(/CLEARED/.test(s.head), 'the headline field rewrites the headline', s.head.slice(0, 60));
  parity(s, 'headline field');

  await selectAllIn('edStorySubheading');
  await page.keyboard.type('Work starts in Satara', { delay: 20 });
  await settle();
  s = await snap();
  say(/Satara/.test((s.c || []).join('')), 'the subheading field writes the deck');
  parity(s, 'subheading field');

  const quill = await show('.ql-editor');
  await quill.click();
  await page.keyboard.press('End');
  // A single unmistakable token: composed lines are one span each and a line
  // break falls between words, so a two-word probe can be split across two
  // spans and read as absent when it is on the page.
  await page.keyboard.type(' Kolhapur.', { delay: 20 });
  await settle(1600);
  s = await snap();
  say(/Kolhapur/.test(s.body), 'the writing surface adds to the story', s.body.slice(-70));
  parity(s, 'writing surface');

  // ============================ 3. marks ===================================
  // WHICH object moved is the whole point. A mark that quietly lands in the
  // body while the headline is selected is the exact fault the controls net
  // exists for, so every one of these asserts the headline changed AND the
  // body did not.
  for (const [what, sel, probe] of [
    ['bold', '.ql-bold', /<(b|strong)[ >]/i],
    ['italic', '.ql-italic', /<(i|em)[ >]/i],
    ['underline', '.ql-underline', /<u[ >]/i],
  ]) {
    await selectAllIn('edStoryHeadline');
    await press(`#edQuillToolbar ${sel}`, `${what} marks the headline, and only the headline`,
      (b, a) => probe.test(a.head) !== probe.test(b.head) && a.bodyMarks === b.bodyMarks);
  }
  await selectAllIn('edStoryHeadline');
  await press('#edQuillInk .ed-quill-ink-btn:not(.is-none)', 'an ink colours the headline, and only the headline',
    (b, a) => a.head !== b.head && /color/i.test(a.head) && a.bodyMarks === b.bodyMarks);
  await selectAllIn('edStoryHeadline');
  await press('#edQuillSize .ed-quill-size-btn[data-size="28px"]', 'a size mark resizes words in the headline only',
    (b, a) => a.head !== b.head && a.bodyMarks === b.bodyMarks);

  await quill.click();
  await page.keyboard.down('Control'); await page.keyboard.press('a'); await page.keyboard.up('Control');
  await press('#edQuillToolbar .ql-bold', 'bold marks the body',
    (b, a) => /<(b|strong)[ >]/i.test(a.body) !== /<(b|strong)[ >]/i.test(b.body));
  await leaveBodyEdit();

  // ============================ 4. block type ==============================
  const sizeSelect = await show('#edStorySize');
  if (sizeSelect) {
    const before = await snap();
    const values = await page.locator('#edStorySize option').evaluateAll((os) => os.map((o) => o.value));
    const current = await page.locator('#edStorySize').inputValue();
    const other = values.find((v) => v !== current);
    await sizeSelect.selectOption(other);
    await settle(1600);
    const after = await snap();
    say(JSON.stringify(before.c) !== JSON.stringify(after.c), 'the block body size re-sets the copy', `${current} → ${other}`);
    parity(after, 'body size');
  }

  // ============================ 5. Properties ==============================
  // Block properties answer "what is true about the WHOLE block", so they are
  // shown when the block itself is selected - not while a headline is.
  await selectBlock();
  await press('[data-prop-border] [data-border="box"]', 'Border → box rules the block',
    (b, a) => a.border !== b.border || JSON.stringify(a.c) !== JSON.stringify(b.c));
  await press('[data-prop-border] [data-border="none"]', 'Border → none takes the rule off',
    (b, a) => a.border !== b.border || JSON.stringify(a.c) !== JSON.stringify(b.c));
  await press('[data-prop-tint] .tint-swatch:not([data-tint=""])', 'Ground lays a tint', (b, a) => a.ground !== b.ground);
  await press('[data-prop-tint] .tint-swatch[data-tint=""]', 'Ground clears back to paper', (b, a) => a.ground !== b.ground);
  // The COUNT is what this control sets. Whether the copy visibly re-splits
  // depends on how much of it there is, so the count is what is checked.
  // A block too narrow for two columns does not offer two - the engine's own
  // maxLegibleColumns decides, and refusing a count that would set no words is
  // the correct behaviour, not a missing control.
  if (await page.locator('[data-prop-columns] [data-columns="2"]:not([disabled])').count()) {
    await press('[data-prop-columns] [data-columns="2"]:not([disabled])', 'Columns → 2 takes',
      (b, a) => a.columns === '2');
  } else {
    say(true, 'Columns → 2 is not offered on a block too narrow to hold it',
      await page.locator('[data-prop-columns] [data-columns="2"]').getAttribute('title'));
  }
  // A reverse panel is DRAWN behind type that has already been placed, so no
  // composed line moves - the panel element itself is the evidence.
  await press('[data-prop-headline-style] [data-headline-style="reverse"]', 'Headline treatment → reversed',
    (b, a) => a.reverse && !b.reverse);
  await press('[data-prop-headline-style] [data-headline-style="plain"]', 'Headline treatment → plain',
    (b, a) => !a.reverse && b.reverse);
  await press('[data-prop-columns] [data-columns=""]:not([disabled])', 'Columns → Auto hands the decision back',
    () => true);

  // ============================ 6. pictures ================================
  const pic = await show('#edFramePictures .pic-frame');
  if (!pic) {
    say(true, 'this block carries no picture, so the picture controls are not driven here');
  } else {
    await pic.click();
    await settle(900);
    say(true, 'a picture is selectable on the Block Editor page');
    await press('[data-picture-do="bigger"]', 'Bigger enlarges the picture',
      (b, a) => a.pic && b.pic && (a.pic.w > b.pic.w || a.pic.h > b.pic.h));
    await press('[data-picture-do="smaller"]', 'Smaller shrinks it',
      (b, a) => a.pic && b.pic && (a.pic.w < b.pic.w || a.pic.h < b.pic.h));
    await press('[data-picture-do="rotate"]', 'Rotate turns it', (b, a) => a.pic && b.pic && a.pic.tr !== b.pic.tr);
    await press('[data-picture-do="flip-h"]', 'Flip flips it', (b, a) => a.pic && b.pic && a.pic.tr !== b.pic.tr);
    // A cut-out is always shown whole, so Cover and Stretch are not offered on
    // one - checked here rather than pressed, because a control that cannot
    // act must not pretend it did.
    const fit = await snap();
    if (fit.fitLocked.length) {
      say(fit.fitLocked.join() === 'cover,stretch', 'a cut-out is not offered a Fit that would crop it',
        JSON.stringify(fit.fitLocked));
      say(fit.pic.fit === 'contain', 'and it is shown whole');
    } else {
      await press('[data-picture-fit="cover"]', 'Fit → cover fills the frame', (b, a) => a.pic && a.pic.fit === 'cover');
      await press('[data-picture-fit="contain"]', 'Fit → contain fits it inside', (b, a) => a.pic && a.pic.fit === 'contain');
    }

    await pic.click();
    await settle(800);
    const before = await snap();
    for (let i = 0; i < 4; i += 1) { await page.keyboard.press('ArrowRight'); await page.waitForTimeout(350); }
    await settle(1600);
    const after = await snap();
    say(after.pic && before.pic && after.pic.x > before.pic.x, 'a selected picture nudges with the arrow keys',
      `${before.pic?.x} → ${after.pic?.x}`);
    parity(after, 'picture nudge');
  }

  say(errors.length === 0, 'no console or page errors anywhere in this run', errors.slice(0, 3).join(' | ') || '(none)');
  console.log(`\n${pass}/${ran} passed`);
  await browser.close();
  process.exit(pass === ran ? 0 : 1);
})().catch((e) => {
  console.error(`\nCRASHED after ${pass}/${ran} checks — everything after this did not run.\n`, e);
  process.exit(1);
});
