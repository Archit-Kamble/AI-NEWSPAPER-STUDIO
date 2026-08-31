// THE E-PAPER AS THE PUBLIC MEETS IT, IN A BROWSER, ON A PHONE.
//
// Everything this net checks was found by opening the newsroom's own released
// issue at 430px and looking at it. None of it is visible from the code, and
// all of it is visible to every reader who follows the share link - which is
// the one page in this product that people outside the newsroom ever see.
//
//   node tests/browser/epaper-public.browser.js
//
// It needs a released issue. There is one selected or there is not; this net
// says which rather than inventing one, because publishing an edition from a
// test is not something that should be easy to do by accident.

const { chromium } = require('playwright-core');

const BASE = process.env.SAHAS_BASE || 'http://localhost:3000';
const CHROME = process.env.CHROME_PATH || '/usr/bin/google-chrome';

let pass = 0;
let fail = 0;
let crashed = null;
const check = (name, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` :: ${detail}` : ''}`);
  if (ok) pass += 1; else fail += 1;
};

(async () => {
  const browser = await chromium.launch({ executablePath: CHROME, args: ['--no-sandbox'] });
  // A PHONE, because that is what a reader following a WhatsApp link is holding.
  const context = await browser.newContext({ viewport: { width: 430, height: 900 } });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message.slice(0, 160)}`));
  page.on('console', (m) => m.type() === 'error' && errors.push(`console: ${m.text().slice(0, 160)}`));

  try {
    const response = await page.goto(`${BASE}/epaper`);
    if (response.status() === 404) {
      console.log('\nNo issue is released, so there is nothing public to check.');
      console.log('Release one from the E-paper screen and run this again.');
      await browser.close();
      process.exit(0);
    }
    check('the public reader answers', response.status() === 200, String(response.status()));
    await page.waitForTimeout(2000);

    // ------------------------------------------------- the header, once ---
    check('the header carries the paper\'s real nameplate', await page.locator('.reader-brand img').count() === 1);
    // A 42px circle cropped out of that same nameplate sat beside it, with a
    // red sliver of the वा of वार्ता caught in its edge. The artwork sets the
    // mark; setting it a second time is not a mark but a mistake.
    check('  and not a second, cropped copy of the lion in it',
      await page.locator('.reader-lion-mark').count() === 0);

    // THE NEWS STARTS NEAR THE TOP. The header gave the nameplate a whole row
    // at its natural height and the date another below it - measured at 430px,
    // 370px of a 900px screen went on furniture before a word of news, and the
    // reader met the same nameplate twice within four hundred pixels.
    const newsTop = await page.evaluate(() => {
      const image = document.querySelector('.page-image');
      return image ? Math.round(image.getBoundingClientRect().top + window.scrollY) : null;
    });
    check('the newspaper begins in the top fifth of a phone screen',
      newsTop !== null && newsTop < 200, `${newsTop}px of 900`);

    // ------------------------------------------- one page, one page's text ---
    const pages = await page.locator('[data-page-button]').count();
    check('every page has a button', pages > 0, `${pages} pages`);

    const shown = () => page.evaluate(() => ({
      sheet: [...document.querySelectorAll('.epaper-page')].filter((e) => !e.hidden).map((e) => e.dataset.page),
      text: [...document.querySelectorAll('[data-transcript-page]')].filter((e) => !e.hidden).map((e) => e.dataset.transcriptPage),
    }));

    const first = await shown();
    check('one sheet is shown', first.sheet.length === 1, first.sheet.join(','));
    check('  and exactly one page of text with it', first.text.length === 1, first.text.join(','));
    check('  and it is the same page', first.sheet[0] === first.text[0], `${first.sheet[0]} / ${first.text[0]}`);

    if (pages > 1) {
      await page.locator('[data-page-button="2"]').click();
      await page.waitForTimeout(600);
      const second = await shown();
      check('turning the page turns the text with it',
        second.sheet[0] === '2' && second.text[0] === '2', JSON.stringify(second));
      await page.locator('[data-page-button="1"]').click();
      await page.waitForTimeout(500);
    }

    // ------------------------------- a hotspot is not always a story ---
    // The Map blocks tool draws a rectangle over a page somebody ELSE designed,
    // so there is no newsroom copy behind it. Ten of them were published as ten
    // identical stories reading "New news block", each with a button offering
    // to share a story that did not exist.
    check('no story is published with the placeholder title',
      await page.locator('.story-transcript h3:text-is("New news block")').count() === 0);

    const emptyStories = await page.evaluate(() => [...document.querySelectorAll('.story-transcript')]
      .filter((article) => !article.querySelector('p:not(.kicker):not(.deck):not(.dateline)')).length);
    check('and no story is published with nothing under its headline', emptyStories === 0, `${emptyStories}`);

    // The regions themselves stay - that is what the map tool is FOR.
    const hotspots = await page.locator('.epaper-page:not([hidden]) .story-hotspot').count();
    check('the tappable regions on the page image remain', hotspots > 0, `${hotspots} on page one`);

    check('no page errors on the one page the public sees', errors.length === 0, errors[0] || 'none');
  } catch (error) {
    crashed = error;
  } finally {
    await browser.close();
    console.log(`\n${pass} passed, ${fail} failed`);
    if (crashed) {
      console.log(`CRASH (the checks after this point never ran): ${crashed.message}`);
      process.exit(1);
    }
    process.exit(fail ? 1 : 0);
  }
})();
