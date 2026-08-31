// THE E-PAPER AS THE PUBLIC MEETS IT.
//
// Everything below was found by opening the newsroom's own released issue on a
// phone-sized screen and looking at it. None of it is visible from the code,
// and all of it is visible to every reader who follows the share link.

require('dotenv').config();
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const pool = require('../src/config/db');
const epaper = require('../src/services/epaper.service');

test.after(() => pool.end());

const SNAPSHOT = {
  edition: {
    title: 'दैनिक साहस वार्ता', date: '2099-12-31', dateLine: '३१ डिसेंबर २०९९, गुरुवार',
    district: 'सातारा', volumeLine: 'वर्ष ८५ । अंक ३६५', pdfUrl: '',
  },
  pages: [
    {
      number: 1, imageUrl: '/uploads/epaper/1/page-1.png', imageWidth: 1200, imageHeight: 1800,
      articles: [
        { id: 1, sectionKey: 'lead', headline: 'पहिल्या पानाची बातमी', body: 'पहिल्या पानाचा मजकूर.',
          hotspot: { leftPct: 5, topPct: 5, widthPct: 40, heightPct: 20 } },
        { id: 'manual-a', sectionKey: 'manual-a', headline: 'New news block', body: '', manual: true,
          hotspot: { leftPct: 50, topPct: 5, widthPct: 40, heightPct: 20 } },
      ],
    },
    {
      number: 2, imageUrl: '/uploads/epaper/1/page-2.png', imageWidth: 1200, imageHeight: 1800,
      articles: [
        { id: 2, sectionKey: 'second', headline: 'दुसऱ्या पानाची बातमी', body: 'दुसऱ्या पानाचा मजकूर.',
          hotspot: { leftPct: 5, topPct: 5, widthPct: 40, heightPct: 20 } },
      ],
    },
  ],
};

const html = () => epaper.renderHtml(SNAPSHOT);

test('the reader sees ONE page, so it reads ONE page\'s stories', () => {
  const page = html();

  // Every page's transcript is in the document - it has to be, so the text is
  // searchable and indexable - but only the one being read is SHOWN, hidden
  // with the sheet it belongs to and revealed with it.
  assert.match(page, /data-transcript-page="1"/);
  assert.match(page, /data-transcript-page="2"/);
  const first = page.match(/<section class="transcript-page" data-transcript-page="1"[^>]*>/)[0];
  const second = page.match(/<section class="transcript-page" data-transcript-page="2"[^>]*>/)[0];
  assert.ok(!/hidden/.test(first), 'page one opens shown');
  assert.ok(/hidden/.test(second), 'and every other page opens hidden');

  // The intro no longer promises the whole edition below every sheet.
  assert.match(page, /Stories on this page/);
  assert.doesNotMatch(page, /Stories in this edition/);
});

test('a manually mapped block is a hotspot, never a story with nothing under it', () => {
  const page = html();

  // THE HOTSPOT REMAINS - it is a tappable region over a page somebody else
  // designed, and that is what the Map blocks tool is for.
  assert.match(page, /class="story-hotspot"[\s\S]*?New news block/,
    'the manual block keeps its region on the page image');

  // AND IT IS NOT PRINTED AS AN ARTICLE. Measured on this newsroom's own
  // released issue: TEN of these, every one reading "New news block", each
  // with an "Open share card" button and no story under it.
  const transcripts = page.match(/<article class="story-transcript"[\s\S]*?<\/article>/g) || [];
  assert.equal(transcripts.length, 2, 'one real story per page, and no manual blocks');
  assert.ok(!transcripts.some((entry) => /New news block/.test(entry)));

  // A NEWSROOM BLOCK KEEPS ITS ENTRY. `manual` is the discriminator because it
  // is the true one - it says where the block came from, and no amount of
  // reading the headline could tell the two apart.
  assert.ok(transcripts.some((entry) => /पहिल्या पानाची बातमी/.test(entry)));
});

test('a page whose text is not carried separately says so, once', () => {
  const onlyManual = {
    ...SNAPSHOT,
    pages: [{ ...SNAPSHOT.pages[0], articles: [SNAPSHOT.pages[0].articles[1]] }],
  };
  const page = epaper.renderHtml(onlyManual);
  assert.match(page, /class="transcript-none"/);
  assert.match(page, /published as a finished PDF/);
  // And it still says it exactly once - not once per block that has no text.
  assert.equal((page.match(/class="transcript-none"/g) || []).length, 1);
});

test('the nameplate carries the lion, so the header does not carry it twice', () => {
  const page = html();
  // A 42px circle cropped out of the nameplate image itself, with a red sliver
  // of the वा of वार्ता caught in its edge, sitting beside the real one. The
  // artwork sets the mark; setting it a second time is not a mark but a mistake.
  assert.doesNotMatch(page, /reader-lion-mark/);
  const css = fs.readFileSync('public/epaper.css', 'utf8');
  assert.doesNotMatch(css, /^\.reader-lion-mark\s*\{/m, 'and the rule went with the element');
  // The real nameplate is still there.
  assert.match(page, /class="reader-brand"/);
  assert.match(page, /sahas-nameplate/);
});

test('the placeholder title is not a title', () => {
  // A new manual block is created carrying "New news block", and the save check
  // asked only whether the headline was EMPTY - which it is not - so ten of
  // them saved straight through to the public reader.
  const source = fs.readFileSync('public/admin/epaper-map-editor.js', 'utf8');
  assert.match(source, /NEW_BLOCK_TITLE/, 'the placeholder is named once');
  assert.match(source, /=== NEW_BLOCK_TITLE/, 'and the save refuses it');
  // The block that carries it reads the same constant, so the two cannot drift.
  assert.match(source, /headline: NEW_BLOCK_TITLE/);
});
