// Isolated frontend proof: no login, database, live feed, or saved edition.
const assert = require('node:assert/strict');
const express = require('express');
const path = require('node:path');
const { chromium } = require('playwright-core');

async function assertVisibleTextIsContained(page, selector) {
  const overflow = await page.locator(selector).evaluateAll((cards) => cards.flatMap((card) => {
      const cardRect = card.getBoundingClientRect();
      const design = card.dataset.design || 'legacy';
    const walker = document.createTreeWalker(card, NodeFilter.SHOW_TEXT);
    const faults = [];
    let node;
    while ((node = walker.nextNode())) {
      const text = node.nodeValue.trim();
      if (!text) continue;
      const range = document.createRange(); range.selectNode(node);
      for (const rect of range.getClientRects()) {
        if (!rect.width || !rect.height) continue;
        const tolerance = 0.75;
        if (rect.left < cardRect.left - tolerance || rect.right > cardRect.right + tolerance
          || rect.top < cardRect.top - tolerance || rect.bottom > cardRect.bottom + tolerance) {
          faults.push({ design, text: text.slice(0, 36), left: rect.left - cardRect.left, right: rect.right - cardRect.left,
            top: rect.top - cardRect.top, bottom: rect.bottom - cardRect.top, width: cardRect.width, height: cardRect.height });
        }
      }
    }
    for (const element of card.querySelectorAll('i, img')) {
      const rect = element.getBoundingClientRect();
      if (!rect.width || !rect.height) continue;
      const tolerance = 0.75;
      if (rect.left < cardRect.left - tolerance || rect.right > cardRect.right + tolerance
        || rect.top < cardRect.top - tolerance || rect.bottom > cardRect.bottom + tolerance) {
        faults.push({ design, ink: element.tagName.toLowerCase(), left: rect.left - cardRect.left, right: rect.right - cardRect.left,
          top: rect.top - cardRect.top, bottom: rect.bottom - cardRect.top, width: cardRect.width, height: cardRect.height });
      }
    }
    return faults;
  }));
  assert.deepEqual(overflow, [], `visible text must remain inside its solved Smart Card frame: ${JSON.stringify(overflow)}`);
}

(async () => {
  const app = express();
  app.get('/design-fixture', (_req, res) => res.send(`<!doctype html><html><head>
    <meta charset="utf-8"><link rel="stylesheet" href="/styles.css">
    <style>
      body{display:block;padding:24px;background:#eeeae5;color:#1f1d1d}main{max-width:1120px;margin:auto;background:#fff;padding:28px}
      h1{font:700 25px Georgia;margin:0}.deck{font:15px Georgia;color:#665d5a;margin:5px 0 18px}#notice{min-height:24px}
      #gallery{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:18px;margin-top:24px}.sample h3{font:700 15px Georgia;margin:0 0 7px}.sample .smart-card{width:100%;height:340px}
      #standing{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:18px;margin-top:28px;padding-top:18px;border-top:1px solid #cfc6c0}.standing-card h2{font:700 16px Georgia;margin:0 0 8px}.standing-card .smart-card{height:300px}
      @media(max-width:700px){body{padding:8px}main{padding:14px}#gallery,#standing{grid-template-columns:1fr}.sample .smart-card{height:320px}}
    </style></head><body><main><h1>SAHAS · Market desk proof</h1><p class="deck">Dense closing board, monthly trend, and adjacent daily features — a print composition, not a colour skin.</p>
    <div id="cardDesignHost"></div><p id="notice" role="status"></p><div id="gallery"></div><section id="standing" aria-label="Standing daily features"></section></main>
    <script type="module">
      import {cardDesignPicker,bindSmartCard,refreshCardDesignPicker} from '/editor/external-editor/smart-card-panel.js';
      import {smartCardMarkup} from '/editor/smart-cards/smart-cards.js';
      import {designsForCard} from '/editor/smart-cards/designs.js';
      import {ensureFontsLoaded} from '/editor/compose/font-metrics.js';
      import {ensureShaperReady} from '/editor/compose/shaper.js';
      import {setEdition,setSelectedSection,getDraft,updateDraft} from '/editor/store.js';
      await Promise.all([ensureFontsLoaded(),ensureShaperReady(),document.fonts.ready]);
      const data={title:'शेअर / सोने बाजार',asOf:'बंद भाव · ६ सप्टेंबर · प्रत्यक्ष बाजारभाव नाहीत',items:[
        {label:'सेन्सेक्स',value:'८१,२००',change:'+०.५%',direction:'up',group:'index'},
        {label:'निफ्टी',value:'२४,८००',change:'−०.२%',direction:'down',group:'index'},
        {label:'बँक निफ्टी',value:'५१,४२०',change:'+०.७%',direction:'up',group:'index'},
        {label:'सोने',value:'७२,४००',change:'+०.३%',direction:'up',group:'bullion'},
        {label:'चांदी',value:'९१,६००',change:'−०.१%',direction:'down',group:'bullion'}],
        trend:{values:[79820,80340,80110,80660,81200],from:'२ सप्टेंबर',to:'६ सप्टेंबर'},source:'स्रोत : डिझाइन चाचणी नमुना'};
      const quote={text:'प्रयत्न हीच यशाची किल्ली आहे; प्रत्येक दिवस नवी संधी घेऊन येतो.',attribution:'संपादकीय'};
      const panchang={items:[{label:'सूर्योदय',text:'०६:२१'},{label:'सूर्यास्त',text:'१८:४२'},{label:'दिनमान',text:'१२ तास २१ मिनिटे'},{label:'राहुकाळ',text:'१०:३० ते १२:००'},{label:'तिथी',text:'शुक्ल पक्ष पंचमी'},{label:'शके',text:'१९४८'}]};
      const rashi={signs:[{key:'mesh',name:'मेष',text:'आज कामात यश मिळेल. आत्मविश्वासाने पुढे जा.',luckyNumber:9,luckyColour:'लाल'},{key:'vrishabh',name:'वृषभ',text:'आर्थिक निर्णयात विचारपूर्वक पाऊल टाका.',luckyNumber:6,luckyColour:'पांढरा'},{key:'mithun',name:'मिथुन',text:'संवादातून नवे मार्ग सापडतील.',luckyNumber:5,luckyColour:'हिरवा'}]};
      const section={section_key:'market',width_px:260,height_px:340,margin_px:1}; const view={smartCardKey:'market',smartCardData:data,body:'UNCHANGED',marginPx:1}; const frame={width:260,height:340,padding:1};
      setEdition({newspaper:{id:1},pages:[{id:1,sections:[section]}],reporterNews:[]}); setSelectedSection('market',view);
      document.getElementById('cardDesignHost').innerHTML=cardDesignPicker(view,frame);
      bindSmartCard(null,(patch,source)=>{updateDraft(patch,source);refreshCardDesignPicker(section,getDraft());},message=>document.getElementById('notice').textContent=message);
      document.getElementById('gallery').innerHTML=designsForCard('market').map(design=>'<div class="sample"><h3>'+design.label+'</h3>'+smartCardMarkup('market',{...data,design:design.key},frame)+'</div>').join('');
      document.getElementById('standing').innerHTML='<div class="standing-card"><h2>आजचा सुविचार</h2>'+smartCardMarkup('suvichar',{...quote,design:"quote-led"},{width:260,height:300,padding:1})+'</div><div class="standing-card"><h2>आजचे पंचांग</h2>'+smartCardMarkup('panchang',{...panchang,design:"calendar-led"},{width:260,height:300,padding:1})+'</div><div class="standing-card"><h2>आजचे राशिभविष्य</h2>'+smartCardMarkup('rashi',{...rashi,design:"zodiac-capsules"},{width:260,height:300,padding:1})+'</div>';
      window.designProof={getDraft,section,data}; document.documentElement.dataset.ready='true';
    </script></body></html>`));
  app.use(express.static(path.join(__dirname, '../../public')));
  const server = await new Promise(resolve => { const server = app.listen(0, '127.0.0.1', () => resolve(server)); });
  let browser;
  try {
    browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || '/usr/bin/google-chrome', headless: true });
    const page = await browser.newPage({ viewport: { width: 1200, height: 1180 } });
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    await page.goto(`http://127.0.0.1:${server.address().port}/design-fixture`);
    await page.waitForSelector('html[data-ready="true"]');
    assert.equal(await page.locator('#gallery > .sample > .smart-card-market').count(), 3);
    assert.equal(await page.locator('#gallery > .sample > .smart-card-market[data-design="chart-led"] svg').count(), 1,
      'the chart bulletin, and only the chart bulletin, renders the sourced market trend');
    assert.equal(await page.locator('#standing .smart-card[data-design="quote-led"]').count(), 1, 'full quote is present beside the panchang');
    assert.equal(await page.locator('#standing .smart-card[data-design="calendar-led"]').count(), 1, 'full panchang is present beside the quote');
    assert.equal(await page.locator('#standing .smart-card[data-design="zodiac-capsules"] img').count(), 3,
      'the Rashi feature uses the three real zodiac artworks, not generic icons');
    // Classic is intentionally the pre-existing renderer and is covered by its
    // own regression net. This check guards the NEW opt-in compositions only.
    await assertVisibleTextIsContained(page, '#gallery > .sample > .smart-card[data-design]:not([data-design="classic"]), #standing .smart-card[data-design]:not([data-design="classic"])');
    assert.ok(await page.locator('.card-design-preview').first().evaluate(el => {
      const sheet = el.querySelector('.advert-style-sheet'); return Math.abs(sheet.getBoundingClientRect().width - el.getBoundingClientRect().width) < 1;
    }), 'preview scales the complete logical card rather than clipping it');
    for (const design of ['lead-index', 'chart-led', 'classic']) {
      await page.locator(`[data-card-design="${design}"]`).click();
      assert.equal(await page.locator(`[data-card-design="${design}"]`).getAttribute('aria-pressed'), 'true');
      const current = await page.evaluate(() => ({ draft: window.designProof.getDraft(), data: window.designProof.data }));
      assert.equal(current.draft.smartCardData.design, design);
      assert.deepEqual(current.draft.smartCardData.items, current.data.items);
      assert.equal(current.draft.body, 'UNCHANGED');
    }
    await page.locator('[data-card-design="chart-led"]').focus(); await page.keyboard.press('Enter');
    assert.equal(await page.locator('[data-card-design="chart-led"]').getAttribute('aria-pressed'), 'true');
    await page.screenshot({ path: '/tmp/sahas-smart-card-designs.png', fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });
    assert.ok(await page.locator('.card-design-picker').evaluate(el => el.scrollWidth <= el.clientWidth + 1));
    assert.deepEqual(errors, []);
    console.log('PASS: interactive market compositions, dense trend feed, quote/panchang proof, preserved draft. Screenshot: /tmp/sahas-smart-card-designs.png');
  } finally { await browser?.close(); await new Promise(resolve => server.close(resolve)); }
})().catch(error => { console.error(error); process.exitCode = 1; });
