// TWO BLOCKS, ONE STORY - SEEING IT, AND PUTTING IT BACK.
//
// `page_sections.continued_from_section_id` had recorded this since carry-over
// was written and NOTHING under public/ had ever read the column. So a desk
// could split a story across a page turn and afterwards nothing on either
// block said the two were one story, and there was no way at all to undo it -
// `jump.service.js`'s reunite() has existed as long as carryOver() has, with
// its own route, reachable from no control in the product.
//
// None of that is visible to `npm test`: the route works and always did. What
// was missing was the door and the mark, and both are facts about a browser.
//
//   node tests/browser/story-continuation.browser.js            # defaults to 54470
//   node tests/browser/story-continuation.browser.js 51615
//
// It borrows an EMPTY editorial block, writes its own copy into it, and puts
// it back empty afterwards - including when it crashes. A net that writes into
// a real edition and dies half way leaves the next run reading its leftovers
// as the desk's own work; CLAUDE.md records that happening to five blocks of
// edition 40294.
//
// Needs playwright-core and Chrome at /usr/bin/google-chrome (CHROME_PATH
// overrides), against a running server on :3000.

const { chromium } = require('playwright-core');

const BASE = process.env.BASE || 'http://localhost:3000';
const EDITION = Number(process.argv[2]) || 54470;
let pass = 0; let fail = 0;
const check = (name, ok, detail = '') => {
  if (ok) { pass += 1; console.log(`PASS  ${name}${detail ? ` :: ${detail}` : ''}`); }
  else { fail += 1; console.log(`FAIL  ${name}${detail ? ` :: ${detail}` : ''}`); }
};

(async () => {
  const browser = await chromium.launch({
    executablePath: process.env.CHROME_PATH || '/usr/bin/google-chrome',
  });
  const page = await browser.newPage({ viewport: { width: 1512, height: 950 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e.message).slice(0, 160)));
  page.on('dialog', async (d) => { await d.accept(); });

  let borrowed = null; // { pageId, key } - restored in the finally, whatever happens

  try {
    await page.goto(BASE, { waitUntil: 'networkidle' });
    if (await page.locator('#email').count()) {
      await page.fill('#email', 'admin@esahas.com');
      await page.fill('#password', 'admin123');
      await page.click('#loginBtn');
    }
    await page.waitForSelector('.edition-row', { timeout: 25000 });

    // A block to borrow: empty, editorial, and NOT on the last page, because a
    // continuation always lands on a later one.
    const fixture = await page.evaluate(async (id) => {
      const pages = await fetch(`/api/newspapers/${id}/pages`).then((r) => r.json());
      const usable = (s) => !String(s.body || '').trim() && !String(s.headline || '').trim()
        && !['advert', 'feature'].includes(String(s.block_type || '').toLowerCase())
        && !s.feature_key && !s.smart_card_key && !s.news_item_id && !s.continued_from_section_id;
      for (const p of pages.slice(0, -1)) {
        const found = (p.sections || []).find(usable);
        // and somewhere later for it to land
        const later = pages.slice(pages.indexOf(p) + 1).some((q) => (q.sections || []).some(usable));
        if (found && later) return { pageId: p.id, pageNumber: p.page_number, key: found.section_key };
      }
      return null;
    }, EDITION);
    check('found an empty editorial block to borrow', Boolean(fixture),
      fixture ? `page ${fixture.pageNumber}, "${fixture.key}"` : 'none free in this edition');
    if (!fixture) throw new Error('no borrowable block');
    borrowed = fixture;

    // Copy long enough that it cannot fit - carry-over refuses outright when
    // the story already fits, and rightly.
    const wrote = await page.evaluate(async ({ pageId, key }) => {
      const line = 'साताऱ्यातील नागरिकांनी आज सकाळी जिल्हाधिकारी कार्यालयासमोर आंदोलन केले. '
        + 'पाणीपुरवठा योजनेचे काम गेल्या दोन वर्षांपासून रखडले असल्याचा आरोप आंदोलकांनी केला. ';
      const body = line.repeat(14);
      const r = await fetch(`/api/pages/${pageId}/sections/${encodeURIComponent(key)}`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ body, headline: 'पाणी योजनेसाठी आंदोलन', status: 'ready' }),
      });
      return { ok: r.ok, length: body.length };
    }, fixture);
    check('wrote a story too long for it', wrote.ok, `${wrote.length} characters`);

    // The list shows the twelve most recent editions and its search matches
    // the DATE and the name, never the id - so the edition is looked up first
    // and found by its own publication date.
    const when = await page.evaluate(async (id) => {
      const paper = await fetch(`/api/newspapers/${id}`).then((r) => r.json());
      return String(paper.publication_date || '').slice(0, 10);
    }, EDITION);
    await page.fill('#editionSearch', when);
    await page.waitForSelector(`.edition-row[data-edition-id="${EDITION}"]`, { timeout: 15000 });
    await page.locator(`.edition-row[data-edition-id="${EDITION}"] .edition-open`).click();
    await page.waitForSelector('.workspace-shell', { timeout: 60000 });
    await page.waitForTimeout(2500);

    const goToPage = async (pageId) => {
      await page.click(`.page-pill[data-page-id="${pageId}"]`);
      await page.waitForTimeout(2000);
    };
    const block = (key) => `.newspaper-section[data-section-key="${key}"]`;

    await goToPage(fixture.pageId);
    await page.waitForSelector(block(fixture.key), { timeout: 15000 });
    await page.click(block(fixture.key));
    await page.waitForTimeout(1200);

    check('Reunite is OFF on a block nothing carries on from',
      await page.locator('#reuniteBtn').isDisabled());
    check('  and its title says which block to select',
      /Select the block/.test(await page.locator('#reuniteBtn').getAttribute('title') || ''));
    check('no jump mark on an ordinary block',
      await page.locator(`${block(fixture.key)} .flag-continues`).count() === 0);

    // --- carry it over -----------------------------------------------------
    await page.click('#carryOverBtn');
    await page.waitForTimeout(6000);
    const split = await page.evaluate(async ({ id, key }) => {
      const pages = await fetch(`/api/newspapers/${id}/pages`).then((r) => r.json());
      let src = null;
      for (const p of pages) for (const s of p.sections) if (s.section_key === key && String(s.body || '').trim()) src = s;
      let leg = null;
      for (const p of pages) for (const s of p.sections) {
        if (Number(s.continued_from_section_id) === Number(src?.id)) leg = { pageId: p.id, pageNumber: p.page_number, key: s.section_key };
      }
      return { leg, srcLen: (src?.body || '').length };
    }, { id: EDITION, key: fixture.key });
    check('the story really split', Boolean(split.leg),
      split.leg ? `leg on page ${split.leg.pageNumber}, "${split.leg.key}"` : 'no leg');
    if (!split.leg) throw new Error('carry-over did not split');

    await page.click(block(fixture.key));
    await page.waitForTimeout(1200);
    check('the source block is MARKED as continuing',
      await page.locator(`${block(fixture.key)} .flag-continues`).count() === 1);
    const flagTitle = await page.locator(`${block(fixture.key)} .flag-continues`).getAttribute('title').catch(() => '');
    check('  and the mark says where the rest of it is',
      new RegExp(`page ${split.leg.pageNumber}`).test(flagTitle || ''), flagTitle);
    check('Reunite is LIVE on it', !(await page.locator('#reuniteBtn').isDisabled()));
    check('  and its title names the other leg',
      new RegExp(`carries on into page ${split.leg.pageNumber}`).test(await page.locator('#reuniteBtn').getAttribute('title') || ''));

    await goToPage(split.leg.pageId);
    check('the LEG is marked the other way round',
      await page.locator(`${block(split.leg.key)} .flag-continued`).count() === 1);
    await page.click(block(split.leg.key));
    await page.waitForTimeout(1200);
    check('Reunite is OFF on the leg - it is not where the story starts',
      await page.locator('#reuniteBtn').isDisabled());

    // --- and put it back ---------------------------------------------------
    await goToPage(fixture.pageId);
    await page.click(block(fixture.key));
    await page.waitForTimeout(1200);
    await page.click('#reuniteBtn');
    await page.waitForTimeout(6000);

    const back = await page.evaluate(async ({ id, key, legKey }) => {
      const pages = await fetch(`/api/newspapers/${id}/pages`).then((r) => r.json());
      let src = null; let leg = null; let legs = 0;
      for (const p of pages) for (const s of p.sections) {
        if (s.section_key === key && String(s.body || '').trim()) src = s;
        if (s.section_key === legKey) leg = s;
      }
      for (const p of pages) for (const s of p.sections) if (Number(s.continued_from_section_id) === Number(src?.id)) legs += 1;
      return { len: (src?.body || '').length, legs, legLen: (leg?.body || '').length, jump: /उर्वरित पान/.test(src?.body || '') };
    }, { id: EDITION, key: fixture.key, legKey: split.leg.key });

    check('Reunite brings the copy back', back.len > split.srcLen, `${split.srcLen} -> ${back.len} characters`);
    check('  and strips the jump line nobody typed', back.jump === false);
    check('  and empties the second leg', back.legLen === 0);
    check('  and nothing points at it any more', back.legs === 0);
    check('  and the mark is gone',
      await page.locator(`${block(fixture.key)} .flag-continues`).count() === 0);
    check('  and Reunite goes back to OFF', await page.locator('#reuniteBtn').isDisabled());
    const notice = await page.evaluate(() => document.getElementById('deskNotice')?.innerText || '');
    check('  and the desk is told what happened', /back into one block/i.test(notice), notice.slice(0, 80));

    console.log('\npage errors:', errors.length ? errors.join(' | ') : 'none');
  } catch (error) {
    console.log('CRASH ::', error.message);
    fail += 1;
  }

  // The borrowed block goes back empty however this ended. Reachable from the
  // crash path deliberately - CLAUDE.md records a net that only restored on
  // success leaving five blocks of a real edition carrying sizes nobody chose.
  if (borrowed) {
    try {
      await page.evaluate(async ({ pageId, key }) => {
        await fetch(`/api/pages/${pageId}/sections/${encodeURIComponent(key)}`, {
          method: 'PUT', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ body: '', headline: '', subheading: '', status: 'empty' }),
        });
      }, borrowed);
      console.log(`restored page ${borrowed.pageNumber}, "${borrowed.key}" to empty`);
    } catch { console.log('COULD NOT RESTORE', JSON.stringify(borrowed)); }
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  await browser.close();
  process.exit(fail ? 1 : 0);
})();
