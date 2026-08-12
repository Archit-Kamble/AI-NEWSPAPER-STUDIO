// Project A, Phase 2: a realistic, fully-populated 4-page edition.
//
// Every whitespace/footer/balance question in the Phase 1 audit hit the same
// wall - the fixture used to check them was mostly unfilled blocks, so
// "excessive empty space" was indistinguishable from "nobody wrote anything
// here yet". This script removes that excuse: it fills every fillable block
// on a real 4-page edition (the real ladder - front/local/features/dense,
// CLAUDE.md's own rules, not a one-off template invented for this test) with
// realistic Marathi content across the story types the composition engine
// needs to prove itself against - a lead with the accent-emphasis convention,
// stories with and without subheadings, briefs, an opinion piece, a photo
// feature, a data/stat piece, adverts, structured Smart Cards, and one story
// that genuinely overflows and is carried onto a later page with a real jump
// line, using jump.service.js exactly as a sub-editor would.
//
// Deterministic and idempotent: `POST /api/newspapers/start` is idempotent
// per publication date, and every block is written with a plain PUT, not the
// AI - the wording does not matter, the geometry does, and no AI quota is
// spent building it. Safe to re-run.
//
// Usage: node scripts/build-test-edition.js  (against a running dev server on
// PORT, default 3000)

const path = require('path');
const fs = require('fs');

const PORT = process.env.PORT || 3000;
const BASE = `http://127.0.0.1:${PORT}`;
// 05-01 is a real curated दिनविशेष entry (महाराष्ट्र दिन) - picked so that box
// actually renders instead of showing its deliberate "nothing checked for
// this date" empty state (dinvishesh.js), which is correct behaviour but not
// what this fixture is for.
const dateArgument = process.argv.indexOf('--date');
const requestedDate = dateArgument >= 0 ? process.argv[dateArgument + 1] : null;
const PUBLICATION_DATE = process.env.SAHAS_TEST_EDITION_DATE || requestedDate || '2099-05-01';
if (!/^\d{4}-\d{2}-\d{2}$/.test(PUBLICATION_DATE)) {
  throw new Error('Use --date YYYY-MM-DD (or SAHAS_TEST_EDITION_DATE).');
}
const UPLOAD_DIR = path.join(__dirname, '..', 'public', 'uploads');

async function signIn() {
  const response = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'admin@esahas.com', password: 'admin123', role: 'admin' }),
  });
  if (!response.ok) throw new Error(`sign-in failed: ${response.status} ${await response.text()}`);
  const cookie = (response.headers.getSetCookie?.() || [response.headers.get('set-cookie')])
    .filter(Boolean).map((v) => v.split(';')[0]).join('; ');
  const call = (p, options = {}) => fetch(BASE + p, {
    ...options,
    headers: { 'Content-Type': 'application/json', Cookie: cookie, ...(options.headers || {}) },
  });
  call.json = async (p, options) => {
    const r = await call(p, options);
    if (!r.ok) throw new Error(`${options?.method || 'GET'} ${p} -> ${r.status}: ${await r.text()}`);
    return r.json();
  };
  return call;
}

// Five clearly-synthetic placeholder photographs, generated (not reused from
// a real reporter's upload - those are somebody's actual work, not a fixture
// to repurpose), at a resolution that clears preflight's print-DPI floor at
// any placement size this script uses.
async function makePlaceholderImages() {
  const { Jimp } = await import('jimp');
  const specs = [
    { name: 'zz-test-edition-lead-1.jpg', color: 0x2b4c7eff },
    { name: 'zz-test-edition-lead-2.jpg', color: 0x7e2b2bff },
    { name: 'zz-test-edition-p2-centre.jpg', color: 0x2b7e4cff },
    { name: 'zz-test-edition-p3-feature.jpg', color: 0x7e6b2bff },
    { name: 'zz-test-edition-p4-anchor.jpg', color: 0x5a2b7eff },
  ];
  const urls = {};
  for (const spec of specs) {
    const file = path.join(UPLOAD_DIR, spec.name);
    if (!fs.existsSync(file)) {
      const image = new Jimp({ width: 2200, height: 1600, color: spec.color });
      await image.write(file);
    }
    urls[spec.name] = `/uploads/${spec.name}`;
  }
  return urls;
}

async function write(desk, pageId, sectionKey, fields) {
  await desk.json(`/api/pages/${pageId}/sections/${sectionKey}`, {
    method: 'PUT',
    body: JSON.stringify(fields),
  });
}

async function placeImage(desk, pageId, sectionKey, { url, filename, width, height, caption, shape }) {
  return desk.json(`/api/pages/${pageId}/sections/${sectionKey}/images`, {
    method: 'POST',
    body: JSON.stringify({ url, filename, width, height, caption, shape }),
  });
}

// Long enough to overset the lead block and force a real continuation, short
// enough that the leftover fits the landing block it is explicitly aimed at
// (page two's 'right-bottom', a narrow column - see main()). A story jumped
// into a block a third its own size is not how a real desk would do it;
// carryOver()'s own target-capacity guard (jump.service.js) would rightly
// refuse that, exactly as tests/jump.test.js holds.
const LONG_MODI_BODY = [
  '■ नवी दिल्ली, विशेष प्रतिनिधी',
  'पंतप्रधान नरेंद्र मोदी यांनी आज नव्या पायाभूत सुविधा प्रकल्पांच्या मालिकेचे उद्घाटन केले. या प्रकल्पांमध्ये रस्ते, रेल्वे आणि ऊर्जा क्षेत्रातील अनेक योजनांचा समावेश आहे. कार्यक्रमात बोलताना पंतप्रधान म्हणाले की, देशाच्या विकासासाठी पायाभूत सुविधांचा विस्तार अत्यंत आवश्यक आहे.',
  'या प्रसंगी केंद्रीय मंत्री व राज्याचे मुख्यमंत्री उपस्थित होते. प्रकल्प पूर्ण झाल्यानंतर दळणवळण व्यवस्था अधिक सक्षम होईल असा दावा करण्यात आला.',
  'विरोधी पक्षांनी मात्र या घोषणांवर प्रश्न उपस्थित केले आहेत.',
].join('\n\n');

async function fillPage1(desk, pageId) {
  await write(desk, pageId, 'masthead-advert', { body: 'जाहिरातीसाठी संपर्क: ०२०-१२३४५६७८' });

  // The lead's own picture strip - what makes this the image-heavy story of
  // the page.
  await placeImage(desk, pageId, 'lead-pictures', {
    url: (global.__images || {})['zz-test-edition-lead-1.jpg'],
    filename: 'zz-test-edition-lead-1.jpg', width: 120, height: 200, caption: 'उद्घाटन प्रसंगी पंतप्रधान.',
  });
  await placeImage(desk, pageId, 'lead-side', {
    url: (global.__images || {})['zz-test-edition-lead-2.jpg'],
    filename: 'zz-test-edition-lead-2.jpg', width: 120, height: 200, caption: 'उपस्थित मान्यवर.',
  });

  await write(desk, pageId, 'lead', {
    kicker: 'पंतप्रधानांचा दौरा',
    headline: '*नरेंद्र मोदी* यांच्याकडून पायाभूत सुविधा प्रकल्पांचे उद्घाटन',
    headlineStyle: 'accent',
    subheading: 'हजारो कोटींच्या योजनांचा शुभारंभ, विरोधकांचे प्रश्न',
    body: LONG_MODI_BODY,
    reporterName: 'विशेष प्रतिनिधी',
    location: 'नवी दिल्ली',
    category: 'राष्ट्रीय',
  });

  await write(desk, pageId, 'second-lead', {
    headline: 'राज्य सरकारचा शेतकऱ्यांसाठी नवा निर्णय, कर्जमाफीची घोषणा',
    body: '■ मुंबई, प्रतिनिधी\nराज्य सरकारने आज मंत्रिमंडळ बैठकीत शेतकऱ्यांच्या कर्जमाफीचा निर्णय घेतला. यामुळे लाखो शेतकऱ्यांना दिलासा मिळणार आहे. अर्थमंत्र्यांनी सांगितले की, या योजनेची अंमलबजावणी पुढील महिन्यापासून सुरू होईल.',
    reporterName: 'प्रतिनिधी',
    location: 'मुंबई',
  });

  await write(desk, pageId, 'third-lead', {
    headline: 'शहरातील पाणीपुरवठा योजनेला गती, सहा महिन्यांत काम पूर्ण होणार',
    body: '■ पुणे\nमहापालिकेने पाणीपुरवठा योजनेचे काम वेगाने सुरू केले असून, सहा महिन्यांत ते पूर्ण होईल असा दावा प्रशासनाने केला आहे. यामुळे शहरातील अनेक भागांतील पाणीटंचाई दूर होण्यास मदत होणार आहे.',
    location: 'पुणे',
  });

  await write(desk, pageId, 'anchor', {
    headline: 'क्रीडा क्षेत्रात राज्याची कामगिरी उंचावली, राष्ट्रीय स्पर्धेत विजेतेपद',
    subheading: 'युवा खेळाडूंचे कौतुक, पुढील स्पर्धेची तयारी सुरू',
    body: '■ नागपूर, क्रीडा प्रतिनिधी\nराष्ट्रीय स्तरावरील स्पर्धेत राज्याच्या संघाने विजेतेपद पटकावले. खेळाडूंच्या या कामगिरीचे सर्वत्र कौतुक होत आहे. प्रशिक्षकांनी सांगितले की, पुढील स्पर्धेसाठी संघाची तयारी आतापासूनच सुरू करण्यात येणार आहे.',
    location: 'नागपूर',
  });

  await write(desk, pageId, 'display-advert', { headline: 'मोठी सूट! वार्षिक विक्री सुरू — सर्व वस्तूंवर ५०% पर्यंत सवलत' });
  await write(desk, pageId, 'top-advert', { headline: 'आजच नोंदणी करा' });

  await write(desk, pageId, 'report-one', {
    headline: 'स्थानिक बाजारात भाजीपाल्याचे भाव स्थिर',
    body: '■ स्थानिक प्रतिनिधी\nगेल्या आठवडाभरात भाजीपाल्याचे भाव स्थिर राहिले, ग्राहकांना दिलासा मिळाला. आवक चांगली असल्याने भाव नियंत्रणात आहेत.',
  });
  await write(desk, pageId, 'report-two', {
    headline: 'शाळांमध्ये नवीन शैक्षणिक उपक्रम सुरू',
    body: '■ प्रतिनिधी\nजिल्ह्यातील शाळांमध्ये विद्यार्थ्यांसाठी नवीन उपक्रम राबवण्यात येत आहे. शिक्षण विभागाने सर्व शाळांना सूचना दिल्या आहेत.',
  });
  await write(desk, pageId, 'report-three', {
    headline: 'रस्ता दुरुस्तीच्या कामाला विलंब, नागरिक त्रस्त',
    body: '■ प्रतिनिधी\nमुख्य रस्त्याच्या दुरुस्तीचे काम अनेक महिन्यांपासून रखडले असून, नागरिकांना त्रासाला सामोरे जावे लागत आहे.',
  });

  await write(desk, pageId, 'brief-one', { headline: 'वीज पुरवठा तात्पुरता खंडित राहणार', body: 'दुरुस्तीमुळे उद्या सकाळी वीजपुरवठा बंद राहील.' });
  await write(desk, pageId, 'brief-two', { headline: 'रक्तदान शिबिराचे आयोजन', body: 'सामाजिक संस्थेतर्फे रविवारी रक्तदान शिबिराचे आयोजन करण्यात आले आहे.' });
  await write(desk, pageId, 'short-news', {
    headline: 'थोडक्यात',
    body: 'चोरीच्या दोन घटनांची नोंद.\nग्रामपंचायत निवडणुकीची घोषणा.\nपुलाच्या कामाला मंजुरी.\nनवीन बस फेरी सुरू.',
  });
}

async function fillPage2(desk, pageId) {
  await write(desk, pageId, 'banner', {
    kicker: 'शहर विशेष',
    headline: 'शहरातील वाहतूक कोंडीवर तोडगा, नवीन उड्डाणपुलाला मंजुरी',
    subheading: 'दोन वर्षांत काम पूर्ण करण्याचे प्रशासनाचे लक्ष्य',
    body: '■ शहर प्रतिनिधी\nवाहतूक कोंडीवर तोडगा काढण्यासाठी नवीन उड्डाणपुलाला मंजुरी देण्यात आली आहे.',
    location: 'शहर',
  });

  await write(desk, pageId, 'left-column', {
    headline: 'जिल्हा रुग्णालयात नवीन यंत्रसामग्री दाखल',
    body: '■ प्रतिनिधी\nजिल्हा रुग्णालयात रुग्णसेवेसाठी नवीन अत्याधुनिक यंत्रसामग्री दाखल करण्यात आली आहे. यामुळे रुग्णांना अधिक चांगली उपचार सेवा मिळणार आहे.',
  });

  await placeImage(desk, pageId, 'centre-column', {
    url: (global.__images || {})['zz-test-edition-p2-centre.jpg'],
    filename: 'zz-test-edition-p2-centre.jpg',
    width: 140, height: 100, caption: 'कार्यक्रमात उपस्थित मान्यवर.',
  });
  await write(desk, pageId, 'centre-column', {
    headline: 'सांस्कृतिक कार्यक्रमाला उत्स्फूर्त प्रतिसाद',
    subheading: 'स्थानिक कलाकारांचा सहभाग',
    body: '■ प्रतिनिधी\nस्थानिक मैदानावर आयोजित सांस्कृतिक कार्यक्रमाला नागरिकांचा उत्स्फूर्त प्रतिसाद मिळाला. विविध कलाकारांनी आपली कला सादर केली.',
  });

  await write(desk, pageId, 'right-top', { headline: 'बससेवेच्या वेळापत्रकात बदल', body: 'नव्या वेळापत्रकानुसार बससेवा उद्यापासून सुरू होईल.' });

  // right-bottom is deliberately left EMPTY - the continuation from page
  // one's lead story lands here, via jump.service.js's own findLanding(),
  // exactly as a sub-editor pressing "Carry it over" would get.

  await write(desk, pageId, 'footer', {
    headline: 'आजचा सुडोकू',
    smartCardKey: 'sudoku',
    smartCardData: {
      grid: [
        [5, 3, 0, 0, 7, 0, 0, 0, 0],
        [6, 0, 0, 1, 9, 5, 0, 0, 0],
        [0, 9, 8, 0, 0, 0, 0, 6, 0],
        [8, 0, 0, 0, 6, 0, 0, 0, 3],
        [4, 0, 0, 8, 0, 3, 0, 0, 1],
        [7, 0, 0, 0, 2, 0, 0, 0, 6],
        [0, 6, 0, 0, 0, 0, 2, 8, 0],
        [0, 0, 0, 4, 1, 9, 0, 0, 5],
        [0, 0, 0, 0, 8, 0, 0, 7, 9],
      ],
      difficulty: 'सोपा',
    },
  });
}

async function fillPage3(desk, pageId) {
  // feature-one is 307px wide. A 260px-wide image here (this fixture's first
  // draft) left only a 5-character sliver for the body to wrap into, for
  // every row the picture touched - text-flow.js's own MIN_RUN_CHARS guard
  // now refuses to pour prose into a run that narrow rather than shredding it
  // one glyph per line, but a real desk would not have sized the picture this
  // way to begin with. 150px leaves a genuinely readable ~25-character column
  // beside it, a real photo-feature wrap rather than a wall filling the block.
  await placeImage(desk, pageId, 'feature-one', {
    url: (global.__images || {})['zz-test-edition-p3-feature.jpg'],
    filename: 'zz-test-edition-p3-feature.jpg',
    width: 150, height: 140, caption: 'शहरातील रस्त्यावर सकाळच्या वेळी वाहतुकीची स्थिती.',
  });
  await write(desk, pageId, 'feature-one', {
    kicker: 'फोटो फिचर',
    headline: 'सकाळच्या गर्दीचे क्षणचित्र',
    body: 'शहरातील मुख्य चौकात रोज सकाळी होणारी वाहतूक कोंडी.',
  });

  await write(desk, pageId, 'feature-two', {
    kicker: 'अग्रलेख',
    headline: 'शहराच्या नियोजनाचा प्रश्न ऐरणीवर',
    body: '■ संपादकीय\nशहराच्या वाढत्या लोकसंख्येच्या तुलनेत पायाभूत सुविधांचे नियोजन अपुरे पडत असल्याचे वारंवार दिसून येते. प्रशासनाने केवळ तात्पुरत्या उपाययोजनांऐवजी दीर्घकालीन नियोजनावर भर देण्याची गरज आहे. अन्यथा भविष्यात परिस्थिती अधिक बिकट होऊ शकते.',
    reporterName: 'संपादकीय विभाग',
  });

  await write(desk, pageId, 'feature-three', {
    headline: 'यंदा पावसाने सरासरी ओलांडली',
    body: 'यंदाच्या हंगामात जिल्ह्यात सरासरीच्या ११२ टक्के पाऊस नोंदवला गेला असून, गेल्या पाच वर्षांतील ही सर्वाधिक नोंद आहे. यामुळे जलसाठ्यांची पातळी समाधानकारक आहे.',
  });

  await write(desk, pageId, 'feature-advert', { headline: 'सुवर्ण संधी! नवीन शाखेचे उद्घाटन — विशेष सवलतीसह' });
}

async function fillPage4(desk, pageId) {
  await placeImage(desk, pageId, 'anchor', {
    url: (global.__images || {})['zz-test-edition-p4-anchor.jpg'],
    filename: 'zz-test-edition-p4-anchor.jpg',
    width: 200, height: 150, caption: 'स्पर्धेतील विजेत्या संघाचे छायाचित्र.',
  });
  await write(desk, pageId, 'anchor', {
    kicker: 'क्रीडा विशेष',
    headline: 'आंतरशालेय स्पर्धेत यजमान संघ अजिंक्य',
    body: '■ क्रीडा प्रतिनिधी\nशहरात झालेल्या आंतरशालेय क्रीडा स्पर्धेत यजमान संघाने अजिंक्यपद पटकावले. अंतिम सामन्यात चुरशीच्या लढतीत यजमान संघाने बाजी मारली.',
  });

  await write(desk, pageId, 'second-lead', {
    headline: 'जिल्ह्यातील सहकारी संस्थांच्या निवडणुकांची घोषणा',
    body: '■ प्रतिनिधी\nजिल्ह्यातील सहकारी संस्थांच्या निवडणुकांचा कार्यक्रम जाहीर करण्यात आला आहे.',
  });
  await write(desk, pageId, 'shoulder', {
    headline: 'ग्रामीण भागात रस्ते बांधणीला वेग',
    body: '■ प्रतिनिधी\nग्रामीण भागातील रस्ते बांधणीच्या कामांना गती देण्यात आली असून, अनेक गावे मुख्य रस्त्याला जोडली जाणार आहेत.',
  });

  const briefs = [
    ['col-one-a', 'पथदिवे दुरुस्तीची मागणी', 'परिसरातील बंद पथदिवे तातडीने दुरुस्त करण्याची मागणी नागरिकांनी केली आहे.'],
    ['col-one-b', 'स्वच्छता मोहीम राबवली', 'सोसायटीच्या वतीने परिसर स्वच्छता मोहीम राबवण्यात आली.'],
    ['col-two-a', 'ज्येष्ठ नागरिकांसाठी शिबिर', 'आरोग्य तपासणी शिबिराचे आयोजन करण्यात आले आहे.'],
    ['col-two-b', 'वृक्षारोपण कार्यक्रम', 'शालेय विद्यार्थ्यांनी वृक्षारोपण कार्यक्रमात सहभाग घेतला.'],
    ['col-three-a', 'ग्रंथालयात नवीन पुस्तके', 'सार्वजनिक ग्रंथालयात नवीन पुस्तकांचा संग्रह दाखल झाला.'],
    ['col-three-b', 'रस्ता सुरक्षा सप्ताह', 'वाहतूक पोलिसांतर्फे जनजागृती कार्यक्रम घेण्यात आला.'],
    ['col-four-a', 'शालेय स्नेहसंमेलन उत्साहात', 'विद्यार्थ्यांनी विविध सांस्कृतिक कार्यक्रम सादर केले.'],
    ['col-four-b', 'पाणीटंचाईवर बैठक', 'उपाययोजनांबाबत ग्रामसभेत चर्चा झाली.'],
  ];
  for (const [key, headline, body] of briefs) {
    await write(desk, pageId, key, { headline, body });
  }

  await write(desk, pageId, 'strip-left', { headline: 'बाजार समितीत आवक वाढली', body: 'शेतमालाची आवक वाढल्याने शेतकऱ्यांना दिलासा.' });
  await write(desk, pageId, 'strip-centre', { headline: 'नवीन बससेवा सुरू', body: 'दोन गावांना जोडणारी नवीन बससेवा सुरू करण्यात आली.' });
  await write(desk, pageId, 'strip-right', { headline: 'तक्रार निवारण शिबिर', body: 'नागरिकांच्या तक्रारींचे निवारण करण्यासाठी शिबिर घेण्यात आले.' });

  await write(desk, pageId, 'foot-left', {
    headline: 'जिल्ह्यातील सिंचन प्रकल्पांचा आढावा, कामांना गती देण्याचे निर्देश',
    body: '■ प्रतिनिधी\nसिंचन प्रकल्पांचा आढावा घेण्यासाठी बैठक पार पडली. अधिकाऱ्यांना गती देण्याचे निर्देश देण्यात आले.',
    reporterName: 'प्रतिनिधी',
  });
  await write(desk, pageId, 'foot-right', { headline: 'वर्षभर चालणारी खास ऑफर — आजच भेट द्या', body: 'अधिक माहितीसाठी संपर्क साधा.' });
}

async function main() {
  global.__images = await makePlaceholderImages();
  const desk = await signIn();

  const start = await desk.json('/api/newspapers/start', {
    method: 'POST',
    body: JSON.stringify({ publicationDate: PUBLICATION_DATE, pageCount: 4 }),
  });
  const newspaperId = start.newspaper.id;
  const pages = await desk.json(`/api/newspapers/${newspaperId}/pages`);
  const byNumber = new Map(pages.map((p) => [p.page_number, p]));

  // Idempotent re-runs: undo any previous carry-over first, so the lead is
  // back to one whole piece before it is rewritten and re-split - otherwise a
  // second run finds page two's landing block already occupied by the first
  // run's continuation and has nowhere left to land.
  await desk(`/api/pages/${byNumber.get(1).id}/sections/lead/reunite`, { method: 'POST' });

  await fillPage1(desk, byNumber.get(1).id);
  await fillPage2(desk, byNumber.get(2).id);
  await fillPage3(desk, byNumber.get(3).id);
  await fillPage4(desk, byNumber.get(4).id);

  // Named explicitly, not left to findLanding()'s own default, so a re-run
  // always lands the same place - a sub-editor would normally choose the
  // landing block too; findLanding() is the convenience default for when they
  // have not.
  const carry = await desk.json(`/api/pages/${byNumber.get(1).id}/sections/lead/carry-over`, {
    method: 'POST',
    body: JSON.stringify({ toPageId: byNumber.get(2).id, toSectionKey: 'right-bottom' }),
  });
  console.log('carry-over:', carry);

  console.log(`\nBuilt edition ${newspaperId}, dated ${PUBLICATION_DATE}.`);
  console.log(`Pages: ${[...byNumber.values()].map((p) => `${p.page_number}=${p.id}`).join(', ')}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
