// Read-only browser/canonical occupancy probe for a disposable edition.
// It measures DOM boxes; it never uses OCR and never writes the edition.
const fs = require('fs');
const { chromium } = require('playwright-core');

const EDITION = Number(process.argv[2]);
const OUTPUT = process.argv[3] || '/tmp/sahas-rendered-occupancy.json';
const BASE = process.env.SAHAS_BASE || 'http://localhost:3000';
const CHROME = process.env.CHROME_PATH || '/usr/bin/google-chrome';
if (!EDITION) throw new Error('usage: node scripts/probe-rendered-occupancy.js <editionId> [output.json]');

const prose = new Set(['LEAD', 'SECONDARY', 'STANDARD', 'ANALYSIS', 'OPINION', 'BRIEF', 'SIDEBAR']);
const exempt = new Set(['ADVERTISEMENT', 'SMART_CARD', 'QUOTE', 'DATA', 'PHOTO_FEATURE']);
const plain = (value) => String(value || '').trim();

function statusFor(section, canonical) {
  const type = String(section.story_type || 'STANDARD').toUpperCase();
  if (!prose.has(type) || exempt.has(type) || section.feature_key || section.smart_card_key || section.block_type === 'advert') return 'STRUCTURED_OR_AD_EXEMPT';
  if (type === 'BRIEF' || type === 'SIDEBAR') return 'BRIEF_EXPECTED';
  // The saved section deliberately has no source body. This classification is
  // observational; composition reports add source-scale status separately.
  return canonical.authoredBodyFillRatio >= 0.7 ? 'VISUALLY_FILLED' : 'VISUALLY_UNDERFILLED';
}

(async () => {
  const flow = await import('../public/editor/layout/text-flow.js');
  const browser = await chromium.launch({ executablePath: CHROME, args: ['--no-sandbox'] });
  const context = await browser.newContext({ viewport: { width: 1512, height: 950 } }); const page = await context.newPage();
  try {
    await page.goto(BASE); await page.waitForTimeout(500);
    if (await page.locator('#email').count()) { await page.fill('#email', 'admin@esahas.com'); await page.fill('#password', 'admin123'); await page.click('#loginBtn'); }
    await page.waitForSelector('.edition-row', { timeout: 20000 });
    const edition = await page.evaluate((id) => fetch(`/api/newspapers/${id}`).then((r) => r.json()), EDITION);
    const pages = await page.evaluate((id) => fetch(`/api/newspapers/${id}/pages`).then((r) => r.json()), EDITION);
    await page.fill('#editionSearch', String(edition.publication_date).slice(0, 10)); await page.waitForTimeout(300);
    await page.locator(`.edition-row[data-edition-id="${EDITION}"] button`).click(); await page.waitForSelector('#canvasSurface', { timeout: 20000 });
    await page.locator('#printViewBtn').click(); await page.selectOption('#zoomSelect', 'fit');
    const rows = [];
    for (const persistedPage of pages) {
      await page.locator(`.page-pill[data-page-id="${persistedPage.id}"]`).click().catch(async () => page.locator('.page-pill').nth(persistedPage.page_number - 1).click());
      await page.waitForTimeout(350);
      for (const section of persistedPage.sections || []) {
        const type = String(section.story_type || 'STANDARD').toUpperCase();
        if (!prose.has(type) || exempt.has(type) || section.feature_key || section.smart_card_key || section.block_type === 'advert') continue;
        const dom = await page.locator(`.newspaper-section[data-section-key="${section.section_key}"]`).evaluate((el) => {
          const rect = el.getBoundingClientRect(); const scale = rect.width / Number(el.style.width.replace('px', '') || rect.width);
          const bands = [...el.querySelectorAll('.section-flowed-band, .section-kicker, .section-headline, .section-subheading')]
            .filter((node, index, all) => all.indexOf(node) === index).map((node) => node.getBoundingClientRect());
          const flowed = [...el.querySelectorAll('.section-flowed:not(.section-flowed-band)')].map((node) => node.getBoundingClientRect());
          const normalBody = el.querySelector('.section-body')?.getBoundingClientRect();
          const toRaw = (box) => ({ top: (box.top - rect.top) / scale, bottom: (box.bottom - rect.top) / scale, height: box.height / scale });
          const rawBands = bands.map(toRaw); const rawBody = flowed.length ? flowed.map(toRaw) : (normalBody ? [toRaw(normalBody)] : []);
          const bodyTop = rawBody.length ? Math.min(...rawBody.map((box) => box.top)) : null;
          const bodyBottom = rawBody.length ? Math.max(...rawBody.map((box) => box.bottom)) : null;
          const padding = Number(getComputedStyle(el).paddingTop.replace('px', '')) || 0;
          const contentBottom = Number(el.style.height.replace('px', '')) - padding;
          return { renderedSectionHeight: Number(el.style.height.replace('px', '')), renderedHeadlineDeckKickerHeight: rawBands.reduce((sum, box) => sum + box.height, 0), renderedBodyRegionHeight: bodyTop === null ? 0 : Math.max(0, contentBottom - bodyTop), renderedBodyTextHeight: bodyTop === null ? 0 : Math.max(0, bodyBottom - bodyTop), remainingVerticalBodySpace: bodyTop === null ? contentBottom : Math.max(0, contentBottom - bodyBottom), bodyRunCount: rawBody.length, bodyRenderer: flowed.length ? 'flowed' : normalBody ? 'columns' : 'none' };
        }).catch(() => null);
        const canonical = flow.measureSectionFlow(section);
        rows.push({ page: persistedPage.page_number, sectionKey: section.section_key, storyType: type, ...dom, canonical: {
          bodyCharBudget: canonical.bodyCharBudget, fixedBodyPrefixChars: canonical.fixedBodyPrefixChars, writableBodyCharBudget: canonical.writableBodyCharBudget,
          authoredBodyCharsUsed: canonical.authoredBodyCharsUsed, totalBodyCharsUsed: canonical.totalBodyCharsUsed,
          authoredBodyFillRatio: canonical.authoredBodyFillRatio, physicalBodyFillRatio: canonical.physicalBodyFillRatio,
        }, visualBodyFillRatio: dom?.renderedBodyRegionHeight ? Number((dom.renderedBodyTextHeight / dom.renderedBodyRegionHeight).toFixed(4)) : 0, visualStatus: statusFor(section, canonical) });
      }
    }
    const result = { edition: { id: edition.id, date: String(edition.publication_date).slice(0, 10) }, rows };
    fs.writeFileSync(OUTPUT, JSON.stringify(result, null, 2)); console.log(JSON.stringify(result, null, 2));
  } finally { await browser.close(); }
})().catch((error) => { console.error(error); process.exit(1); });
