// THE DESK'S OWN ACTIONS - pressed, with what the software SAID read back.
//
// This net exists because of a report that "many things is not working good"
// about a list of buttons, and because driving them found that almost all of
// them worked and none of them could be heard: `showNotice()` wrote only into
// `#edNotice`, which measured **width 0** in the running app (it is the last
// child of the Block Editor header's flex row, with `margin-left: auto` and
// `overflow: hidden`) and sits ~600px below the toolbar being pressed. So
// "Set tighter - body 6.4px to 5.9px - and it fits." and "There is no empty
// block on a later page to carry this into." were both said, correctly, into
// nothing.
//
// Every check here therefore asserts the SENTENCE as well as the effect. A
// button that acts and cannot be heard is the fault this net is for.
//
// It also covers the four faults found beside that one, all of which are
// invisible to `npm test` because they are geometry, CSS state and focus:
//
//   - the block's own key printed over the story it names
//   - Story/Image/Clear appearing under the pointer of an unselected block
//   - a block added after the house style set in the wrong face
//   - Insert adding a panel whose editor Properties does not render
//   - the advert ear beside the nameplate, which had a server and no door
//
//   node tests/browser/desk-actions.browser.js            # defaults to 49291
//   node tests/browser/desk-actions.browser.js 49291
const { chromium } = require('playwright-core');

const ED = Number(process.argv[2] || 49291);
const BASE = process.env.SAHAS_BASE || 'http://localhost:3000';
const KEY = 'lead';

let pass = 0;
let ran = 0;
const say = (ok, name, detail = '') => {
  ran += 1;
  if (ok) pass += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` :: ${detail}` : ''}`);
};

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || '/usr/bin/google-chrome' });
  const page = await browser.newPage({ viewport: { width: 1512, height: 950 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(`console: ${m.text().slice(0, 200)}`); });
  page.on('dialog', (d) => d.accept());

  // WHAT TO PUT BACK. This net changes the paper's own faces and adds a panel
  // to a real block, so it restores both - from the crash handler as well, for
  // the reason editor-parity.browser.js records: a run that dies half way
  // otherwise leaves the next run treating its leavings as the block's own.
  let paperWas = null;
  let panelsWere = null;

  try {
    await page.goto(BASE); await page.waitForTimeout(900);
    if (await page.locator('#email').count()) {
      await page.fill('#email', 'admin@esahas.com');
      await page.fill('#password', 'admin123');
      await page.click('#loginBtn');
    }
    await page.waitForSelector('.edition-row', { timeout: 20000 });
    const when = await page.evaluate(
      (ed) => fetch(`/api/newspapers/${ed}`).then((r) => r.json()).then((n) => String(n.publication_date).slice(0, 10)), ED,
    );
    await page.fill('#editionSearch', when); await page.waitForTimeout(700);
    await page.locator(`.edition-row[data-edition-id="${ED}"] .edition-open`).click();
    await page.waitForSelector('#canvasSurface', { timeout: 20000 });
    await page.waitForTimeout(3500);

    paperWas = await page.evaluate((ed) => fetch(`/api/newspapers/${ed}`).then((r) => r.json())
      .then((n) => ({ bodyFamily: n.body_family, displayFamily: n.display_family })), ED);
    // The WHOLE block, because the restoring PUT is a full replace - a payload
    // of `{ insetPanels }` alone blanks the headline, the deck and the story.
    // visual-pass.browser.js records what that cost the first time it happened.
    panelsWere = await page.evaluate(async ([ed, key]) => {
      const pages = await fetch(`/api/newspapers/${ed}/pages`).then((r) => r.json());
      const pg = pages.find((p) => p.sections.some((s) => s.section_key === key));
      return { pageId: pg.id, was: pg.sections.find((s) => s.section_key === key) };
    }, [ED, KEY]);

    const said = () => page.evaluate(() => document.getElementById('deskNotice')?.textContent || '');
    const press = async (id, wait = 2600) => {
      await page.evaluate((i) => {
        const n = document.getElementById('deskNotice');
        if (n) n.textContent = '';
        document.getElementById(i).click();
      }, id);
      await page.waitForTimeout(wait);
      return said();
    };
    const closeModal = async () => {
      await page.evaluate(() => {
        const r = document.getElementById('modalRoot'); if (r) r.innerHTML = '';
        ['worklistPanel', 'preflightPanel', 'bulkPanel', 'compositionPanel'].forEach((id) => document.getElementById(id)?.remove());
      });
      await page.waitForTimeout(400);
    };

    // ---- the block's own key is off the story it names ---------------------
    const chrome = await page.evaluate((key) => {
      const sec = document.querySelector(`.newspaper-section[data-section-key="${key}"]`);
      const empty = [...document.querySelectorAll('.newspaper-section:not(.filled)')][0];
      const op = (n, s) => (n && n.querySelector(s) ? getComputedStyle(n.querySelector(s)).opacity : null);
      return {
        filled: sec.classList.contains('filled'),
        label: op(sec, '.section-label'),
        flags: op(sec, '.section-flags'),
        emptyLabel: empty ? op(empty, '.section-label') : null,
        emptyKey: empty ? empty.dataset.sectionKey : null,
      };
    }, KEY);
    say(chrome.filled && chrome.label === '0', 'a written block does not print its own key over the story', JSON.stringify(chrome));
    say(chrome.flags === '1', 'and its warning marks are never hidden with it');
    say(!chrome.emptyKey || chrome.emptyLabel === '1', 'an empty block still says what it is waiting for', String(chrome.emptyKey));
    // AND IT STAYS GONE UNDER THE POINTER. Hover and selection used to bring
    // the chrome back, on the reasoning that those are the moments a desk asks
    // what a block IS. They are the two moments it must be gone: the pointer
    // is on the block for the whole time a desk works on it and a block being
    // edited is selected throughout, so "ANCHOR" sat over the headline on the
    // one screen where the copy matters most. The Block Editor's own header
    // still names the selected block - a read-out in the chrome, not a word
    // laid over the story.
    await page.hover(`.newspaper-section[data-section-key="${KEY}"]`); await page.waitForTimeout(500);
    const onHover = await page.evaluate((k) => getComputedStyle(document.querySelector(`.newspaper-section[data-section-key="${k}"] .section-label`)).opacity, KEY);
    say(onHover === '0', 'and it stays off while the pointer is on the block', `opacity ${onHover}`);
    await page.evaluate((k) => document.querySelector(`.newspaper-section[data-section-key="${k}"]`)?.click(), KEY);
    await page.waitForTimeout(900);
    const onSelect = await page.evaluate((k) => {
      const sec = document.querySelector(`.newspaper-section[data-section-key="${k}"]`);
      return { active: sec.classList.contains('active'), label: getComputedStyle(sec.querySelector('.section-label')).opacity };
    }, KEY);
    say(onSelect.active && onSelect.label === '0', 'and off while the block is selected and being written',
      JSON.stringify(onSelect));
    // The two that keep it are the block saying something the copy cannot: a
    // standing feature is USEFULLY named, and an overflowing block is telling
    // the desk it does not print.
    const kept = await page.evaluate(() => {
      const one = document.querySelector('.newspaper-section.filled.holds-card, .newspaper-section.filled.overflowing');
      if (!one) return null;
      const badge = one.querySelector('.section-status-badge');
      return { key: one.dataset.sectionKey, badge: badge ? getComputedStyle(badge).opacity : null };
    });
    say(!kept || kept.badge === '1', 'a card or an overflowing block still speaks up', JSON.stringify(kept));
    // Put the selection back the way this section found it: the next check
    // asks what an UNCHOSEN block draws, and the hover toolbar is gated on
    // `.active`, so a block left selected here fails it three checks later.
    await page.keyboard.press('Escape');
    await page.mouse.move(4, 4);
    await page.waitForTimeout(600);

    // ---- Story / Image / Clear may not appear under the pointer ------------
    const toolbarDisplay = (k) => page.evaluate((key) => getComputedStyle(
      document.querySelector(`.newspaper-section[data-section-key="${key}"] .section-hover-toolbar`),
    ).display, k);
    say(await toolbarDisplay(KEY) === 'none', 'Story/Image/Clear do not draw on a block the desk has not chosen');

    await page.locator(`.newspaper-section[data-section-key="${KEY}"]`).first().click();
    await page.waitForTimeout(2500);
    await page.hover(`.newspaper-section[data-section-key="${KEY}"]`); await page.waitForTimeout(400);
    say(await toolbarDisplay(KEY) === 'flex', 'and they are there on the block the desk has chosen');

    const imageSaid = await page.evaluate(async (key) => {
      const n = document.getElementById('deskNotice'); if (n) n.textContent = '';
      document.querySelector(`.newspaper-section[data-section-key="${key}"] [data-section-action="image"]`).click();
      await new Promise((r) => setTimeout(r, 1600));
      return document.getElementById('deskNotice')?.textContent || '';
    }, KEY);
    say(/Pictures for/.test(imageSaid), 'and Image says where it is taking the desk before it moves them', JSON.stringify(imageSaid));

    // ---- the software's answer has a box a person can read it in -----------
    const notice = await page.evaluate(async () => {
      document.getElementById('carryOverBtn').click();
      await new Promise((r) => setTimeout(r, 2600));
      const n = document.getElementById('deskNotice');
      if (!n) return { missing: true };
      const b = n.getBoundingClientRect();
      const cs = getComputedStyle(n);
      return {
        text: n.textContent,
        width: Math.round(b.width),
        height: Math.round(b.height),
        top: Math.round(b.top),
        vh: innerHeight,
        opacity: cs.opacity,
        visibility: cs.visibility,
      };
    });
    say(notice.width > 200 && notice.height > 12, 'a message has a box a person can read it in', JSON.stringify(notice));
    say(notice.opacity === '1' && notice.visibility === 'visible' && notice.top > 0 && notice.top < notice.vh,
      'and it is against the viewport, wherever on the one long page the desk is');
    say(/no empty block/i.test(notice.text || ''), 'Carry over says exactly why it refused', JSON.stringify(notice.text));

    // MAKE IT FIT SAYS WHAT IT WOULD DO - AND NOW IT SAYS IT IN THE QUESTION.
    //
    // This used to read the desk's notice strip alone, because the proposal
    // arrived as a toast followed by a native `confirm("...\n\nApply it?")`.
    // Changing a block's type is a design decision and the sentence describing
    // it is the whole basis for the answer, so it belongs IN the question
    // rather than in a message beside it that fades on a timer.
    //
    // The rule is the one this check was written for and is unchanged: the
    // desk is told what the change would be before it happens. Either surface
    // satisfies it - the dialog when there is something to apply, the notice
    // when there is not (already fits, or nothing legible would make it fit).
    const fitNotice = await press('fitBtn', 3200);
    const fitAsked = await page.evaluate(() => {
      const d = document.querySelector('.sahas-dialog');
      if (!d) return '';
      return `${d.querySelector('h2')?.textContent || ''} ${(d.querySelector('.sahas-dialog-body')?.innerText || '').replace(/\s+/g, ' ')}`.trim();
    });
    say(Boolean(fitNotice || fitAsked), 'Make it fit says what it would do',
      JSON.stringify((fitAsked || fitNotice).slice(0, 110)));
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);
    await closeModal();

    // `#worklistPanel`, appended to document.body - not `#modalRoot`. The
    // worklist, the preflight report, the bulk proposals and the AI plan are
    // all panels over the workspace rather than modals, which is deliberate
    // (VISION.md: everything happens inside the one screen).
    await press('worklistBtn', 3500);
    const worklist = await page.evaluate(() => (document.getElementById('worklistPanel')?.textContent || '').replace(/\s+/g, ' ').trim());
    say(worklist.length > 20, "What's left opens the worklist", JSON.stringify(worklist.slice(0, 90)));
    await closeModal();

    // ---- the paper's faces reach the story AND the headline ----------------
    await page.selectOption('#paperBodyFace', 'mukta'); await page.waitForTimeout(4500);
    await page.selectOption('#paperDisplayFace', 'rozha'); await page.waitForTimeout(4500);
    const faces = await page.evaluate((key) => {
      const sec = document.querySelector(`.newspaper-section[data-section-key="${key}"]`);
      const g = (s) => { const n = sec.querySelector(s); return n ? getComputedStyle(n).fontFamily.split(',')[0].replace(/"/g, '') : null; };
      return { headline: g('.section-headline'), deck: g('.section-subheading'), body: g('.section-body-line') };
    }, KEY);
    say(faces.body === 'Mukta', "the paper's story face reaches the story", JSON.stringify(faces));
    say(faces.headline === 'Rozha One' && faces.deck === 'Rozha One',
      "and the paper's headline face reaches the headline AND the deck", JSON.stringify(faces));

    // ---- a block added AFTERWARDS is in the same faces ---------------------
    const added = await press('addBlockBtn', 3500);
    say(/Block added/.test(added), '+ Block adds a block and says so', JSON.stringify(added.slice(0, 100)));
    const newFace = await page.evaluate(async (ed) => {
      const pages = await fetch(`/api/newspapers/${ed}/pages`).then((r) => r.json());
      const custom = pages.flatMap((p) => p.sections).filter((s) => /^block-/.test(s.section_key));
      const last = custom[custom.length - 1];
      const paper = await fetch(`/api/newspapers/${ed}`).then((r) => r.json());
      return {
        key: last && last.section_key,
        font: last && last.font_family,
        display: last && last.display_family,
        paperBody: paper.body_family,
        paperDisplay: paper.display_family,
      };
    }, ED);
    say(newFace.font === newFace.paperBody && newFace.display === newFace.paperDisplay,
      'and a block added AFTER the house style is set in the paper\'s own faces', JSON.stringify(newFace));
    const removed = await press('removeBlockBtn', 3500);
    say(/Deleted/.test(removed), '− Block takes it off again and says so', JSON.stringify(removed.slice(0, 80)));

    // ---- the advert ear beside the nameplate -------------------------------
    const earOn = () => page.evaluate(async (ed) => {
      const pages = await fetch(`/api/newspapers/${ed}/pages`).then((r) => r.json());
      return pages.find((p) => p.page_number === 1).sections.some((s) => s.section_key === 'masthead-advert');
    }, ED);
    say(await page.evaluate(() => document.getElementById('mastheadEarBtn')?.hidden === false),
      'the advert ear beside the nameplate has a control, on page one');
    const wasOn = await earOn();
    await press('mastheadEarBtn', 3500);
    say(await earOn() !== wasOn, 'and it takes the sold corner off the front page');
    await press('mastheadEarBtn', 3500);
    say(await earOn() === wasOn, 'and puts it back — which nothing in this product could reach before');

    // ---- Insert leaves the desk able to write in what it added -------------
    await page.locator(`.newspaper-section[data-section-key="${KEY}"]`).first().click(); await page.waitForTimeout(2500);
    await page.locator('#edBodyFrame').click({ timeout: 5000 }).catch(() => {});
    await page.waitForTimeout(1200);
    await page.locator('#edDeviceBar [data-device="insert"]').click(); await page.waitForTimeout(500);
    await page.locator('#edDeviceMenu [data-device-choice="panel:note"]').click(); await page.waitForTimeout(3000);
    const reach = await page.evaluate((key) => ({
      drawn: document.querySelectorAll(`.newspaper-section[data-section-key="${key}"] .section-inset-panel`).length,
      focusedField: document.activeElement ? document.activeElement.getAttribute('data-panel-field') : null,
      listed: document.querySelectorAll('#propPanels .prop-panel').length,
    }), KEY);
    say(reach.drawn >= 1, 'Insert draws the panel on the page', JSON.stringify(reach));
    say(reach.focusedField === 'title', 'and puts the caret in its heading — Properties renders panels only for the whole block', JSON.stringify(reach));

    await page.keyboard.type('तपासणी');
    await page.keyboard.press('Tab');
    await page.waitForTimeout(2600);
    say(await page.evaluate((key) => [...document.querySelectorAll(`.newspaper-section[data-section-key="${key}"] .section-inset-panel`)]
      .some((n) => n.textContent.includes('तपासणी')), KEY), 'and what is typed there reaches the block');

    await page.evaluate(() => document.querySelector('#propPanels [data-panel-remove]')?.click());
    await page.waitForTimeout(2600);
    say(await page.evaluate((key) => document.querySelectorAll(`.newspaper-section[data-section-key="${key}"] .section-inset-panel`).length, KEY)
      === (panelsWere.was.inset_panels || []).length, 'and Remove takes it off again');

    // The 400 this net causes ON PURPOSE is not a fault: Carry over is pressed
    // above precisely to read its refusal, and a refused request is a 400 that
    // Chrome logs as a failed resource. Everything else must be silent.
    const unexpected = [...new Set(errors)].filter((e) => !/status of 400/.test(e));
    say(unexpected.length === 0, 'no console or page errors beyond the refusal this net asks for',
      JSON.stringify(unexpected.slice(0, 4)));
  } catch (error) {
    console.log(`CRASH after ${pass}/${ran} — later checks did NOT run :: ${error.message.slice(0, 200)}`);
    process.exitCode = 1;
  } finally {
    // Put the paper's faces and the block's panels back, whatever happened.
    try {
      if (paperWas) {
        await page.evaluate(async ([ed, was]) => {
          await fetch(`/api/newspapers/${ed}/house-style`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ bodyFamily: was.bodyFamily || 'serif', displayFamily: was.displayFamily || 'sans' }),
          });
        }, [ED, paperWas]);
      }
      if (panelsWere) {
        await page.evaluate(async ([pageId, key, was]) => {
          await fetch(`/api/pages/${pageId}/sections/${encodeURIComponent(key)}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              kicker: was.kicker || '', headline: was.headline || '', subheading: was.subheading || '',
              body: was.body || '', caption: was.caption || '', reporterName: was.reporter_name || '',
              category: was.category || '', location: was.location || '', tags: was.tags || [],
              headlineFontPx: was.headline_font_px, subheadingFontPx: was.subheading_font_px,
              bodyFontPx: was.body_font_px, lineHeight: was.line_height, textAlign: was.text_align,
              marginPx: was.margin_px, columnCount: was.column_count ?? 0,
              borderStyle: was.border_style || 'none', borderWidthPx: Number(was.border_width_px) || 1,
              backgroundColor: was.background_color, headlineStyle: was.headline_style || 'plain',
              dropCapLines: was.drop_cap_lines || 0,
              smartCardKey: was.smart_card_key || null, smartCardData: was.smart_card_data || null,
              insetPanels: was.inset_panels || [],
            }),
          });
        }, [panelsWere.pageId, KEY, panelsWere.was]);
      }
    } catch { /* the restore is best-effort; the tally below is what matters */ }
    console.log(`${pass}/${ran} passed`);
    await browser.close();
  }
})();
