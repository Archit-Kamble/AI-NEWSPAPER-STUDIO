// What each frame of a measured layout WEARS.
//
// templates.js says where a frame is and what it is for; a template has never
// said how a block is dressed, because that is a desk decision taken per block.
// A recipe is that decision written down once for a borrowed layout: the faces,
// the locked display sizes, the grounds, the rules and the panels a reference
// page's blocks carry, so a desk does not re-make thirty choices by hand.
//
// MEASURED, NOT INVENTED. Every number was read off the desk's 300 ppi scan of
// the reference page (scripts/apply-design-recipe.js states the scale). Sizes
// are LOCKED on purpose: the reference's look is its hierarchy, and an auto-fit
// that grows or shrinks a headline to fill its measure is exactly what would
// make the copy stop looking like the page it was measured from.
//
// NOTHING OF THE REFERENCE'S WORDS IS HERE. Panel titles and lines are fixture
// placeholders a writer replaces; the reference's nameplate, section labels,
// disclaimers and copy are not carried and must not be.
//
// Values are the shared catalogues' own keys and hexes (inks.js, borders.js,
// typefaces.js, inset-panels.js), so the service's palette boundary checks them
// like any other save.
//
// Panel and picture rectangles are in the block's own pixels.

const ORANGE = '#d2601a';
const SKY = '#1b6fb0';
const CREAM = '#fbf3e9';
const BLUE_TINT = '#d8e7f2'; // vivid-sky: the reference's panel ground is a visible screen, not a wash
const LILAC = '#dfdcec'; // vivid-violet, for the same reason
const ROSE_TINT = '#f2dce4'; // vivid-rose
const RED = '#c8102e';

const PLACEHOLDER = 'इथे मजकूर लिहा';
const points = (n) => Array.from({ length: n }, () => PLACEHOLDER);

// Small builders, so a page reads as a list of decisions rather than a wall of
// repeated keys. Every value still ends up as an ordinary saveSection field.
const story = (face, px, extra = {}) => ({ displayFamily: face, headlineFontPx: px, headlineLocked: true, bodyFontPx: 7, ...extra });
const rail = (px = 13, extra = {}) => ({ displayFamily: 'khand', headlineFontPx: px, headlineLocked: true, bodyFontPx: 6.4, ...extra });
const lead = (px, columnCount, extra = {}) => story('khand', px, { subheadingFontPx: 12, subheadingLocked: true, columnCount, ...extra });
const strip = (px, columnCount) => story('mukta', px, { columnCount, headlineStyle: 'kicker-tab-rule', accentColor: ORANGE });
const labelled = (face, px, columnCount) => story(face, px, { columnCount, headlineStyle: 'kicker-tab', accentColor: RED });
const pic = (file, at) => ({ file, at });
const sidebar = (at, n = 3, extra = {}) => ({ kind: 'sidebar', marker: 'number', at, title: PLACEHOLDER, lines: points(n), ...extra });
const tinted = (tint, at, n = 2) => ({ kind: 'sidebar', marker: 'none', tint, at, title: PLACEHOLDER, lines: points(n) });
const pull = (at) => ({ kind: 'quote', at, lines: [PLACEHOLDER] });
const chart = (chartType, at, items, unit = '') => ({ kind: 'chart', at, card: { chartType, unit, items } });
const readings = (...values) => values.map((value, index) => ({ label: `${PLACEHOLDER} ${index + 1}`, value }));

// FICTIONAL ADVERTISERS, written for the fixture. Not one is a real business,
// and none is the reference paper's advertiser: an advert slot is judged by
// its shape and weight on the page, and a blank rectangle cannot be.
const ad = (style, advertiser, headline, subheadline, lines, offer, contact) => ({
  advert: { style, advertiser, headline, subheadline, lines, offer, contact },
});
const ADS = {
  gold: ad('classic', 'सह्याद्री गोल्ड लोन', 'सोन्यावर तात्काळ कर्ज', 'फक्त ३० मिनिटांत मंजुरी', ['कमी व्याजदर', 'सोपी कागदपत्रे', 'जिल्ह्यात १२ शाखा'], 'व्याजदर ०.९% दरमहा पासून', '९८९०० ११२२३'),
  insurance: ad('poster', 'कृष्णा जीवन विमा', 'कुटुंबाचे भविष्य सुरक्षित करा', 'नवीन बचत योजना', ['हमखास परतावा', 'कर सवलत', 'आयुष्यभर संरक्षण'], '७ सप्टेंबरपासून उपलब्ध', '९८२२० ३३४४५'),
  family: ad('framed', 'आनंद निवास', 'स्वप्नातले घर आता तुमच्या बजेटमध्ये', 'शहरालगत १ व २ बीएचके', ['बँक कर्ज सुविधा', 'बगीचा व क्लब हाऊस', 'ताबा लवकरच'], 'बुकिंगवर विशेष सवलत', '९७६५४ ५५६६७'),
  ayurveda: ad('classic', 'धन्वंतरी आयुर्वेद', 'सांधेदुखीवर नैसर्गिक उपाय', 'शंभर टक्के वनस्पतीजन्य', ['गुडघेदुखी', 'कंबरदुखी', 'पाठदुखी'], 'सर्व औषध दुकानांत उपलब्ध', '९४२२० ७७८८९'),
  masala: ad('poster', 'अक्षय मसाले', 'फक्त चिमूटभर, स्वाद भरपूर', 'घरगुती चवीचे मसाले', ['गरम मसाला', 'कांदा-लसूण मसाला', 'मिसळ मसाला'], 'नवीन पॅकमध्ये', '९८५०० ९९००१'),
  oil: ad('banner', 'कृषिवल तेल', 'आरोग्यदायी खाद्यतेल', 'रिफाइंड सोयाबीन तेल', ['दररोजच्या स्वयंपाकासाठी'], 'फायद्याचा पॅक', '९८८१२ १२३४५'),
  travel: ad('framed', 'यात्रा पर्यटन', 'हिवाळ्यात परदेश सहल', 'कुटुंबासाठी खास पॅकेज', ['युरोप १० दिवस', 'दुबई ५ दिवस', 'सिंगापूर ६ दिवस'], 'लवकर बुकिंगवर सवलत', '९९२२३ ४४५५६'),
  tour: ad('poster', 'निसर्ग पर्यटन', 'वन्यजीव अभयारण्य पाहा', 'सफारी, बोटिंग आणि निसर्ग निवास', ['पक्षी निरीक्षण', 'जंगल सफारी', 'निसर्ग मार्ग'], 'शाळा सहलींसाठी विशेष दर', '९८६०० २२३३४'),
  pharma: ad('classic', 'आरोग्यम् औषधालय', 'पोटाच्या तक्रारींवर गुणकारी', 'ॲसिडिटी व अपचनावर', ['पोट साफ', 'भूक वाढते', 'शांत झोप'], 'पोट साफ तर आरोग्य उत्तम', '९४२२० ११७२३'),
  bank: ad('framed', 'सातारा नागरी सहकारी बँक', 'नोकरभरती जाहिरात', 'लिपिक व अधिकारी पदे', ['पदवीधर उमेदवार', 'ऑनलाइन अर्ज', 'अंतिम तारीख २१ सप्टेंबर'], 'संकेतस्थळावर अर्ज करा', '०२१६२ २३४५६७'),
  college: ad('classified', 'संत तुकाराम महाविद्यालय', 'प्राध्यापक भरती', 'विविध विषयांसाठी', ['नेट/सेट उत्तीर्ण', 'मुलाखत १५ सप्टेंबर'], 'अर्ज ७ दिवसांत', '०२० २४५६७८९०'),
  exam: ad('classified', 'ग्रामीण बँकिंग प्रशिक्षण', 'बँक परीक्षेची तयारी', 'अधिकारी व सहायक पदे', ['नोंदणी सुरू', 'सराव परीक्षा'], 'प्रवेश मर्यादित', '९८९०२ ६७८९०'),
  notice: ad('classified', 'नगरपरिषद', 'जाहीर निविदा सूचना क्र. ०७/२०९९', 'बांधकाम विभाग', ['प्रभाग क्र. ३ मधील रस्ता डांबरीकरण', 'प्रभाग क्र. ५ मधील गटार बांधकाम', 'अंदाजपत्रकीय रक्कम ३७ लाख रुपये', 'बयाणा रक्कम ३७ हजार रुपये', 'निविदा विक्री १० ते २० सप्टेंबर', 'निविदा अंतिम तारीख २५ सप्टेंबर', 'निविदा उघडण्याची तारीख २८ सप्टेंबर', 'अटी व शर्ती संकेतस्थळावर'], 'मुख्याधिकारी, नगरपरिषद', '०२१६९ २२२३३'),
  tender: ad('classified', 'जिल्हा परिषद', 'ई-निविदा सूचना क्र. ०५/२०९९', 'ग्रामीण पाणीपुरवठा विभाग', ['नळ पाणीपुरवठा योजना दुरुस्ती', 'सार्वजनिक विहीर खोदाई', 'जलकुंभ बांधकाम', 'निविदा शुल्क ऑनलाइन भरावे', 'ऑनलाइन सादरीकरण २४ सप्टेंबरपर्यंत', 'पात्रता व अटी संकेतस्थळावर'], 'कार्यकारी अभियंता', '०२१६२ २३३४४'),
  power: ad('classified', 'वीज वितरण मंडळ', 'वीजपुरवठा बंद निवेदन', 'देखभालीच्या कामासाठी', ['उपकेंद्रातील रोहित्र बदलण्याचे काम', 'रविवार सकाळी ९ ते दुपारी १', 'पेठ, शिवाजीनगर व बसस्थानक परिसर', 'औद्योगिक वसाहत फीडर', 'काम लवकर झाल्यास पुरवठा आधी सुरू', 'ग्राहकांनी सहकार्य करावे'], 'कार्यकारी अभियंता', '१९१२'),
  strip: ad('banner', 'उडान बचत योजना', 'मुलांच्या भविष्यासाठी बचत', 'सुरक्षित गुंतवणूक', ['दरमहा ५०० रुपयांपासून'], 'आजच खाते उघडा', '९१७५६ ८६०८०'),
  whole: ad('poster', 'राज्य पर्यटन विकास', 'निसर्ग पर्यटनाचे नवे केंद्र', 'अभयारण्ये, पक्षी विहार आणि जलसफारी', ['१६ हजार चौ. किमी वनक्षेत्र', '११ वन्यजीव अभयारण्ये', '२४ पक्षी विहार', 'पर्यावरणपूरक सुविधा'], 'काम दमदार', '१८०० २२० ३३४'),
};

// A page measured exactly off a scan carries its recipe in its own spec
// (measured-pages/), beside the rectangles it was measured with.
const { buildMeasuredPage } = require('./measured-pages/scan');
const MEASURED_RECIPES = Object.fromEntries(['broadsheet-front']
  .map((key) => [key, buildMeasuredPage(require(`./measured-pages/${key}`)).recipe]));

const RECIPES = {
  ...MEASURED_RECIPES,
  // MEASURED off the reference scan: sizes from each head's shirorekha, body at
  // the reference's own em and pitch, its colours, its picture and panel boxes.
  // MEASURED off the reference sport page: display sizes from each headline's
  // shirorekha height, body at the reference's own em and line pitch, the
  // reference's colours, and picture and panel rectangles off the scan.
  'broadsheet-sport': {
    'rail-today': {
      style: { displayFamily: 'khand', fontFamily: 'sans', headlineFontPx: 9.0, headlineLocked: true, bodyFontPx: 5.6, lineHeight: 1.583, columnCount: 1, textAlign: 'justify', subheadingFontPx: 6.5, subheadingLocked: true, headlineStyle: 'reverse', accentColor: '#0b8bd3' },
      pictures: [],
      panels: [],
    },
    'rail-update': {
      style: { displayFamily: 'khand', fontFamily: 'sans', headlineFontPx: 8.0, headlineLocked: true, bodyFontPx: 5.6, lineHeight: 1.375, columnCount: 1, textAlign: 'justify', headlineStyle: 'kicker-tab', accentColor: '#fb9f0b' },
      fixtureKicker: 'थोडक्यात',
      pictures: [{ file: 'reference-lokmat/sport-update.jpg', x: 1, y: 36, width: 80, height: 77 }],
      panels: [],
    },
    'rail-three': {
      style: { displayFamily: 'khand', fontFamily: 'sans', headlineFontPx: 9.0, headlineLocked: true, bodyFontPx: 5.6, lineHeight: 1.375, columnCount: 1, textAlign: 'justify' },
      pictures: [{ file: 'reference-lokmat/sport-rail3.jpg', x: 1, y: 0, width: 80, height: 60 }],
      panels: [],
    },
    'rail-four': {
      style: { displayFamily: 'khand', fontFamily: 'sans', headlineFontPx: 9.0, headlineLocked: true, bodyFontPx: 5.6, lineHeight: 1.375, columnCount: 1, textAlign: 'justify' },
      pictures: [{ file: 'reference-lokmat/sport-rail4a.jpg', x: 1, y: 0, width: 37, height: 45 }, { file: 'reference-lokmat/sport-rail4b.jpg', x: 45, y: 0, width: 31, height: 45 }],
      panels: [],
    },
    'rail-five': {
      style: { displayFamily: 'khand', fontFamily: 'sans', headlineFontPx: 9.0, headlineLocked: true, bodyFontPx: 5.6, lineHeight: 1.375, columnCount: 1, textAlign: 'justify' },
      pictures: [],
      panels: [],
    },
    'lead': {
      style: { displayFamily: 'khand', fontFamily: 'sans', headlineFontPx: 27.5, headlineLocked: true, bodyFontPx: 6.0, lineHeight: 1.328, columnCount: 4, textAlign: 'justify', subheadingFontPx: 11.5, subheadingLocked: true },
      pictures: [{ file: 'reference-lokmat/sport-lead1.jpg', x: 90, y: 101, width: 139, height: 348 }, { file: 'reference-lokmat/sport-lead2.jpg', x: 229, y: 299, width: 121, height: 150 }],
      panels: [{ kind: 'sidebar', marker: 'none', tint: '#c9e7f3', x: 234, y: 106, width: 116, height: 188, titlePx: 8.9, linePx: 6, title: PLACEHOLDER, lines: points(6) }],
    },
    'second': {
      style: { displayFamily: 'khand', fontFamily: 'sans', headlineFontPx: 19.5, headlineLocked: true, bodyFontPx: 6.0, lineHeight: 1.328, columnCount: 2, textAlign: 'justify', subheadingFontPx: 9.0, subheadingLocked: true },
      pictures: [{ file: 'reference-lokmat/sport-second.jpg', x: 83, y: 58, width: 87, height: 165 }],
      panels: [{ kind: 'sidebar', marker: 'none', x: 83, y: 224, width: 88, height: 69, titlePx: 8.9, linePx: 6, title: PLACEHOLDER, lines: points(4) }],
    },
    'report-left': {
      style: { displayFamily: 'khand', fontFamily: 'sans', headlineFontPx: 19.5, headlineLocked: true, bodyFontPx: 6.0, lineHeight: 1.328, columnCount: 2, textAlign: 'justify', subheadingFontPx: 8.0, subheadingLocked: true },
      pictures: [{ file: 'reference-lokmat/sport-misbah.jpg', x: 90, y: 57, width: 80, height: 53 }],
      panels: [{ kind: 'sidebar', marker: 'none', x: 90, y: 113, width: 80, height: 158, titlePx: 8.9, linePx: 6, title: PLACEHOLDER, lines: points(6) }],
    },
    'report-right': {
      style: { displayFamily: 'khand', fontFamily: 'sans', headlineFontPx: 20.5, headlineLocked: true, bodyFontPx: 6.0, lineHeight: 1.328, columnCount: 4, textAlign: 'justify', subheadingFontPx: 8.5, subheadingLocked: true },
      pictures: [{ file: 'reference-lokmat/sport-carlos.jpg', x: 90, y: 33, width: 261, height: 127 }, { file: 'reference-lokmat/sport-stan.jpg', x: 238, y: 198, width: 39, height: 47 }],
      panels: [{ kind: 'sidebar', marker: 'none', x: 235, y: 170, width: 116, height: 27, titlePx: 8.9, linePx: 6, title: PLACEHOLDER, lines: points(1) }, { kind: 'sidebar', marker: 'none', x: 178, y: 165, width: 56, height: 106, titlePx: 8.9, linePx: 6, title: PLACEHOLDER, lines: points(4) }],
    },
    'feature-strip': {
      style: { displayFamily: 'khand', fontFamily: 'sans', headlineFontPx: 16.5, headlineLocked: true, bodyFontPx: 6.0, lineHeight: 1.328, columnCount: 4, textAlign: 'justify', subheadingFontPx: 8.5, subheadingLocked: true, headlineStyle: 'kicker-chip-rule', accentColor: '#e42424', borderInk: '#fb9f0b', headlineAlign: 'center' },
      fixtureKicker: 'जरूर वाचा',
      pictures: [{ file: 'reference-lokmat/sport-bottom.jpg', x: 183, y: 90, width: 130, height: 106 }],
      panels: [{ kind: 'sidebar', marker: 'none', tint: '#e7c9e7', x: 178, y: 47, width: 172, height: 42, titlePx: 8.9, linePx: 6, title: PLACEHOLDER, lines: points(3) }],
    },
    'squad-box': {
      style: { displayFamily: 'khand', fontFamily: 'sans', headlineFontPx: 15.5, headlineLocked: true, bodyFontPx: 5.4, lineHeight: 1.391, columnCount: 2, textAlign: 'justify', headlineAlign: 'center', backgroundColor: '#eaeaea', borderRadiusPx: 6 },
      pictures: [{ file: 'reference-lokmat/sport-squad.jpg', x: 9, y: 61, width: 160, height: 130 }],
      panels: [],
    },
  },

  // MEASURED off the reference scan: sizes from each head's shirorekha, body at
  // the reference's own em and pitch, its colours, its picture and panel boxes.
  'broadsheet-jacket': {
    'rail-advert': ADS.gold,
    'advert-top': ADS.insurance,
    'advert-foot': ADS.family,
    'advert-left': ADS.ayurveda,
    'top-brief': {
      style: { displayFamily: 'khand-light', fontFamily: 'sans', headlineFontPx: 13.5, headlineLocked: true, bodyFontPx: 6.3, lineHeight: 1.328, columnCount: 2, textAlign: 'justify' },
      pictures: [],
      panels: [],
    },
    'lead': {
      style: { displayFamily: 'khand', fontFamily: 'sans', headlineFontPx: 23.5, headlineLocked: true, bodyFontPx: 6.3, lineHeight: 1.328, columnCount: 2, textAlign: 'justify', subheadingFontPx: 11.0, subheadingLocked: true },
      pictures: [{ file: 'reference-lokmat/broadsheet-jacket-lead-3.jpg', x: 89, y: 241, width: 82, height: 93 }],
      panels: [{ kind: 'sidebar', marker: 'number', x: 80, y: 91, width: 91, height: 145, titlePx: 9.4, linePx: 6.3, title: PLACEHOLDER, lines: points(5) }],
    },
    'rail-shorts': {
      style: { displayFamily: 'khand', fontFamily: 'sans', headlineFontPx: 9.0, headlineLocked: true, bodyFontPx: 5.9, lineHeight: 1.375, columnCount: 1, textAlign: 'justify', headlineStyle: 'kicker-label', accentColor: '#fb9f0b' },
      fixtureKicker: 'शॉर्ट्स',
      pictures: [],
      panels: [],
    },
    'weather-column': {
      style: { displayFamily: 'khand', fontFamily: 'sans', headlineFontPx: 13.0, headlineLocked: true, bodyFontPx: 6.3, lineHeight: 1.328, columnCount: 1, textAlign: 'justify' },
      pictures: [{ file: 'reference-lokmat/broadsheet-jacket-weather-column-5.jpg', x: 0, y: 7, width: 46, height: 47 }, { file: 'reference-lokmat/broadsheet-jacket-weather-column-8.jpg', x: 62, y: 276, width: 19, height: 47 }],
      panels: [],
    },
  },

  // MEASURED off the reference scan: sizes from each head's shirorekha, body at
  // the reference's own em and pitch, its colours, its picture and panel boxes.
  'broadsheet-city': {
    'rail-update': {
      style: { displayFamily: 'khand', fontFamily: 'sans', headlineFontPx: 8.5, headlineLocked: true, bodyFontPx: 5.7, lineHeight: 1.375, columnCount: 1, textAlign: 'justify', headlineStyle: 'kicker-label', accentColor: '#fb9f0b' },
      fixtureKicker: 'अपडेट',
      pictures: [],
      panels: [],
    },
    'rail-two': {
      style: { displayFamily: 'khand', fontFamily: 'sans', headlineFontPx: 8.5, headlineLocked: true, bodyFontPx: 5.7, lineHeight: 1.375, columnCount: 1, textAlign: 'justify' },
      pictures: [],
      panels: [],
    },
    'lead': {
      style: { displayFamily: 'khand', fontFamily: 'sans', headlineFontPx: 28.0, headlineLocked: true, bodyFontPx: 6.1, lineHeight: 1.328, columnCount: 4, textAlign: 'justify', subheadingFontPx: 10.5, subheadingLocked: true },
      pictures: [{ file: 'reference-lokmat/broadsheet-city-lead-1.jpg', x: 91, y: 98, width: 79, height: 93 }, { file: 'reference-lokmat/broadsheet-city-lead-2.jpg', x: 137, y: 119, width: 33, height: 72 }],
      panels: [{ kind: 'sidebar', x: 180, y: 92, width: 86, height: 111, titlePx: 9.0, linePx: 6.1, title: PLACEHOLDER, lines: points(4) }, { kind: 'sidebar', x: 269, y: 92, width: 81, height: 152, titlePx: 9.0, linePx: 6.1, title: PLACEHOLDER, lines: points(6) }, { kind: 'sidebar', x: 180, y: 252, width: 170, height: 67, titlePx: 9.0, linePx: 6.1, title: PLACEHOLDER, lines: points(3) }],
    },
    'right-top': {
      style: { displayFamily: 'khand-light', fontFamily: 'sans', headlineFontPx: 20.0, headlineLocked: true, bodyFontPx: 6.1, lineHeight: 1.328, columnCount: 2, textAlign: 'justify' },
      pictures: [{ file: 'reference-lokmat/broadsheet-city-right-top-0.jpg', x: 1, y: 1, width: 169, height: 82 }],
      panels: [],
    },
    'banner-report': {
      style: { displayFamily: 'khand', fontFamily: 'sans', headlineFontPx: 17.0, headlineLocked: true, bodyFontPx: 6.1, lineHeight: 1.328, columnCount: 5, textAlign: 'justify' },
      pictures: [],
      panels: [],
    },
    'half-advert': ADS.gold,
    'report-wide': {
      style: { displayFamily: 'khand-light', fontFamily: 'sans', headlineFontPx: 20.0, headlineLocked: true, bodyFontPx: 6.1, lineHeight: 1.328, columnCount: 3, textAlign: 'justify' },
      pictures: [],
      panels: [{ kind: 'sidebar', marker: 'number', x: 89, y: 51, width: 83, height: 189, titlePx: 9.0, linePx: 6.1, title: PLACEHOLDER, lines: points(3) }, { kind: 'quote', x: 175, y: 51, width: 86, height: 189, titlePx: 9.0, linePx: 6.1, title: PLACEHOLDER, lines: points(3) }],
    },
    'report-narrow': {
      style: { displayFamily: 'khand-light', fontFamily: 'sans', headlineFontPx: 14.5, headlineLocked: true, bodyFontPx: 6.1, lineHeight: 1.328, columnCount: 2, textAlign: 'justify' },
      pictures: [],
      panels: [],
    },
    'report-picture': {
      style: { displayFamily: 'khand-light', fontFamily: 'sans', headlineFontPx: 17.5, headlineLocked: true, bodyFontPx: 6.1, lineHeight: 1.328, columnCount: 2, textAlign: 'justify' },
      pictures: [{ file: 'reference-lokmat/broadsheet-city-report-picture-4.jpg', x: 89, y: 51, width: 81, height: 44 }],
      panels: [],
    },
  },

  // MEASURED off the reference scan: sizes from each head's shirorekha, body at
  // the reference's own em and pitch, its colours, its picture and panel boxes.
  'broadsheet-state': {
    'rail-one': {
      style: { displayFamily: 'khand', fontFamily: 'sans', headlineFontPx: 8.5, headlineLocked: true, bodyFontPx: 5.6, lineHeight: 1.375, columnCount: 1, textAlign: 'justify', headlineStyle: 'kicker-label', accentColor: '#fb9f0b' },
      fixtureKicker: 'अपडेट',
      pictures: [{ file: 'reference-lokmat/broadsheet-state-rail-one-1.jpg', x: 0, y: 40, width: 81, height: 71 }],
      panels: [],
    },
    'rail-two': {
      style: { displayFamily: 'khand', fontFamily: 'sans', headlineFontPx: 8.5, headlineLocked: true, bodyFontPx: 5.6, lineHeight: 1.375, columnCount: 1, textAlign: 'justify' },
      pictures: [],
      panels: [],
    },
    'rail-three': {
      style: { displayFamily: 'khand', fontFamily: 'sans', headlineFontPx: 8.5, headlineLocked: true, bodyFontPx: 5.6, lineHeight: 1.375, columnCount: 1, textAlign: 'justify' },
      pictures: [{ file: 'reference-lokmat/broadsheet-state-rail-three-5.jpg', x: 0, y: 154, width: 81, height: 75 }],
      panels: [],
    },
    'rail-four': {
      style: { displayFamily: 'khand', fontFamily: 'sans', headlineFontPx: 8.5, headlineLocked: true, bodyFontPx: 5.6, lineHeight: 1.375, columnCount: 1, textAlign: 'justify' },
      pictures: [],
      panels: [],
    },
    'rail-five': {
      style: { displayFamily: 'khand', fontFamily: 'sans', headlineFontPx: 8.5, headlineLocked: true, bodyFontPx: 5.6, lineHeight: 1.375, columnCount: 1, textAlign: 'justify' },
      pictures: [],
      panels: [],
    },
    'top-story': {
      style: { displayFamily: 'khand-light', fontFamily: 'sans', headlineFontPx: 18.0, headlineLocked: true, bodyFontPx: 6.0, lineHeight: 1.328, columnCount: 5, textAlign: 'justify' },
      pictures: [{ file: 'reference-lokmat/broadsheet-state-top-story-0.jpg', x: 91, y: 34, width: 349, height: 158 }, { file: 'reference-lokmat/broadsheet-state-top-story-2.jpg', x: 100, y: 166, width: 68, height: 66 }],
      panels: [],
    },
    'top-side': {
      style: { displayFamily: 'khand', fontFamily: 'sans', headlineFontPx: 10.5, headlineLocked: true, bodyFontPx: 5.6, lineHeight: 1.375, columnCount: 1, textAlign: 'justify' },
      pictures: [],
      panels: [],
    },
    'lead': {
      style: { displayFamily: 'khand', fontFamily: 'sans', headlineFontPx: 22.0, headlineLocked: true, bodyFontPx: 6.0, lineHeight: 1.328, columnCount: 4, textAlign: 'justify', subheadingFontPx: 10.5, subheadingLocked: true },
      pictures: [{ file: 'reference-lokmat/broadsheet-state-lead-4.jpg', x: 91, y: 105, width: 170, height: 140 }],
      panels: [{ kind: 'sidebar', tint: '#f4e4dc', x: 80, y: 226, width: 166, height: 78, titlePx: 8.8, linePx: 6.0, title: PLACEHOLDER, lines: points(3) }, { kind: 'sidebar', x: 249, y: 86, width: 100, height: 218, titlePx: 8.8, linePx: 6.0, title: PLACEHOLDER, lines: points(6) }],
    },
    'right': {
      style: { displayFamily: 'khand-light', fontFamily: 'sans', headlineFontPx: 22.0, headlineLocked: true, bodyFontPx: 6.0, lineHeight: 1.328, columnCount: 2, textAlign: 'justify' },
      pictures: [{ file: 'reference-lokmat/broadsheet-state-right-3.jpg', x: 90, y: 79, width: 81, height: 63 }],
      panels: [{ kind: 'quote', x: 0, y: 220, width: 84, height: 72, titlePx: 8.8, linePx: 6.0, title: PLACEHOLDER, lines: points(3) }],
    },
    'report-one': {
      style: { displayFamily: 'khand-light', fontFamily: 'sans', headlineFontPx: 17.0, headlineLocked: true, bodyFontPx: 6.0, lineHeight: 1.328, columnCount: 2, textAlign: 'justify' },
      pictures: [{ file: 'reference-lokmat/broadsheet-state-report-one-7.jpg', x: 0, y: 95, width: 39, height: 37 }],
      panels: [],
    },
    'report-two': {
      style: { displayFamily: 'khand-light', fontFamily: 'sans', headlineFontPx: 14.5, headlineLocked: true, bodyFontPx: 6.0, lineHeight: 1.328, columnCount: 1, textAlign: 'justify' },
      pictures: [],
      panels: [],
    },
    'report-picture': {
      style: { displayFamily: 'khand-light', fontFamily: 'sans', headlineFontPx: 14.5, headlineLocked: true, bodyFontPx: 6.0, lineHeight: 1.328, columnCount: 2, textAlign: 'justify' },
      pictures: [{ file: 'reference-lokmat/broadsheet-state-report-picture-6.jpg', x: 1, y: 50, width: 170, height: 110 }],
      panels: [],
    },
    'report-side': {
      style: { displayFamily: 'khand-light', fontFamily: 'sans', headlineFontPx: 14.5, headlineLocked: true, bodyFontPx: 6.0, lineHeight: 1.328, columnCount: 1, textAlign: 'justify' },
      pictures: [],
      panels: [],
    },
    'feature-strip': {
      style: { displayFamily: 'khand-light', fontFamily: 'sans', headlineFontPx: 18.0, headlineLocked: true, bodyFontPx: 6.0, lineHeight: 1.328, columnCount: 4, textAlign: 'justify', headlineStyle: 'kicker-chip-rule', accentColor: '#e42424', borderInk: '#fb9f0b', headlineAlign: 'center' },
      fixtureKicker: 'जरूर वाचा',
      pictures: [{ file: 'reference-lokmat/broadsheet-state-feature-strip-9.jpg', x: 91, y: 113, width: 39, height: 45 }],
      panels: [{ kind: 'sidebar', marker: 'number', x: 165, y: 53, width: 84, height: 179, titlePx: 8.8, linePx: 6.0, title: PLACEHOLDER, lines: points(3) }, { kind: 'sidebar', x: 252, y: 53, width: 97, height: 179, titlePx: 8.8, linePx: 6.0, title: PLACEHOLDER, lines: points(5) }],
    },
    'right-foot': {
      style: { displayFamily: 'khand-light', fontFamily: 'sans', headlineFontPx: 17.0, headlineLocked: true, bodyFontPx: 6.0, lineHeight: 1.328, columnCount: 2, textAlign: 'justify' },
      pictures: [{ file: 'reference-lokmat/broadsheet-state-right-foot-8.jpg', x: 90, y: 93, width: 81, height: 52 }],
      panels: [],
    },
  },

  // MEASURED off the reference scan: sizes from each head's shirorekha, body at
  // the reference's own em and pitch, its colours, its picture and panel boxes.
  'broadsheet-local': {
    'left-column': {
      style: { displayFamily: 'khand', fontFamily: 'sans', headlineFontPx: 14.0, headlineLocked: true, bodyFontPx: 6.0, lineHeight: 1.328, columnCount: 1, textAlign: 'justify' },
      pictures: [],
      panels: [],
    },
    'lead': {
      style: { displayFamily: 'khand', fontFamily: 'sans', headlineFontPx: 24.0, headlineLocked: true, bodyFontPx: 6.0, lineHeight: 1.328, columnCount: 3, textAlign: 'justify', subheadingFontPx: 10.5, subheadingLocked: true },
      pictures: [{ file: 'reference-lokmat/broadsheet-local-lead-0.jpg', x: 91, y: 97, width: 79, height: 99 }],
      panels: [{ kind: 'sidebar', x: 162, y: 82, width: 97, height: 176, titlePx: 8.8, linePx: 6.0, title: PLACEHOLDER, lines: points(6) }, { kind: 'sidebar', x: 162, y: 261, width: 97, height: 75, titlePx: 8.8, linePx: 6.0, title: PLACEHOLDER, lines: points(3) }],
    },
    'short-story': {
      style: { displayFamily: 'khand', fontFamily: 'sans', headlineFontPx: 12.0, headlineLocked: true, bodyFontPx: 6.0, lineHeight: 1.328, columnCount: 1, textAlign: 'justify' },
      pictures: [],
      panels: [],
    },
    'corner-advert': ADS.gold,
    'wide-report': {
      style: { displayFamily: 'khand-light', fontFamily: 'sans', headlineFontPx: 17.0, headlineLocked: true, bodyFontPx: 6.0, lineHeight: 1.328, columnCount: 3, textAlign: 'justify' },
      pictures: [],
      panels: [],
    },
    'report-panel': {
      style: { displayFamily: 'khand-light', fontFamily: 'sans', headlineFontPx: 17.0, headlineLocked: true, bodyFontPx: 6.0, lineHeight: 1.328, columnCount: 3, textAlign: 'justify' },
      pictures: [],
      panels: [{ kind: 'quote', x: 170, y: 18, width: 127, height: 52, titlePx: 8.8, linePx: 6.0, title: PLACEHOLDER, lines: points(2) }, { kind: 'sidebar', tint: '#f4e4dc', x: 170, y: 77, width: 127, height: 85, titlePx: 8.8, linePx: 6.0, title: PLACEHOLDER, lines: points(4) }],
    },
    'photo-story': {
      style: { displayFamily: 'khand', fontFamily: 'sans', headlineFontPx: 10.5, headlineLocked: true, bodyFontPx: 6.0, lineHeight: 1.328, columnCount: 2, textAlign: 'justify' },
      pictures: [{ file: 'reference-lokmat/broadsheet-local-photo-story-2.jpg', x: 0, y: 11, width: 158, height: 141 }],
      panels: [],
    },
    'report-small': {
      style: { displayFamily: 'khand-light', fontFamily: 'sans', headlineFontPx: 14.5, headlineLocked: true, bodyFontPx: 6.0, lineHeight: 1.328, columnCount: 2, textAlign: 'justify' },
      pictures: [],
      panels: [],
    },
    'half-advert': ADS.insurance,
    'feature-strip': {
      style: { displayFamily: 'khand-light', fontFamily: 'sans', headlineFontPx: 18.0, headlineLocked: true, bodyFontPx: 6.0, lineHeight: 1.328, columnCount: 3, textAlign: 'justify', headlineStyle: 'kicker-chip-rule', accentColor: '#e42424', borderInk: '#fb9f0b', headlineAlign: 'center' },
      fixtureKicker: 'जरूर वाचा',
      pictures: [],
      panels: [{ kind: 'sidebar', x: 170, y: 100, width: 140, height: 65, titlePx: 8.8, linePx: 6.0, title: PLACEHOLDER, lines: points(3) }, { kind: 'sidebar', x: 170, y: 172, width: 140, height: 68, titlePx: 8.8, linePx: 6.0, title: PLACEHOLDER, lines: points(3) }],
    },
  },

  // MEASURED off the reference scan: sizes from each head's shirorekha, body at
  // the reference's own em and pitch, its colours, its picture and panel boxes.
  'broadsheet-opinion': {
    'editorial': {
      style: { displayFamily: 'khand-light', fontFamily: 'sans', headlineFontPx: 14.5, headlineLocked: true, bodyFontPx: 6.0, lineHeight: 1.328, columnCount: 2, textAlign: 'justify', headlineStyle: 'kicker-accent', accentColor: '#e42424' },
      fixtureKicker: 'संपादकीय',
      pictures: [],
      panels: [],
    },
    'opinion-lead': {
      style: { displayFamily: 'khand', fontFamily: 'sans', headlineFontPx: 19.0, headlineLocked: true, bodyFontPx: 6.0, lineHeight: 1.328, columnCount: 4, textAlign: 'justify', subheadingFontPx: 10.0, subheadingLocked: true, headlineAlign: 'center' },
      pictures: [{ file: 'reference-lokmat/broadsheet-opinion-opinion-lead-0.jpg', x: 246, y: 49, width: 78, height: 61 }, { file: 'reference-lokmat/broadsheet-opinion-opinion-lead-1.jpg', x: 16, y: 79, width: 83, height: 27 }],
      panels: [{ kind: 'sidebar', tint: '#fce4cc', x: 0, y: 80, width: 113, height: 25, titlePx: 8.8, linePx: 6.0, title: PLACEHOLDER, lines: points(2) }],
    },
    'opinion-two': {
      style: { displayFamily: 'khand-light', fontFamily: 'sans', headlineFontPx: 19.5, headlineLocked: true, bodyFontPx: 6.0, lineHeight: 1.328, columnCount: 4, textAlign: 'justify', subheadingFontPx: 10.5, subheadingLocked: true, headlineStyle: 'kicker-accent', accentColor: '#e42424' },
      fixtureKicker: 'कामगारनामा',
      pictures: [{ file: 'reference-lokmat/broadsheet-opinion-opinion-two-2.jpg', x: 0, y: 68, width: 105, height: 39 }],
      panels: [{ kind: 'sidebar', tint: '#fce4cc', x: 0, y: 41, width: 113, height: 39, titlePx: 8.8, linePx: 6.0, title: PLACEHOLDER, lines: points(2) }],
    },
    'column': {
      style: { displayFamily: 'khand', fontFamily: 'sans', headlineFontPx: 14.0, headlineLocked: true, bodyFontPx: 6.0, lineHeight: 1.328, columnCount: 4, textAlign: 'justify', headlineStyle: 'kicker-accent', accentColor: '#e42424' },
      fixtureKicker: 'जगभर',
      pictures: [{ file: 'reference-lokmat/broadsheet-opinion-column-3.jpg', x: 229, y: 32, width: 105, height: 57 }],
      panels: [],
    },
    'commentary': {
      style: { displayFamily: 'khand', fontFamily: 'sans', headlineFontPx: 12.0, headlineLocked: true, bodyFontPx: 6.0, lineHeight: 1.328, columnCount: 1, textAlign: 'justify', headlineStyle: 'kicker-accent', accentColor: '#e42424' },
      fixtureKicker: 'जनमन',
      pictures: [{ file: 'reference-lokmat/broadsheet-opinion-commentary-4.jpg', x: 94, y: 45, width: 78, height: 42 }],
      panels: [],
    },
    'opinion-three': {
      style: { displayFamily: 'khand-light', fontFamily: 'sans', headlineFontPx: 19.5, headlineLocked: true, bodyFontPx: 6.0, lineHeight: 1.328, columnCount: 4, textAlign: 'justify', subheadingFontPx: 10.5, subheadingLocked: true, headlineStyle: 'kicker-accent', accentColor: '#e42424' },
      fixtureKicker: 'सज्जनशक्ती',
      pictures: [{ file: 'reference-lokmat/broadsheet-opinion-opinion-three-5.jpg', x: 229, y: 45, width: 105, height: 59 }, { file: 'reference-lokmat/broadsheet-opinion-opinion-three-6.jpg', x: 0, y: 78, width: 105, height: 26 }],
      panels: [{ kind: 'sidebar', tint: '#fce4cc', x: 0, y: 85, width: 116, height: 33, titlePx: 8.8, linePx: 6.0, title: PLACEHOLDER, lines: points(2) }],
    },
    'cartoon': {
      style: { displayFamily: 'khand', fontFamily: 'sans', headlineFontPx: 10.5, headlineLocked: true, bodyFontPx: 6.0, lineHeight: 1.328, columnCount: 1, textAlign: 'justify', headlineStyle: 'kicker-accent', accentColor: '#e42424' },
      fixtureKicker: 'तिरकस आणि चौकस',
      pictures: [{ file: 'reference-lokmat/broadsheet-opinion-cartoon-7.jpg', x: 68, y: 15, width: 103, height: 106 }, { file: 'reference-lokmat/broadsheet-opinion-cartoon-8.jpg', x: 33, y: 62, width: 42, height: 60 }],
      panels: [],
    },
  },

  'broadsheet-advertorial': { 'page-advert': ADS.whole },

  // MEASURED off the reference scan: sizes from each head's shirorekha, body at
  // the reference's own em and pitch, its colours, its picture and panel boxes.
  'broadsheet-local-sport': {
    'sport-left': {
      style: { displayFamily: 'khand-light', fontFamily: 'sans', headlineFontPx: 15.5, headlineLocked: true, bodyFontPx: 6.0, lineHeight: 1.328, columnCount: 2, textAlign: 'justify', subheadingFontPx: 9.0, subheadingLocked: true },
      pictures: [{ file: 'reference-lokmat/broadsheet-local-sport-sport-left-0.jpg', x: 90, y: 61, width: 71, height: 42 }],
      panels: [],
    },
    'sport-lead': {
      style: { displayFamily: 'khand', fontFamily: 'sans', headlineFontPx: 26.0, headlineLocked: true, bodyFontPx: 6.0, lineHeight: 1.328, columnCount: 3, textAlign: 'justify', subheadingFontPx: 10.5, subheadingLocked: true },
      pictures: [{ file: 'reference-lokmat/broadsheet-local-sport-sport-lead-2.jpg', x: 89, y: 84, width: 48, height: 45 }, { file: 'reference-lokmat/broadsheet-local-sport-sport-lead-3.jpg', x: 143, y: 84, width: 46, height: 52 }, { file: 'reference-lokmat/broadsheet-local-sport-sport-lead-4.jpg', x: 89, y: 146, width: 48, height: 50 }, { file: 'reference-lokmat/broadsheet-local-sport-sport-lead-5.jpg', x: 143, y: 146, width: 46, height: 43 }],
      panels: [],
    },
    'sport-right': {
      style: { displayFamily: 'khand-light', fontFamily: 'sans', headlineFontPx: 17.0, headlineLocked: true, bodyFontPx: 6.0, lineHeight: 1.328, columnCount: 2, textAlign: 'justify', subheadingFontPx: 9.0, subheadingLocked: true },
      pictures: [{ file: 'reference-lokmat/broadsheet-local-sport-sport-right-1.jpg', x: 90, y: 66, width: 81, height: 81 }],
      panels: [],
    },
    'notice-left': ADS.gold,
    'notice-mid': ADS.insurance,
    'notice-right': ADS.family,
    'notice-foot': ADS.ayurveda,
    'notice-foot-right': ADS.masala,
    'sport-report': {
      style: { displayFamily: 'khand', fontFamily: 'sans', headlineFontPx: 16.5, headlineLocked: true, bodyFontPx: 6.0, lineHeight: 1.328, columnCount: 3, textAlign: 'justify', subheadingFontPx: 8.5, subheadingLocked: true },
      pictures: [{ file: 'reference-lokmat/broadsheet-local-sport-sport-report-6.jpg', x: 38, y: 42, width: 30, height: 29 }, { file: 'reference-lokmat/broadsheet-local-sport-sport-report-7.jpg', x: 71, y: 42, width: 30, height: 31 }],
      panels: [],
    },
    'scorecard': {
      style: { displayFamily: 'khand', fontFamily: 'sans', headlineFontPx: 10.5, headlineLocked: true, bodyFontPx: 5.6, lineHeight: 1.375, columnCount: 1, textAlign: 'justify' },
      pictures: [],
      panels: [],
    },
    'sport-brief': {
      style: { displayFamily: 'khand-light', fontFamily: 'sans', headlineFontPx: 14.5, headlineLocked: true, bodyFontPx: 6.0, lineHeight: 1.328, columnCount: 1, textAlign: 'justify' },
      pictures: [],
      panels: [],
    },
    'result-box': {
      style: { displayFamily: 'khand', fontFamily: 'sans', headlineFontPx: 10.5, headlineLocked: true, bodyFontPx: 5.6, lineHeight: 1.375, columnCount: 1, textAlign: 'justify', backgroundColor: '#f4e4dc', borderRadiusPx: 0 },
      pictures: [],
      panels: [],
    },
  },

  // MEASURED off the reference scan: sizes from each head's shirorekha, body at
  // the reference's own em and pitch, its colours, its picture and panel boxes.
  'broadsheet-miscellany': {
    'profile-feature': {
      style: { displayFamily: 'khand', fontFamily: 'sans', headlineFontPx: 12.0, headlineLocked: true, bodyFontPx: 6.0, lineHeight: 1.328, columnCount: 2, textAlign: 'justify', headlineStyle: 'kicker-accent', accentColor: '#e42424', borderInk: '#b06a08', borderStyle: 'box' },
      fixtureKicker: 'रत्नमाला',
      pictures: [{ file: 'reference-lokmat/broadsheet-miscellany-profile-feature-0.jpg', x: 98, y: 53, width: 35, height: 35 }, { file: 'reference-lokmat/broadsheet-miscellany-profile-feature-1.jpg', x: 90, y: 116, width: 50, height: 50 }],
      panels: [{ kind: 'sidebar', tint: '#fce4cc', x: 0, y: 245, width: 216, height: 254, titlePx: 8.8, linePx: 6.0, title: PLACEHOLDER, lines: points(10) }],
    },
    'lead': {
      style: { displayFamily: 'khand', fontFamily: 'sans', headlineFontPx: 21.0, headlineLocked: true, bodyFontPx: 6.0, lineHeight: 1.328, columnCount: 3, textAlign: 'justify', subheadingFontPx: 9.0, subheadingLocked: true },
      pictures: [],
      panels: [{ kind: 'sidebar', x: 69, y: 82, width: 61, height: 117, titlePx: 8.8, linePx: 6.0, title: PLACEHOLDER, lines: points(5) }, { kind: 'sidebar', x: 134, y: 82, width: 36, height: 117, titlePx: 8.8, linePx: 6.0, title: PLACEHOLDER, lines: points(5) }],
    },
    'world-brief': {
      style: { displayFamily: 'khand-light', fontFamily: 'sans', headlineFontPx: 14.5, headlineLocked: true, bodyFontPx: 6.0, lineHeight: 1.328, columnCount: 2, textAlign: 'justify' },
      pictures: [],
      panels: [],
    },
    'cabinet-report': {
      style: { displayFamily: 'khand-light', fontFamily: 'sans', headlineFontPx: 17.0, headlineLocked: true, bodyFontPx: 6.0, lineHeight: 1.328, columnCount: 3, textAlign: 'justify' },
      pictures: [],
      panels: [],
    },
    'tender-advert': ADS.gold,
    'recruit-advert-left': ADS.insurance,
    'recruit-advert-right': ADS.family,
    'strip-advert': ADS.ayurveda,
    'bank-advert': ADS.masala,
    'court-report': {
      style: { displayFamily: 'khand-light', fontFamily: 'sans', headlineFontPx: 14.5, headlineLocked: true, bodyFontPx: 6.0, lineHeight: 1.328, columnCount: 1, textAlign: 'justify' },
      pictures: [],
      panels: [],
    },
    'world-report': {
      style: { displayFamily: 'khand-light', fontFamily: 'sans', headlineFontPx: 14.5, headlineLocked: true, bodyFontPx: 6.0, lineHeight: 1.328, columnCount: 3, textAlign: 'justify' },
      pictures: [],
      panels: [{ kind: 'sidebar', x: 170, y: 23, width: 140, height: 121, titlePx: 8.8, linePx: 6.0, title: PLACEHOLDER, lines: points(6) }],
    },
    'feature-strip': {
      style: { displayFamily: 'khand-light', fontFamily: 'sans', headlineFontPx: 21.5, headlineLocked: true, bodyFontPx: 6.0, lineHeight: 1.328, columnCount: 3, textAlign: 'justify', headlineStyle: 'kicker-chip-rule', accentColor: '#e42424', borderInk: '#fb9f0b', headlineAlign: 'center' },
      fixtureKicker: 'जरूर वाचा',
      pictures: [],
      panels: [{ kind: 'sidebar', marker: 'number', x: 107, y: 73, width: 78, height: 127, titlePx: 8.8, linePx: 6.0, title: PLACEHOLDER, lines: points(3) }, { kind: 'sidebar', x: 194, y: 73, width: 116, height: 127, titlePx: 8.8, linePx: 6.0, title: PLACEHOLDER, lines: points(5) }],
    },
  },

  // MEASURED off the reference scan: sizes from each head's shirorekha, body at
  // the reference's own em and pitch, its colours, its picture and panel boxes.
  'broadsheet-business': {
    'lead': {
      style: { displayFamily: 'khand', fontFamily: 'sans', headlineFontPx: 22.0, headlineLocked: true, bodyFontPx: 6.0, lineHeight: 1.328, columnCount: 4, textAlign: 'justify', subheadingFontPx: 9.0, subheadingLocked: true },
      pictures: [{ file: 'reference-lokmat/broadsheet-business-lead-0.jpg', x: 107, y: 190, width: 28, height: 58 }, { file: 'reference-lokmat/broadsheet-business-lead-1.jpg', x: 262, y: 192, width: 103, height: 72 }],
      panels: [{ kind: 'chart', card: {'chartType': 'bar', 'unit': '', 'items': [{'label': 'इथे मजकूर लिहा 1', 'value': 2877}, {'label': 'इथे मजकूर लिहा 2', 'value': 2814}, {'label': 'इथे मजकूर लिहा 3', 'value': 2701}, {'label': 'इथे मजकूर लिहा 4', 'value': 2596}]}, x: 84, y: 85, width: 168, height: 52, titlePx: 8.8, linePx: 6.0 }, { kind: 'chart', card: {'chartType': 'line', 'unit': '', 'items': [{'label': 'इथे मजकूर लिहा 1', 'value': 113}, {'label': 'इथे मजकूर लिहा 2', 'value': 196}, {'label': 'इथे मजकूर लिहा 3', 'value': 184}, {'label': 'इथे मजकूर लिहा 4', 'value': 197}, {'label': 'इथे मजकूर लिहा 5', 'value': 132}, {'label': 'इथे मजकूर लिहा 6', 'value': 128}]}, x: 84, y: 140, width: 168, height: 117, titlePx: 8.8, linePx: 6.0 }, { kind: 'sidebar', tint: '#f4e4dc', x: 258, y: 82, width: 81, height: 176, titlePx: 8.8, linePx: 6.0, title: PLACEHOLDER, lines: points(6) }, { kind: 'sidebar', x: 342, y: 82, width: 97, height: 176, titlePx: 8.8, linePx: 6.0, title: PLACEHOLDER, lines: points(8) }],
    },
    'right-chart': {
      style: { displayFamily: 'khand-light', fontFamily: 'sans', headlineFontPx: 17.0, headlineLocked: true, bodyFontPx: 6.0, lineHeight: 1.328, columnCount: 2, textAlign: 'justify', subheadingFontPx: 9.0, subheadingLocked: true },
      pictures: [{ file: 'reference-lokmat/broadsheet-business-right-chart-2.jpg', x: 99, y: 202, width: 72, height: 151 }],
      panels: [{ kind: 'chart', card: {'chartType': 'line', 'unit': '', 'items': [{'label': 'इथे मजकूर लिहा 1', 'value': 2320}, {'label': 'इथे मजकूर लिहा 2', 'value': 2272}, {'label': 'इथे मजकूर लिहा 3', 'value': 2366}, {'label': 'इथे मजकूर लिहा 4', 'value': 2451}]}, x: 0, y: 98, width: 171, height: 88, titlePx: 8.8, linePx: 6.0 }, { kind: 'sidebar', marker: 'number', x: 0, y: 355, width: 87, height: 101, titlePx: 8.8, linePx: 6.0, title: PLACEHOLDER, lines: points(3) }, { kind: 'sidebar', x: 87, y: 355, width: 84, height: 101, titlePx: 8.8, linePx: 6.0, title: PLACEHOLDER, lines: points(4) }],
    },
    'brief': {
      style: { displayFamily: 'khand', fontFamily: 'sans', headlineFontPx: 12.0, headlineLocked: true, bodyFontPx: 6.0, lineHeight: 1.328, columnCount: 1, textAlign: 'justify' },
      pictures: [],
      panels: [],
    },
    'report': {
      style: { displayFamily: 'khand', fontFamily: 'sans', headlineFontPx: 16.5, headlineLocked: true, bodyFontPx: 6.0, lineHeight: 1.328, columnCount: 3, textAlign: 'justify' },
      pictures: [{ file: 'reference-lokmat/broadsheet-business-report-3.jpg', x: 89, y: 40, width: 81, height: 65 }],
      panels: [{ kind: 'sidebar', x: 168, y: 40, width: 92, height: 144, titlePx: 8.8, linePx: 6.0, title: PLACEHOLDER, lines: points(6) }],
    },
    'report-side': {
      style: { displayFamily: 'khand', fontFamily: 'sans', headlineFontPx: 12.0, headlineLocked: true, bodyFontPx: 6.0, lineHeight: 1.328, columnCount: 1, textAlign: 'justify' },
      pictures: [],
      panels: [],
    },
    'film-panel': {
      style: { displayFamily: 'khand', fontFamily: 'sans', headlineFontPx: 16.5, headlineLocked: true, bodyFontPx: 6.0, lineHeight: 1.328, columnCount: 1, textAlign: 'justify', headlineStyle: 'kicker-accent', accentColor: '#e42424', backgroundColor: '#f2dce4', borderRadiusPx: 0 },
      fixtureKicker: 'मनोरंजन',
      pictures: [{ file: 'reference-lokmat/broadsheet-business-film-panel-4.jpg', x: 0, y: 10, width: 151, height: 296 }, { file: 'reference-lokmat/broadsheet-business-film-panel-5.jpg', x: 131, y: 21, width: 113, height: 47 }],
      panels: [],
    },
    'poster-story': {
      style: { displayFamily: 'khand', fontFamily: 'sans', headlineFontPx: 16.5, headlineLocked: true, bodyFontPx: 6.0, lineHeight: 1.328, columnCount: 1, textAlign: 'justify', headlineStyle: 'reverse', accentColor: '#3f4a56' },
      pictures: [{ file: 'reference-lokmat/broadsheet-business-poster-story-6.jpg', x: 0, y: 233, width: 80, height: 255 }],
      panels: [],
    },
    'film-story': {
      style: { displayFamily: 'khand-light', fontFamily: 'sans', headlineFontPx: 17.0, headlineLocked: true, bodyFontPx: 6.0, lineHeight: 1.328, columnCount: 2, textAlign: 'justify' },
      pictures: [{ file: 'reference-lokmat/broadsheet-business-film-story-7.jpg', x: 120, y: 16, width: 125, height: 141 }],
      panels: [],
    },
    'jump-one': {
      style: { displayFamily: 'khand-light', fontFamily: 'sans', headlineFontPx: 14.5, headlineLocked: true, bodyFontPx: 6.0, lineHeight: 1.328, columnCount: 3, textAlign: 'justify' },
      pictures: [],
      panels: [],
    },
    'jump-two': {
      style: { displayFamily: 'khand-light', fontFamily: 'sans', headlineFontPx: 14.5, headlineLocked: true, bodyFontPx: 6.0, lineHeight: 1.328, columnCount: 3, textAlign: 'justify' },
      pictures: [],
      panels: [],
    },
    'jump-three': {
      style: { displayFamily: 'khand-light', fontFamily: 'sans', headlineFontPx: 14.5, headlineLocked: true, bodyFontPx: 6.0, lineHeight: 1.328, columnCount: 3, textAlign: 'justify' },
      pictures: [],
      panels: [],
    },
  },

  // MEASURED off the reference scan: sizes from each head's shirorekha, body at
  // the reference's own em and pitch, its colours, its picture and panel boxes.
  'broadsheet-world': {
    'rail-one': {
      style: { displayFamily: 'khand', fontFamily: 'sans', headlineFontPx: 8.5, headlineLocked: true, bodyFontPx: 5.6, lineHeight: 1.375, columnCount: 1, textAlign: 'justify', headlineStyle: 'kicker-label', accentColor: '#0b8bd3' },
      fixtureKicker: 'फॅक्ट चेक',
      pictures: [{ file: 'reference-lokmat/broadsheet-world-rail-one-1.jpg', x: 0, y: 51, width: 78, height: 63 }],
      panels: [],
    },
    'rail-two': {
      style: { displayFamily: 'khand', fontFamily: 'sans', headlineFontPx: 8.5, headlineLocked: true, bodyFontPx: 5.6, lineHeight: 1.375, columnCount: 1, textAlign: 'justify', headlineStyle: 'kicker-label', accentColor: '#0b8bd3' },
      fixtureKicker: 'सोशल व्हायरल',
      pictures: [{ file: 'reference-lokmat/broadsheet-world-rail-two-5.jpg', x: 0, y: 27, width: 81, height: 58 }],
      panels: [],
    },
    'rail-three': {
      style: { displayFamily: 'khand', fontFamily: 'sans', headlineFontPx: 8.5, headlineLocked: true, bodyFontPx: 5.6, lineHeight: 1.375, columnCount: 1, textAlign: 'justify', headlineStyle: 'kicker-label', accentColor: '#0b8bd3' },
      fixtureKicker: 'ट्रेंडिंग',
      pictures: [],
      panels: [],
    },
    'rail-four': {
      style: { displayFamily: 'khand', fontFamily: 'sans', headlineFontPx: 8.5, headlineLocked: true, bodyFontPx: 5.6, lineHeight: 1.375, columnCount: 1, textAlign: 'justify' },
      pictures: [],
      panels: [],
    },
    'top-story': {
      style: { displayFamily: 'khand-light', fontFamily: 'sans', headlineFontPx: 15.5, headlineLocked: true, bodyFontPx: 6.0, lineHeight: 1.328, columnCount: 5, textAlign: 'justify' },
      pictures: [{ file: 'reference-lokmat/broadsheet-world-top-story-0.jpg', x: 91, y: 34, width: 170, height: 76 }],
      panels: [{ kind: 'sidebar', x: 249, y: 29, width: 139, height: 115, titlePx: 8.8, linePx: 6.0, title: PLACEHOLDER, lines: points(8) }, { kind: 'sidebar', x: 391, y: 29, width: 139, height: 115, titlePx: 8.8, linePx: 6.0, title: PLACEHOLDER, lines: points(8) }],
    },
    'lead': {
      style: { displayFamily: 'khand', fontFamily: 'sans', headlineFontPx: 22.0, headlineLocked: true, bodyFontPx: 6.0, lineHeight: 1.328, columnCount: 4, textAlign: 'justify', subheadingFontPx: 10.5, subheadingLocked: true },
      pictures: [{ file: 'reference-lokmat/broadsheet-world-lead-4.jpg', x: 91, y: 98, width: 170, height: 84 }, { file: 'reference-lokmat/broadsheet-world-lead-6.jpg', x: 91, y: 195, width: 170, height: 80 }],
      panels: [{ kind: 'sidebar', x: 249, y: 85, width: 74, height: 229, titlePx: 8.8, linePx: 6.0, title: PLACEHOLDER, lines: points(10) }],
    },
    'right': {
      style: { displayFamily: 'khand-light', fontFamily: 'sans', headlineFontPx: 19.5, headlineLocked: true, bodyFontPx: 6.0, lineHeight: 1.328, columnCount: 2, textAlign: 'justify', subheadingFontPx: 9.0, subheadingLocked: true },
      pictures: [{ file: 'reference-lokmat/broadsheet-world-right-2.jpg', x: 90, y: 71, width: 81, height: 57 }, { file: 'reference-lokmat/broadsheet-world-right-3.jpg', x: 143, y: 71, width: 28, height: 26 }],
      panels: [{ kind: 'sidebar', marker: 'number', x: 87, y: 132, width: 84, height: 85, titlePx: 8.8, linePx: 6.0, title: PLACEHOLDER, lines: points(3) }],
    },
    'report-panel': {
      style: { displayFamily: 'khand', fontFamily: 'sans', headlineFontPx: 16.5, headlineLocked: true, bodyFontPx: 6.0, lineHeight: 1.328, columnCount: 2, textAlign: 'justify', subheadingFontPx: 8.5, subheadingLocked: true },
      pictures: [],
      panels: [{ kind: 'sidebar', tint: '#f4e4dc', x: 80, y: 55, width: 76, height: 160, titlePx: 8.8, linePx: 6.0, title: PLACEHOLDER, lines: points(8) }],
    },
    'report-narrow': {
      style: { displayFamily: 'khand-light', fontFamily: 'sans', headlineFontPx: 17.0, headlineLocked: true, bodyFontPx: 6.0, lineHeight: 1.328, columnCount: 2, textAlign: 'justify' },
      pictures: [],
      panels: [],
    },
    'strip': {
      style: { displayFamily: 'khand', fontFamily: 'sans', headlineFontPx: 10.5, headlineLocked: true, bodyFontPx: 6.0, lineHeight: 1.328, columnCount: 3, textAlign: 'justify' },
      pictures: [],
      panels: [],
    },
    'advert': ADS.gold,
    'feature-strip': {
      style: { displayFamily: 'khand-light', fontFamily: 'sans', headlineFontPx: 21.5, headlineLocked: true, bodyFontPx: 6.0, lineHeight: 1.328, columnCount: 4, textAlign: 'justify', headlineStyle: 'kicker-chip-rule', accentColor: '#e42424', borderInk: '#fb9f0b', headlineAlign: 'center' },
      fixtureKicker: 'जरूर वाचा',
      pictures: [{ file: 'reference-lokmat/broadsheet-world-feature-strip-14.jpg', x: 103, y: 82, width: 92, height: 67 }],
      panels: [{ kind: 'sidebar', x: 181, y: 74, width: 97, height: 134, titlePx: 8.8, linePx: 6.0, title: PLACEHOLDER, lines: points(6) }, { kind: 'sidebar', marker: 'number', x: 284, y: 74, width: 66, height: 134, titlePx: 8.8, linePx: 6.0, title: PLACEHOLDER, lines: points(3) }],
    },
  },

};

// THE SECTION A PAGE NAMES IN ITS FOLIO. The reference carries its section in
// every inside page's head - आपला महाराष्ट्र, आपले मैदान, आपला पैसा - and this
// paper's folio already draws a section name from the page's theme
// (page-styles.js). Only the theme COLUMN is set: dressing the page through the
// styler would re-dress every block the recipe has just dressed. A layout the
// catalogue has no section for (opinion, notices, the jacket) names none, which
// is better than naming a wrong one.
const PAGE_THEME = {
  'broadsheet-city': 'city',
  'broadsheet-local': 'city',
  'broadsheet-state': 'state',
  'broadsheet-business': 'business',
  'broadsheet-sport': 'sport',
  'broadsheet-local-sport': 'sport',
  'broadsheet-world': 'world',
};

function pageThemeFor(templateKey) {
  return PAGE_THEME[templateKey] || null;
}

function recipeFor(templateKey) {
  return RECIPES[templateKey] || null;
}

module.exports = { RECIPES, recipeFor, PAGE_THEME, pageThemeFor };
