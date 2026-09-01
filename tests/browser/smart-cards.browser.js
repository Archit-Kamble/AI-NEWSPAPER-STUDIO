// SMART CARDS, DRAWN AT THEIR OWN SIZE AND PLACED IN THEIR OWN BLOCK.
//
// `npm test` can ask layoutSmartCard() whether a card FITS, and it does. What
// it cannot see is the browser drawing something wider or taller than the
// answer it was given - which is exactly what kept happening:
//
//   - the almanac's cells carried an `em` padding the solver knew nothing
//     about, so it reported FITS with every value on one line while the
//     browser wrapped one and pushed the last row off the block;
//   - the notice's copy sat in a grid whose `auto` track sized to a nowrap
//     line's full min-content width, so every paragraph ran 11 px past the
//     rule (measured: container 382 px, line box 401 px);
//   - the rate table's change column rendered 40 px inside a 29 px row and
//     bled through into the row below, on every row.
//
// So this draws each card at the block it asks for and measures the DOM: it
// must fit, and nothing inside it may cross its own edges. Then it drives the
// half a desk actually presses - generate, accept, and the card arrives as a
// new block with its data already in it.
//
//   node tests/browser/smart-cards.browser.js            # defaults to 49291
const { chromium } = require('playwright-core');

const ED = Number(process.argv[2] || 49291);
const BASE = process.env.SAHAS_BASE || 'http://localhost:3000';

let pass = 0;
let ran = 0;
const say = (ok, name, detail = '') => {
  ran += 1;
  if (ok) pass += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` :: ${detail}` : ''}`);
};

// Payloads for the cards a provider writes, so this net costs no AI call and
// still runs when the account's quota is used up. Feed and computed cards are
// built live against the real endpoints.
const FIXTURES = {
  "suvichar": {
    "text": "प्रयत्न आणि सातत्य हीच यशाची खरी किल्ली आहे; थांबलेला प्रवास कधीच शिखरावर पोहोचत नाही.",
    "attribution": "स्वामी विवेकानंद"
  },
  "rashi": {
    "signs": [
      {
        "key": "mesh",
        "name": "मेष",
        "text": "कामाच्या ठिकाणी नवीन संधी मिळतील. कुटुंबात आनंदी वातावरण राहील.",
        "luckyNumber": 9,
        "luckyColour": "लाल"
      },
      {
        "key": "vrishabh",
        "name": "वृषभ",
        "text": "आर्थिक व्यवहारात सावधता ठेवा. सहकाऱ्यांचे उत्तम सहकार्य लाभेल.",
        "luckyNumber": 6,
        "luckyColour": "पांढरा"
      },
      {
        "key": "mithun",
        "name": "मिथुन",
        "text": "संवादकौशल्यामुळे प्रलंबित कामे पूर्ण होतील. आरोग्याची काळजी घ्या.",
        "luckyNumber": 5,
        "luckyColour": "हिरवा"
      },
      {
        "key": "kark",
        "name": "कर्क",
        "text": "कौटुंबिक विषयात सकारात्मक निर्णय होतील. मन प्रसन्न आणि शांत राहील.",
        "luckyNumber": 2,
        "luckyColour": "चंदेरी"
      }
    ]
  },
  "advert": {
    "advertiser": "श्री गणेश ट्रेडर्स, सातारा",
    "headline": "शेती अवजारे व ठिबक संच",
    "subheadline": "विक्री, बसवणूक आणि दुरुस्ती — एकाच ठिकाणी",
    "lines": [
      "सर्व प्रकारचे पाण्याचे पंप",
      "ठिबक व तुषार सिंचन संच",
      "अधिकृत सेवा केंद्र"
    ],
    "offer": "सर्व पंपांवर १०% सवलत · २० सप्टेंबरपर्यंत",
    "contact": "९८२२० १२३४५ / ०२१६२-२२२२२२",
    "address": "पोवई नाका, सातारा ४१५००१",
    "footer": "अटी लागू",
    "imageUrl": ""
  },
  "tender": {
    "issuer": "महाराष्ट्र शासन",
    "office": "उपजिल्हाधिकारी (भूसंपादन) क्र. २१, कृष्णा खोरे सातारा यांचे कार्यालय",
    "email": "slaono21satara@gmail.com",
    "address": "भूसंपादन भवन, कोषागार कार्यालय शेजारी सातारा",
    "reference": "क्रमांक: भूसं/कृखो/एसआर-२७८/२०१९",
    "date": "सातारा. दिनांक- १३/०८/२०२६",
    "subject": "भुमि संपादन अधिनियम २०१३ कलम २१ पोटकलम १ व २ अन्वये प्रसिध्द करावयाचे",
    "noticeTitle": "प्रकटपत्र",
    "paragraphs": [
      "यावरून जाहीररीत्या जाणीव देण्यात येत आहे की, सन २०१३ च्या भूमिसंपादन अधिनियमान्वये महाराष्ट्र शासन राजपत्र भाग एक पुणे विभागीय पुरवणी मध्ये प्रसिद्ध झालेली कलम ११ (१) प्रारंभिक अधिसूचना अन्वये मौजे सासकल ता. फलटण गावात असलेली जमीन सार्वजनिक कारणासाठी ताब्यात घेण्यात येणार आहे.",
      "तरी सदरहू जमिनीत हितसंबंध असलेल्या सर्व इसमांस यावरून फर्मविण्यात येते की, त्यांनी दिनांक २९/०९/२०२६ रोजी सकाळी ११.०० वाजता स्वतः अगर योग्य त्या मुखत्यारामार्फत हजर राहून आपापल्या हितसंबंधाचा प्रकार व तपशील द्यावा."
    ],
    "tableTitle": "परिशिष्ट",
    "tableGroups": [
      "गाव- सासकल",
      "तालुका - फलटण",
      "जिल्हा - सातारा"
    ],
    "table": {
      "headers": [
        "अ. क्र.",
        "गट क्रमांक",
        "संयुक्त मोजणी हे. आर.",
        "पूर्व",
        "पश्चिम"
      ],
      "rows": [
        [
          "१",
          "३७० पै",
          "०.५३ पोख",
          "गट नं. ३७० मधील क्षेत्र",
          "निरगुडी शिव"
        ],
        [
          "२",
          "३७५ पै",
          "०.५३ पोख",
          "३८१",
          "गट नं. ३७० व निरगुडी"
        ],
        [
          "३",
          "३८१ पै",
          "०.१९ पोख",
          "मौजे गिरवी शिव",
          "३७५"
        ]
      ]
    },
    "contact": "",
    "place": "सातारा",
    "noticeDate": "१७/०८/२०२६",
    "signatory": "प्रवीण साळुंके",
    "signatoryDesignation": "उपजिल्हाधिकारी",
    "signatoryOffice": "भूसंपादन क्र. २१ (कृखो) सातारा",
    "footerNote": "जिमाका /सातारा / जा / १५९ २०२६ २०२७"
  }
};

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || '/usr/bin/google-chrome' });
  const page = await browser.newPage({ viewport: { width: 1512, height: 950 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(`console: ${m.text().slice(0, 160)}`); });
  page.on('dialog', (d) => d.accept());

  let addedKey = null;
  let pageId = null;
  try {
    await page.goto(BASE); await page.waitForTimeout(800);
    if (await page.locator('#email').count()) {
      await page.fill('#email', 'admin@esahas.com');
      await page.fill('#password', 'admin123');
      await page.click('#loginBtn');
    }
    await page.waitForSelector('.edition-row', { timeout: 20000 });
    const when = await page.evaluate((ed) => fetch(`/api/newspapers/${ed}`).then((r) => r.json())
      .then((n) => String(n.publication_date).slice(0, 10)), ED);
    await page.fill('#editionSearch', when); await page.waitForTimeout(700);
    await page.locator(`.edition-row[data-edition-id="${ED}"] .edition-open`).click();
    await page.waitForSelector('#canvasSurface', { timeout: 20000 });
    await page.evaluate((ed) => { window.__ed = ed; }, ED);
    await page.waitForTimeout(3500);

    // ---- every card, at the block it asks for ------------------------------
    const drawn = await page.evaluate(async ([fixtures, date]) => {
      const { layoutSmartCard, smartCardBlockSize, SMART_CARD_LAYOUT_KEYS } = await import('/editor/smart-cards/layout.js');
      const { smartCardMarkup } = await import('/editor/smart-cards/smart-cards.js');
      const { ensureFontsLoaded } = await import('/editor/compose/font-metrics.js');
      const { ensureShaperReady } = await import('/editor/compose/shaper.js');
      await Promise.all([ensureFontsLoaded(), ensureShaperReady()]);

      const host = document.createElement('div');
      // THE HOST MUST CARRY THE PAGE'S OWN FACE.
      //
      // A bare div appended to <body> inherits the admin chrome's Arial, and
      // every card this net drew was therefore measured in a font the paper
      // does not print in - measured on the almanac's राहुकाळ value, 86.8px in
      // Arial against 80.7px in the publication serif, which is enough to wrap
      // a line the solver set flush and to report an overflow the real page
      // does not have. `.newspaper-canvas` is where styles.css sets the
      // publication face, so the host wears that class.
      host.className = 'newspaper-canvas';
      host.style.cssText = 'position:fixed;left:-9999px;top:0;background:#fff;border:0';
      document.body.appendChild(host);

      const out = [];
      for (const key of SMART_CARD_LAYOUT_KEYS) {
        if (key === 'sudoku-solution' || key === 'chart') continue;
        let card = fixtures[key] || null;
        if (!card) {
          try {
            const built = await fetch(`/api/features/${key}`, {
              method: 'POST', headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ date }),
            }).then((r) => r.json());
            card = built && built.card ? built.card : null;
            if (!card) { out.push({ key, skipped: built?.error ? 'refused' : 'no data' }); continue; }
          } catch (e) { out.push({ key, skipped: e.message.slice(0, 40) }); continue; }
        }
        const size = smartCardBlockSize(key);
        const frame = { width: size.width, height: size.height, padding: 1 };
        const solved = layoutSmartCard(key, card, frame);
        const box = document.createElement('div');
        box.style.cssText = `width:${frame.width}px;height:${frame.height}px;position:relative;background:#fff`;
        box.innerHTML = smartCardMarkup(key, card, frame) || '';
        host.appendChild(box);
        const bb = box.getBoundingClientRect();
        let worstRight = 0;
        let worstBottom = 0;
        let culprit = '';
        for (const el of box.querySelectorAll('*')) {
          const r = el.getBoundingClientRect();
          if (r.width === 0 && r.height === 0) continue;
          const dr = r.right - bb.right;
          const db = r.bottom - bb.bottom;
          if (dr > worstRight || db > worstBottom) {
            if (dr > worstRight) worstRight = dr;
            if (db > worstBottom) worstBottom = db;
            culprit = `${String(el.className || el.tagName).slice(0, 34)} "${(el.textContent || '').trim().slice(0, 18)}"`;
          }
        }
        out.push({
          key,
          fitState: solved.fitState,
          fontPx: solved.fontPx,
          right: Math.round(worstRight),
          bottom: Math.round(worstBottom),
          culprit,
          markup: box.innerHTML.length,
        });
        box.remove();
      }
      host.remove();
      return out;
    }, [FIXTURES, when]);

    for (const card of drawn) {
      if (card.skipped) { console.log(`SKIP  ${card.key} — ${card.skipped}`); continue; }
      say(card.markup > 0, `${card.key}: draws something`);
      say(card.fitState === 'FITS', `${card.key}: fits the block it asks for`, `${card.fitState} @ ${card.fontPx}px`);
      // ONE PIXEL of tolerance, for a sub-pixel border rounding - not more. A
      // card that runs past its own block prints past its own block.
      say(card.right <= 1 && card.bottom <= 1,
        `${card.key}: and nothing it draws crosses that block's edges`,
        `right +${card.right} bottom +${card.bottom} ${card.culprit}`);
    }

    // ---- the card brings its own block, already filled ---------------------
    await page.locator('.newspaper-section').first().click();
    await page.waitForTimeout(2500);
    const before = await page.evaluate(() => document.querySelectorAll('.newspaper-section').length);
    pageId = await page.evaluate(async (ed) => (await fetch(`/api/newspapers/${ed}/pages`).then((r) => r.json()))[0].id, ED);

    say(await page.locator('#smartCardDestination').count() === 1, 'the panel asks where the card goes');
    say(await page.evaluate(() => document.querySelector('[data-card-destination].is-selected')?.dataset.cardDestination) === 'new',
      'and its default is a new block, sized for the card');

    // Behind a tab now - see assist-dock.js, and the same note in
    // workspace.browser.js. The card is unchanged; the route to it is one press.
    await page.locator('[data-assist-tab="cards"]').click();
    await page.waitForTimeout(200);
    await page.locator('[data-smart-card="panchang"]').click();
    await page.waitForTimeout(400);
    await page.locator('#smartCardGenerate').click();
    await page.waitForSelector('#smartCardAccept', { timeout: 40000 });
    say(await page.evaluate(() => Boolean(document.querySelector('#smartCardPreview .smart-card'))),
      'the proposal is reviewed as a drawn card, not as flattened text');

    await page.locator('#smartCardAccept').click();
    await page.waitForTimeout(5000);
    say(await page.evaluate(() => document.querySelectorAll('.newspaper-section').length) === before + 1,
      'accepting adds exactly one block');

    const placed = await page.evaluate(async (ed) => {
      const pages = await fetch(`/api/newspapers/${ed}/pages`).then((r) => r.json());
      const all = pages.flatMap((p) => p.sections.map((s) => ({ ...s, pageId: p.id })));
      const cards = all.filter((s) => s.smart_card_key === 'panchang' && /^block-/.test(s.section_key));
      const last = cards[cards.length - 1];
      return last ? {
        key: last.section_key, pageId: last.pageId, hasData: Boolean(last.smart_card_data),
        width: Number(last.width_px), height: Number(last.height_px),
      } : null;
    }, ED);
    addedKey = placed?.key || null;
    say(Boolean(placed), 'and that block IS the card, in the database', JSON.stringify(placed));
    say(placed?.hasData === true, 'with its structured DATA in it, never a picture of it');

    // The page's own grid has the last word - a block snaps to the column grid
    // and is clamped to the room left on the page, which is right for a
    // newspaper. What matters is that the card SETS in what it was given.
    const fits = await page.evaluate(async ([w, h, key]) => {
      const { layoutSmartCard } = await import('/editor/smart-cards/layout.js');
      const pages = await fetch(`/api/newspapers/${window.__ed}/pages`).then((r) => r.json());
      const row = pages.flatMap((p) => p.sections).find((s) => s.section_key === key);
      return layoutSmartCard('panchang', row.smart_card_data, { width: w, height: h, padding: 1 }).fitState;
    }, [placed.width, placed.height, addedKey]);
    say(fits === 'FITS', 'and the card sets in the block it was actually given', `${placed.width}x${placed.height} -> ${fits}`);

    say(await page.evaluate((key) => {
      const sec = document.querySelector(`.newspaper-section[data-section-key="${key}"]`);
      return sec ? Boolean(sec.querySelector('.smart-card')) : false;
    }, addedKey), 'and it draws on the page immediately, with nothing else to do');

    // A card this net asks for and the builder legitimately refuses answers 400
    // and Chrome logs it as a failed resource - that is the refusal path being
    // exercised, not a fault. (The fixture edition is dated 2099, so the two
    // live feeds correctly refuse a future session, and दिनविशेष has no entry
    // for that day.) Everything else must be silent.
    const unexpected = [...new Set(errors)].filter((e) => !/status of 400/.test(e));
    say(unexpected.length === 0, 'no console or page errors beyond the refusals this net asks for',
      JSON.stringify(unexpected.slice(0, 3)));
  } catch (error) {
    console.log(`CRASH after ${pass}/${ran} — later checks did NOT run :: ${error.message.slice(0, 200)}`);
    process.exitCode = 1;
  } finally {
    // The block this run made is this run's to remove.
    if (addedKey && pageId) {
      await page.evaluate(async ([p, k]) => {
        await fetch(`/api/pages/${p}/sections/${encodeURIComponent(k)}`, { method: 'DELETE' });
      }, [pageId, addedKey]).catch(() => {});
    }
    console.log(`${pass}/${ran} passed`);
    await browser.close();
  }
})();
