// Every control in the Block Editor, against every text object it can be
// pointed at.
//
//   node tests/browser/editor-controls.browser.js [editionId]
//
// This file exists because of a specific report: "if I want to apply
// align-right, align-left like this editor functionalities it does not apply
// on that section, rather it apply it on body". That was true, and it was true
// of more than alignment - the marks toolbar is Quill's, and Quill owns only
// the body, so bold with the headline selected emboldened a word in the story.
//
// The shape of the bug is what makes it worth a file of its own: a control
// that is WIRED and VISIBLE and does something, just to the wrong object. No
// error, no empty state, nothing on screen to notice - only a desk pressing a
// button and watching the wrong thing change. The only way to catch it is to
// press each control with each object selected and check WHICH field moved.
//
// Needs the app running on :3000. It resets the block it drives, so it can be
// run repeatedly.

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

const HEADLINE = 'शहरात नवीन उद्यान उभारणीस मंजुरी मिळाली';
const SUBHEADING = 'नागरिकांना लवकरच मोकळी जागा उपलब्ध होणार आहे';
const BODY = 'सातारा : नगरपालिकेच्या सर्वसाधारण सभेत या प्रस्तावाला मान्यता देण्यात आली आहे. '
  + 'उद्यानासाठी लागणारा निधी याच वर्षी उपलब्ध करून दिला जाणार आहे.';

(async () => {
  const browser = await chromium.launch({ executablePath: CHROME, args: ['--no-sandbox'] });
  const page = await (await browser.newContext({ viewport: { width: 1512, height: 950 } })).newPage();

  const errors = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message.slice(0, 200)}`));
  page.on('console', (m) => m.type() === 'error' && errors.push(`console: ${m.text().slice(0, 200)}`));

  const draft = () => page.evaluate(async () => (await import('/editor/store.js')).getDraft());
  const part = () => page.evaluate(async () => (await import('/editor/store.js')).getSelectedPart());

  async function openEdition() {
    await page.goto(BASE);
    await page.waitForTimeout(900);
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

  async function resetBlock() {
    await page.evaluate(async ([ed, key]) => {
      const pages = await fetch(`/api/newspapers/${ed}/pages`).then((r) => r.json());
      await fetch(`/api/pages/${pages[0].id}/sections/${key}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          headline: '', subheading: '', body: '', smartCardKey: null, smartCardData: null, status: 'empty',
          headlineAlign: 'left', subheadingAlign: 'left', textAlign: 'justify',
        }),
      });
      const images = await fetch(`/api/pages/${pages[0].id}/sections/${key}/images`).then((r) => r.json());
      for (const image of images) {
        await fetch(`/api/pages/${pages[0].id}/sections/${key}/images/${image.id}`, { method: 'DELETE' });
      }
    }, [ED, KEY]);
  }

  const block = () => page.locator(`.newspaper-section[data-section-key="${KEY}"]`);

  /** Where each composed band's first line starts, on the newspaper page. */
  const lefts = () => page.evaluate((key) => {
    const el = document.querySelector(`.newspaper-section[data-section-key="${key}"]`);
    const firstOf = (selector) => {
      const all = [...el.querySelectorAll(selector)];
      if (!all.length) return null;
      const top = all.reduce((a, b) => (a.getBoundingClientRect().top <= b.getBoundingClientRect().top ? a : b));
      return Math.round(parseFloat(top.style.left) * 100) / 100;
    };
    return {
      headline: firstOf('.section-headline'),
      subheading: firstOf('.section-subheading'),
      body: firstOf('.section-body-line'),
    };
  }, KEY);

  const alignButton = (value) => page.locator(`#edStoryToolbar [data-align="${value}"]`);
  const activeAlign = () => page.evaluate(() =>
    document.querySelector('#edStoryToolbar [data-align].active')?.dataset.align || null);

  /** Puts the caret in one of the three writing surfaces and selects it. */
  async function focusPart(name) {
    if (name === 'body') {
      await page.click('.ql-editor');
      await page.waitForTimeout(350);
      return;
    }
    await page.click(name === 'headline' ? '#edStoryHeadline' : '#edStorySubheading');
    await page.waitForTimeout(350);
  }

  async function selectAllIn(name) {
    if (name === 'body') {
      await page.evaluate(() => {
        const quill = document.querySelector('#edQuill .ql-editor');
        const range = document.createRange();
        range.selectNodeContents(quill);
        const selection = window.getSelection();
        selection.removeAllRanges();
        selection.addRange(range);
      });
      return;
    }
    await page.evaluate((id) => {
      const field = document.getElementById(id);
      field.focus();
      const range = document.createRange();
      range.selectNodeContents(field);
      const selection = window.getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
    }, name === 'headline' ? 'edStoryHeadline' : 'edStorySubheading');
  }

  await openEdition();
  await resetBlock();
  await openEdition();
  await block().click();
  await page.waitForTimeout(1400);

  await page.fill('#edStoryHeadline', HEADLINE);
  await page.waitForTimeout(300);
  await page.fill('#edStorySubheading', SUBHEADING);
  await page.waitForTimeout(300);
  await page.click('.ql-editor');
  await page.keyboard.type(BODY);
  await page.waitForTimeout(900);

  {
    const d = await draft();
    say(d.headline.includes('उद्यान') && d.subheading.includes('मोकळी') && d.body.includes('नगरपालिकेच्या'),
      'all three objects carry their own copy');
  }

  // ------------------------------------------------------- the aim itself ---
  {
    await focusPart('headline');
    say((await part()) === 'headline', 'clicking the headline field selects the headline object', await part());
    await focusPart('subheading');
    say((await part()) === 'subheading', 'clicking the subheading field selects the subheading object', await part());
    await focusPart('body');
    say((await part()) === 'body', 'clicking the body selects the body object', await part());
  }

  // --------------------------------------------------------- ALIGNMENT ---
  //
  // The report itself. Each object's alignment must land in that object's own
  // field, and must not touch the other two.
  const ALIGN_FIELD = { headline: 'headlineAlign', subheading: 'subheadingAlign', body: 'textAlign' };

  for (const name of ['headline', 'subheading', 'body']) {
    const field = ALIGN_FIELD[name];
    const others = Object.entries(ALIGN_FIELD).filter(([k]) => k !== name);

    await focusPart(name);
    const before = await draft();
    const beforeLefts = await lefts();

    await alignButton('right').click();
    await page.waitForTimeout(600);
    const after = await draft();
    const afterLefts = await lefts();

    say(after[field] === 'right', `align-right with the ${name} selected writes ${field}`,
      `${field}=${after[field]}`);
    say(others.every(([, f]) => after[f] === before[f]),
      `and leaves the other two objects' alignment alone`,
      others.map(([k, f]) => `${k}:${after[f]}`).join(' '));
    say(afterLefts[name] !== null && beforeLefts[name] !== null && afterLefts[name] > beforeLefts[name],
      `and the ${name} really moves right on the newspaper page`,
      `${beforeLefts[name]} -> ${afterLefts[name]}`);
    say(others.every(([k]) => afterLefts[k] === beforeLefts[k]),
      `while nothing else on the block moves`,
      others.map(([k]) => `${k}:${beforeLefts[k]}->${afterLefts[k]}`).join(' '));

    // The button that is lit has to be the one the object is actually using.
    say((await activeAlign()) === 'right', `the toolbar shows right as the ${name}'s current alignment`, await activeAlign());

    await alignButton('center').click();
    await page.waitForTimeout(500);
    const centred = await lefts();
    say(centred[name] > beforeLefts[name] && centred[name] < afterLefts[name],
      `centre puts the ${name} between flush left and flush right`,
      `${beforeLefts[name]} < ${centred[name]} < ${afterLefts[name]}`);

    await alignButton('left').click();
    await page.waitForTimeout(500);
    say(Math.abs((await lefts())[name] - beforeLefts[name]) < 0.5,
      `and left returns the ${name} exactly where it started`);
  }

  // Selecting a different object must re-aim the buttons, with no click.
  {
    await focusPart('headline');
    await alignButton('center').click();
    await page.waitForTimeout(500);
    await focusPart('body');
    await page.waitForTimeout(400);
    say((await activeAlign()) !== 'center' || (await draft()).textAlign === 'center',
      'selecting the body re-aims the toolbar at the body, without a click',
      `lit=${await activeAlign()} textAlign=${(await draft()).textAlign}`);
    await focusPart('headline');
    await page.waitForTimeout(400);
    say((await activeAlign()) === 'center', 'and back on the headline it shows the headline\'s own choice again');
    await alignButton('left').click();
    await page.waitForTimeout(400);
  }

  // ------------------------------------------------------------- SIZE ---
  const SIZE_FIELD = { headline: 'headlineFontPx', subheading: 'subheadingFontPx', body: 'bodyFontPx' };
  for (const name of ['headline', 'subheading', 'body']) {
    await focusPart(name);
    await page.waitForTimeout(300);
    const before = await draft();
    const target = name === 'headline' ? '28' : name === 'subheading' ? '18' : '12';
    await page.selectOption('#edStorySize', target);
    await page.waitForTimeout(600);
    const after = await draft();
    say(Number(after[SIZE_FIELD[name]]) === Number(target),
      `the size control writes ${SIZE_FIELD[name]} when the ${name} is selected`,
      `${before[SIZE_FIELD[name]]} -> ${after[SIZE_FIELD[name]]}`);
    say(Object.entries(SIZE_FIELD).filter(([k]) => k !== name).every(([, f]) => after[f] === before[f]),
      'and no other object changed size');
  }

  // ------------------------------------------------------------ MARKS ---
  //
  // Bold, italic, underline and a phrase at its own size, on each object. The
  // toolbar is one strip; what it acts on is whatever is selected.
  const marksToolbar = '#edQuillToolbar';
  for (const name of ['headline', 'subheading', 'body']) {
    await focusPart(name);
    await selectAllIn(name);
    await page.waitForTimeout(200);

    await page.locator(`${marksToolbar} .ql-bold`).click();
    await page.waitForTimeout(600);
    const bolded = await draft();
    const value = name === 'body' ? bolded.body : bolded[name];
    say(/<(b|strong)>/i.test(value), `bold marks the ${name}, not something else`, value.slice(0, 70));

    const otherFields = ['headline', 'subheading', 'body'].filter((k) => k !== name);
    say(otherFields.every((k) => !/<(b|strong)>/i.test(bolded[k])),
      'and no other object was emboldened',
      otherFields.map((k) => `${k}:${/<(b|strong)>/i.test(bolded[k])}`).join(' '));

    // And it reaches the printed page, not just the draft.
    const painted = await page.evaluate((key) => {
      const el = document.querySelector(`.newspaper-section[data-section-key="${key}"]`);
      return el.querySelectorAll('b, strong').length;
    }, KEY);
    say(painted > 0, `the ${name}'s bold run is painted on the newspaper page`, `${painted} bold runs`);

    // Off again, so the next object starts clean.
    await selectAllIn(name);
    await page.locator(`${marksToolbar} .ql-clean`).click();
    await page.waitForTimeout(600);
    const cleaned = await draft();
    const back = name === 'body' ? cleaned.body : cleaned[name];
    say(!/<(b|strong)>/i.test(back), `clear formatting takes the ${name}'s marks off again`, back.slice(0, 70));
  }

  // Italic and underline, on the headline specifically - the object that had
  // no way to carry them at all before.
  {
    await focusPart('headline');
    await selectAllIn('headline');
    await page.locator(`${marksToolbar} .ql-italic`).click();
    await page.waitForTimeout(500);
    say(/<(i|em)>/i.test((await draft()).headline), 'italic marks the headline');
    await selectAllIn('headline');
    await page.locator(`${marksToolbar} .ql-underline`).click();
    await page.waitForTimeout(500);
    say(/<u>/i.test((await draft()).headline), 'underline marks the headline');
    await selectAllIn('headline');
    await page.locator(`${marksToolbar} .ed-quill-size-btn[data-size="28px"]`).click();
    await page.waitForTimeout(500);
    say(/data-sahas-size="28"/.test((await draft()).headline),
      'a phrase inside the headline can be set at its own size',
      (await draft()).headline.slice(0, 90));
    await selectAllIn('headline');
    await page.locator(`${marksToolbar} .ql-clean`).click();
    await page.waitForTimeout(500);
  }

  // A list is a body form. The button must not pretend otherwise.
  {
    await focusPart('headline');
    await page.waitForTimeout(300);
    say(await page.locator(`${marksToolbar} .ql-list`).first().isDisabled(),
      'the list buttons are disabled while a headline is selected - a headline is not a bullet');
    say(await page.locator(marksToolbar).evaluate((el) => el.classList.contains('is-display-target')),
      'and the marks toolbar says which object it is aimed at');
    await focusPart('body');
    await page.waitForTimeout(300);
    say(!(await page.locator(`${marksToolbar} .ql-list`).first().isDisabled()),
      'and they come back for the body');
  }

  // ------------------------------------------------- surviving the round trip ---
  {
    await focusPart('headline');
    await selectAllIn('headline');
    await page.locator(`${marksToolbar} .ql-bold`).click();
    await page.waitForTimeout(400);
    await alignButton('center').click();
    await page.waitForTimeout(1200);
    await page.click('#edSaveBtn').catch(() => {});
    await page.waitForTimeout(1800);

    const stored = await page.evaluate(async ([ed, key]) => {
      const pages = await fetch(`/api/newspapers/${ed}/pages`).then((r) => r.json());
      const section = pages[0].sections.find((s) => s.section_key === key);
      return { headline: section.headline, headlineAlign: section.headline_align, textAlign: section.text_align };
    }, [ED, KEY]);
    say(/<(b|strong)>/i.test(stored.headline), 'the headline\'s marks are stored on the row', stored.headline.slice(0, 70));
    say(stored.headlineAlign === 'center', 'and so is its own alignment', String(stored.headlineAlign));
    say(stored.textAlign !== 'center', 'the body kept its own', String(stored.textAlign));
  }

  // ------------------------------------------------------------- the border ---
  //
  // The one control that rules a block, and the object it acts on is the BLOCK
  // - not the headline, not the body. Nothing on a page is ruled unless a
  // person ruled it: adverts, briefs and the standing features used to be born
  // boxed from the layout template with no way to take the box off, which is
  // what the desk reported seeing in print view.
  {
    await page.locator(`.newspaper-section[data-section-key="${KEY}"]`).click();
    await page.waitForTimeout(600);
    // The border belongs to the BLOCK, and the panel shows the properties of
    // whatever is selected - the run above left the headline selected, so back
    // out to the whole block first, exactly as a desk would.
    await page.keyboard.press('Escape');
    await page.waitForTimeout(700);
    const blockClass = () => page.locator(`.newspaper-section[data-section-key="${KEY}"]`).getAttribute('class');
    const storedBorder = () => page.evaluate(async ([ed, key]) => {
      const pages = await fetch(`/api/newspapers/${ed}/pages`).then((r) => r.json());
      return pages[0].sections.find((s) => s.section_key === key).border_style;
    }, [ED, KEY]);

    say(await page.locator('[data-prop-border]').count() === 1,
      'the block carries a border control, and exactly one');
    say(!/ruled-box/.test(await blockClass()), 'and nothing is ruled to begin with');

    await page.locator('[data-prop-border] [data-border="box"]').click();
    await page.waitForTimeout(1200);
    say(/ruled-box/.test(await blockClass()), 'pressing Box rules the block on the page immediately');
    await page.waitForTimeout(3200);
    say((await storedBorder()) === 'box', 'and the row carries it', String(await storedBorder()));

    await page.locator('[data-prop-border] [data-border="none"]').click();
    await page.waitForTimeout(1200);
    say(!/ruled-box/.test(await blockClass()), 'pressing None takes it off again');
    await page.waitForTimeout(3200);
    say((await storedBorder()) === 'none', 'and that is what is stored', String(await storedBorder()));
  }

  // ------------------------------------------------------------- the paper's ink ---
  //
  // A colour on WORDS, and it must land on the object that is selected - the
  // same rule the alignment controls and the marks toolbar already keep. Four
  // named inks, never a colour wheel: a page is separated into plates.
  {
    const draft = () => page.evaluate(async () => (await import('/editor/store.js')).getState().draft);

    say(await page.locator('.ed-quill-ink-btn').count() === 4, 'the toolbar carries the paper\'s four inks and no more');

    await focusPart('body');
    await selectAllIn('body');
    await page.locator('.ed-quill-ink-btn[data-ink="#c8102e"]').click();
    await page.waitForTimeout(600);
    say(/data-sahas-ink="#c8102e"/.test((await draft()).body), 'an ink on the body is stored as the controlled mark',
      (await draft()).body.slice(0, 80));
    say(!/style="color/.test((await draft()).body), 'and never as a raw style - a pasted stylesheet may not reach the page');
    say(await page.evaluate(() => {
      const el = document.querySelector('.newspaper-section.active .section-body-line span[style*="color"]');
      return Boolean(el);
    }), 'the page itself paints it, not only the editor');

    await focusPart('headline');
    await selectAllIn('headline');
    await page.locator('.ed-quill-ink-btn[data-ink="#17458f"]').click();
    await page.waitForTimeout(600);
    say(/data-sahas-ink="#17458f"/.test((await draft()).headline), 'and the headline takes its own, not the body\'s',
      (await draft()).headline.slice(0, 80));
    say(!/#17458f/.test((await draft()).body), 'the body kept the ink it already had');

    // Black is the absence of an ink, not a fifth one.
    await selectAllIn('headline');
    await page.locator('.ed-quill-ink-btn[data-ink=""]').click();
    await page.waitForTimeout(600);
    say(!/data-sahas-ink/.test((await draft()).headline), 'Black clears the ink rather than adding one');

    // And take it off the body too, so this net leaves the fixture as it found
    // it - a desk opening the edition afterwards should not find a block set
    // in red because a test ran.
    await focusPart('body');
    await selectAllIn('body');
    await page.locator('.ed-quill-ink-btn[data-ink=""]').click();
    await page.waitForTimeout(600);
    say(!/data-sahas-ink/.test((await draft()).body), 'and off the body as well, leaving the block as it was found');
  }

  // -------------------------------------------------- the ground and the panel ---
  {
    await page.locator(`.newspaper-section[data-section-key="${KEY}"]`).click();
    await page.waitForTimeout(600);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(700);
    const blockStyle = () => page.locator(`.newspaper-section[data-section-key="${KEY}"]`).getAttribute('style');

    say(await page.locator('[data-prop-tint] .tint-swatch').count() === 5, 'the block offers the paper\'s tints and white');
    await page.locator('[data-prop-tint] [data-tint="#fbf3e9"]').click();
    await page.waitForTimeout(900);
    // The tint is a VALUE, so it lives in the element's own style - which means
    // the single-block repaint path has to set it too. It did not, and the tint
    // was stored correctly, drawn correctly on a reload, and never appeared
    // while a desk was choosing it.
    say(/--block-tint: #fbf3e9/.test(await blockStyle()), 'and it appears on the page as it is chosen', await blockStyle());

    await page.locator('[data-prop-headline-style] [data-headline-style="reverse"]').click();
    await page.waitForTimeout(1000);
    say(await page.locator(`.newspaper-section[data-section-key="${KEY}"] .section-headline-reverse`).count() === 1,
      'a reversed headline draws its panel');
    say(await page.evaluate((key) => {
      const el = document.querySelector(`.newspaper-section[data-section-key="${key}"] .section-headline`);
      return el ? getComputedStyle(el).color : '';
    }, KEY) === 'rgb(255, 255, 255)', 'and sets the type out of it in white');

    await page.waitForTimeout(3200);
    const stored = await page.evaluate(async ([ed, key]) => {
      const pages = await fetch(`/api/newspapers/${ed}/pages`).then((r) => r.json());
      const section = pages[0].sections.find((s) => s.section_key === key);
      return { ground: section.background_color, style: section.headline_style };
    }, [ED, KEY]);
    say(stored.ground === '#fbf3e9' && stored.style === 'reverse', 'both are on the row', JSON.stringify(stored));

    // Put it back, so this net can be run again.
    await page.locator('[data-prop-tint] [data-tint=""]').click();
    await page.waitForTimeout(700);
    await page.locator('[data-prop-headline-style] [data-headline-style="plain"]').click();
    await page.waitForTimeout(3200);
    const cleared = await page.evaluate(async ([ed, key]) => {
      const pages = await fetch(`/api/newspapers/${ed}/pages`).then((r) => r.json());
      return pages[0].sections.find((s) => s.section_key === key).background_color;
    }, [ED, KEY]);
    say(cleared === null, 'White is stored as nothing at all, so an untinted block can be told from a white one', String(cleared));
  }

  // ------------------------------------------------------------- the columns ---
  //
  // "Auto" is NULL, and it has to be expressible: a desk who once set a count
  // must be able to hand the decision back to the engine. A number input could
  // not say it, which is why this control moved out of Typography.
  {
    const KEY_WIDE = 'anchor';
    await page.locator(`.newspaper-section[data-section-key="${KEY_WIDE}"]`).click();
    await page.waitForTimeout(600);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(800);
    const stored = () => page.evaluate(async ([ed, key]) => {
      const pages = await fetch(`/api/newspapers/${ed}/pages`).then((r) => r.json());
      return pages[0].sections.find((s) => s.section_key === key).column_count;
    }, [ED, KEY_WIDE]);

    say(await page.locator('[data-prop-columns] .segment').count() === 5, 'the block offers Auto and four counts');
    say((await page.locator('[data-prop-columns] .segment.active').innerText()).trim() === 'Auto',
      'and a block nobody has set reads as Auto');
    say(/Auto sets this block in 2 columns/.test(
      await page.locator('[data-prop-columns]').evaluate((el) => el.closest('.prop-section').querySelector('.ext-note').textContent),
    ), 'which says what it would actually do, in this block\'s own numbers');
    say(await page.locator(`.newspaper-section[data-section-key="${KEY_WIDE}"] .section-body-line`).count() > 0,
      'the block is set');

    await page.locator('[data-prop-columns] [data-columns="1"]').click();
    await page.waitForTimeout(3400);
    say((await stored()) === 1, 'an explicit count is stored', String(await stored()));

    await page.locator('[data-prop-columns] [data-columns=""]').click();
    await page.waitForTimeout(3400);
    // 0 on the wire, NULL in the row - `|| null` on either side would have
    // eaten it and left the explicit 1 exactly where it was.
    say((await stored()) === null, 'and Auto hands the decision back to the engine', String(await stored()));
  }

  say(errors.length === 0, 'no console errors or page errors anywhere in this run', errors.slice(0, 4).join(' | ') || '(none)');

  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} passed`);
  if (failed.length) console.log(failed.map((f) => `  FAIL ${f.name}`).join('\n'));

  await browser.close();
  process.exit(failed.length ? 1 : 0);
})().catch((error) => {
  console.log(`CRASH ${error.message}`);
  process.exit(1);
});
