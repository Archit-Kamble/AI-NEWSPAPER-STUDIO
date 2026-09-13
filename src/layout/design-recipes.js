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

const RECIPES = {
  'broadsheet-front': {
    'banner-package': {
      style: { displayFamily: 'mukta', headlineFontPx: 28, headlineLocked: true, bodyFontPx: 7, columnCount: 3 },
      panels: [{ kind: 'sidebar', marker: 'number', x: 334, y: 34, width: 130, height: 118, title: PLACEHOLDER, lines: points(3) }],
      pictures: [{ file: 'person1.jpg', x: 267, y: 34, width: 61, height: 118 }],
    },
    'banner-advert': ADS.gold,
    'service-rail': { style: rail(13, { borderStyle: 'rule' }) },
    shorts: {
      style: rail(12, { headlineInk: ORANGE }),
      pictures: [{ file: 'scene2.jpg', x: 0, y: 24, width: 72, height: 86 }],
    },
    lead: {
      style: lead(35, 4),
      panels: [
        { kind: 'sidebar', marker: 'none', tint: CREAM, x: 97, y: 218, width: 93, height: 117, title: PLACEHOLDER, lines: points(2) },
        { kind: 'sidebar', marker: 'number', x: 196, y: 218, width: 77, height: 142, title: PLACEHOLDER, lines: points(3) },
      ],
      pictures: [{ file: 'crowd1.jpg', x: 73, y: 107, width: 300, height: 58 }],
    },
    'right-top': {
      style: story('mukta', 22, { subheadingFontPx: 11, columnCount: 2 }),
      panels: [{ kind: 'quote', x: 76, y: 130, width: 74, height: 60, lines: [PLACEHOLDER] }],
    },
    'right-low': {
      style: story('mukta', 22, { columnCount: 2 }),
      pictures: [{ file: 'scene1.jpg', x: 76, y: 40, width: 72, height: 46 }],
    },
    'report-one': { style: story('khand', 20, { subheadingFontPx: 11, columnCount: 4 }) },
    'report-two': { style: story('mukta', 17, { subheadingFontPx: 10, columnCount: 3 }) },
    'feature-strip': {
      style: strip(22, 4),
      fixtureKicker: 'विशेष',
      panels: [{
        kind: 'chart', x: 178, y: 75, width: 84, height: 133,
        card: { chartType: 'stat', unit: '%', items: [{ label: PLACEHOLDER, value: 74 }, { label: PLACEHOLDER, value: 65 }, { label: PLACEHOLDER, value: 48 }] },
      }],
      pictures: [{ file: 'person1.jpg', x: 87, y: 75, width: 84, height: 133 }],
    },
    'foot-advert': ADS.pharma,
  },

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
      panels: [{ kind: 'sidebar', marker: 'none', tint: '#c9e7f3', x: 234, y: 106, width: 116, height: 188, title: PLACEHOLDER, lines: points(6) }],
    },
    'second': {
      style: { displayFamily: 'khand', fontFamily: 'sans', headlineFontPx: 19.5, headlineLocked: true, bodyFontPx: 6.0, lineHeight: 1.328, columnCount: 2, textAlign: 'justify', subheadingFontPx: 9.0, subheadingLocked: true },
      pictures: [{ file: 'reference-lokmat/sport-second.jpg', x: 83, y: 58, width: 87, height: 165 }],
      panels: [{ kind: 'sidebar', marker: 'none', x: 83, y: 224, width: 88, height: 69, title: PLACEHOLDER, lines: points(4) }],
    },
    'report-left': {
      style: { displayFamily: 'khand', fontFamily: 'sans', headlineFontPx: 19.5, headlineLocked: true, bodyFontPx: 6.0, lineHeight: 1.328, columnCount: 2, textAlign: 'justify', subheadingFontPx: 8.0, subheadingLocked: true },
      pictures: [{ file: 'reference-lokmat/sport-misbah.jpg', x: 90, y: 57, width: 80, height: 53 }],
      panels: [{ kind: 'sidebar', marker: 'none', x: 90, y: 113, width: 80, height: 158, title: PLACEHOLDER, lines: points(6) }],
    },
    'report-right': {
      style: { displayFamily: 'khand', fontFamily: 'sans', headlineFontPx: 20.5, headlineLocked: true, bodyFontPx: 6.0, lineHeight: 1.328, columnCount: 4, textAlign: 'justify', subheadingFontPx: 8.5, subheadingLocked: true },
      pictures: [{ file: 'reference-lokmat/sport-carlos.jpg', x: 90, y: 33, width: 261, height: 127 }, { file: 'reference-lokmat/sport-stan.jpg', x: 238, y: 198, width: 39, height: 47 }],
      panels: [{ kind: 'sidebar', marker: 'none', x: 235, y: 170, width: 116, height: 27, title: PLACEHOLDER, lines: points(1) }, { kind: 'sidebar', marker: 'none', x: 178, y: 165, width: 56, height: 106, title: PLACEHOLDER, lines: points(4) }],
    },
    'feature-strip': {
      style: { displayFamily: 'khand', fontFamily: 'sans', headlineFontPx: 16.5, headlineLocked: true, bodyFontPx: 6.0, lineHeight: 1.328, columnCount: 4, textAlign: 'justify', subheadingFontPx: 8.5, subheadingLocked: true, headlineStyle: 'kicker-chip-rule', accentColor: '#e42424', borderInk: '#fb9f0b', headlineAlign: 'center' },
      fixtureKicker: 'जरूर वाचा',
      pictures: [{ file: 'reference-lokmat/sport-bottom.jpg', x: 183, y: 90, width: 130, height: 106 }],
      panels: [{ kind: 'sidebar', marker: 'none', tint: '#e7c9e7', x: 178, y: 47, width: 172, height: 42, title: PLACEHOLDER, lines: points(3) }],
    },
    'squad-box': {
      style: { displayFamily: 'khand', fontFamily: 'sans', headlineFontPx: 15.5, headlineLocked: true, bodyFontPx: 5.4, lineHeight: 1.391, columnCount: 2, textAlign: 'justify', headlineAlign: 'center', backgroundColor: '#eaeaea', borderRadiusPx: 6 },
      pictures: [{ file: 'reference-lokmat/sport-squad.jpg', x: 9, y: 61, width: 160, height: 130 }],
      panels: [],
    },
  },

  'broadsheet-jacket': {
    'rail-advert': ADS.gold,
    'top-brief': { style: story('mukta', 16, { columnCount: 2 }) },
    lead: {
      style: lead(30, 2),
      panels: [sidebar([0.5, 0.3, 0.5, 0.36], 3)],
      pictures: [pic('crowd1.jpg', [0.5, 0.68, 0.5, 0.2])],
    },
    'rail-shorts': { style: rail(12, { headlineInk: ORANGE }), pictures: [pic('scene2.jpg', [0, 0.12, 1, 0.3])] },
    'advert-top': ADS.insurance,
    'advert-foot': ADS.family,
    'advert-left': ADS.ayurveda,
    'weather-column': { style: rail(13), pictures: [pic('map2.jpg', [0, 0.66, 1, 0.22])] },
  },

  'broadsheet-city': {
    'rail-update': { style: rail(12, { headlineInk: ORANGE }) },
    lead: { style: lead(30, 4), pictures: [pic('crowd1.jpg', [0.2, 0.34, 0.3, 0.22])] },
    'right-top': { style: story('mukta', 22, { columnCount: 2 }), pictures: [pic('crowd2.jpg', [0, 0, 1, 0.28])] },
    'right-low': { style: story('khand', 16, { columnCount: 2 }) },
    'banner-report': { style: story('khand', 20, { columnCount: 6 }) },
    'half-advert': ADS.masala,
    'report-wide': {
      style: story('mukta', 22, { columnCount: 4 }),
      panels: [sidebar([0.44, 0.3, 0.27, 0.65], 3), pull([0.74, 0.3, 0.26, 0.4])],
    },
    'report-narrow': { style: story('mukta', 18, { columnCount: 2 }) },
    'report-picture': { style: story('mukta', 20, { columnCount: 2 }), pictures: [pic('scene2.jpg', [0.5, 0.2, 0.5, 0.22])] },
  },

  'broadsheet-state': {
    'rail-one': { style: rail(12, { headlineInk: ORANGE }), pictures: [pic('crowd2.jpg', [0, 0.12, 1, 0.38])] },
    'top-story': { style: story('mukta', 24, { columnCount: 1 }), pictures: [pic('crowd1.jpg', [0.21, 0.26, 0.79, 0.66])] },
    'top-side': { style: rail(14) },
    'rail-two': { style: rail(13), pictures: [pic('scene2.jpg', [0, 0.72, 1, 0.22])] },
    lead: {
      style: lead(30, 3),
      panels: [tinted(ROSE_TINT, [0.26, 0.74, 0.74, 0.25], 2)],
      pictures: [pic('crowd2.jpg', [0.26, 0.28, 0.36, 0.44])],
    },
    right: {
      style: story('mukta', 22, { columnCount: 2 }),
      panels: [pull([0.5, 0.7, 0.5, 0.16])],
      pictures: [pic('person1.jpg', [0.52, 0.18, 0.48, 0.2])],
    },
    'rail-three': { style: rail(13) },
    'report-one': { style: story('mukta', 20, { columnCount: 2 }), pictures: [pic('person1.jpg', [0, 0.42, 0.34, 0.26])] },
    'report-two': { style: story('mukta', 16) },
    'report-picture': { style: story('mukta', 16), pictures: [pic('scene1.jpg', [0, 0, 1, 0.5])] },
    'report-side': { style: rail(14) },
    'rail-four': { style: rail(13) },
    'feature-strip': {
      style: strip(22, 4),
      fixtureKicker: 'विशेष',
      panels: [sidebar([0.5, 0.3, 0.24, 0.7], 3)],
      pictures: [pic('person1.jpg', [0.26, 0.3, 0.22, 0.4])],
    },
    'right-foot': { style: story('khand', 18, { columnCount: 2 }), pictures: [pic('crowd1.jpg', [0.5, 0.34, 0.5, 0.26])] },
  },

  'broadsheet-local': {
    'left-column': { style: story('khand', 16) },
    lead: { style: lead(30, 3), pictures: [pic('scene1.jpg', [0.35, 0.3, 0.33, 0.2])] },
    'short-story': { style: story('mukta', 16) },
    'corner-advert': ADS.oil,
    'wide-report': { style: story('mukta', 20, { columnCount: 4 }) },
    'report-panel': {
      style: story('mukta', 20, { columnCount: 3 }),
      panels: [pull([0.58, 0.18, 0.42, 0.25]), tinted(ROSE_TINT, [0.58, 0.46, 0.42, 0.5], 3)],
    },
    'photo-story': { style: rail(14), pictures: [pic('crowd2.jpg', [0, 0.08, 1, 0.6])] },
    'report-small': { style: story('mukta', 16, { columnCount: 2 }) },
    'half-advert': ADS.travel,
    'feature-strip': { style: strip(24, 3), fixtureKicker: 'विशेष' },
  },

  'broadsheet-opinion': {
    editorial: { style: labelled('mukta', 20, 1), fixtureKicker: 'संपादकीय' },
    'opinion-lead': {
      style: story('mukta', 28, { headlineAlign: 'center', subheadingFontPx: 12, columnCount: 4 }),
      pictures: [pic('crowd1.jpg', [0.52, 0.12, 0.2, 0.24]), pic('person1.jpg', [0, 0.3, 0.13, 0.16])],
    },
    'opinion-two': { style: labelled('mukta', 26, 4), fixtureKicker: 'विश्लेषण', pictures: [pic('person1.jpg', [0, 0.3, 0.13, 0.22])] },
    column: { style: labelled('khand', 22, 4), fixtureKicker: 'स्तंभ', pictures: [pic('scene2.jpg', [0.49, 0.12, 0.24, 0.5])] },
    commentary: { style: labelled('mukta', 18, 1), fixtureKicker: 'जनमन', pictures: [pic('scene1.jpg', [0.5, 0.14, 0.5, 0.2])] },
    'opinion-three': { style: labelled('khand', 26, 4), fixtureKicker: 'विचार', pictures: [pic('crowd2.jpg', [0.49, 0.24, 0.24, 0.36])] },
    cartoon: { style: story('mukta', 14), pictures: [pic('person1.jpg', [0, 0.14, 1, 0.86])] },
  },

  'broadsheet-advertorial': { 'page-advert': ADS.whole },

  'broadsheet-local-sport': {
    'sport-left': { style: story('mukta', 22, { columnCount: 2 }), pictures: [pic('person1.jpg', [0.5, 0.2, 0.5, 0.2])] },
    'sport-lead': { style: lead(30, 3), pictures: [pic('crowd1.jpg', [0.34, 0.22, 0.66, 0.38])] },
    'sport-right': { style: story('mukta', 22, { columnCount: 2 }), pictures: [pic('person1.jpg', [0.55, 0.24, 0.45, 0.24])] },
    'notice-left': ADS.notice,
    'notice-mid': ADS.tender,
    'sport-report': { style: story('mukta', 20, { columnCount: 3 }), pictures: [pic('crowd2.jpg', [0.26, 0.22, 0.36, 0.3])] },
    scorecard: { style: rail(12) },
    'notice-right': ADS.power,
    'sport-brief': { style: story('mukta', 16) },
    'notice-foot': ADS.notice,
    'notice-foot-right': ADS.tender,
    'result-box': { style: rail(13, { backgroundColor: BLUE_TINT, borderStyle: 'box', borderInk: SKY }) },
  },

  'broadsheet-miscellany': {
    'profile-feature': {
      style: story('mukta', 18, { columnCount: 2, backgroundColor: CREAM, borderStyle: 'box', borderInk: '#b06a08' }),
      pictures: [pic('person1.jpg', [0.08, 0.06, 0.28, 0.12])],
    },
    lead: { style: lead(32, 3) },
    'world-brief': { style: story('khand', 16) },
    'cabinet-report': { style: story('khand', 20, { columnCount: 3 }) },
    'tender-advert': ADS.tender,
    'court-report': { style: story('mukta', 16) },
    'recruit-advert-left': ADS.college,
    'recruit-advert-right': ADS.exam,
    'strip-advert': ADS.strip,
    'world-report': { style: story('mukta', 20, { columnCount: 3 }) },
    'bank-advert': ADS.bank,
    'feature-strip': { style: strip(26, 3), fixtureKicker: 'विशेष', panels: [sidebar([0.5, 0.32, 0.25, 0.68], 2)] },
  },

  'broadsheet-business': {
    lead: {
      style: lead(30, 3),
      panels: [chart('bar', [0.2, 0.36, 0.4, 0.28], readings(2877, 2814, 2701, 2596)), chart('line', [0.2, 0.66, 0.4, 0.34], readings(113, 196, 184, 197, 132, 128))],
      pictures: [pic('scene2.jpg', [0.61, 0.36, 0.19, 0.58])],
    },
    'right-chart': {
      style: story('mukta', 22, { columnCount: 2 }),
      panels: [chart('line', [0, 0.18, 1, 0.22], readings(2320, 2272, 2366, 2451)), sidebar([0, 0.74, 1, 0.26], 2)],
      pictures: [pic('person1.jpg', [0, 0.42, 1, 0.3])],
    },
    brief: { style: rail(14) },
    report: { style: story('mukta', 22, { columnCount: 3 }), pictures: [pic('person1.jpg', [0.34, 0.2, 0.3, 0.32])] },
    'report-side': { style: story('mukta', 16) },
    'film-panel': { style: story('mukta', 22, { columnCount: 1, headlineStyle: 'kicker-tab', accentColor: RED }), fixtureKicker: 'मनोरंजन', pictures: [pic('person1.jpg', [0, 0, 0.52, 1])] },
    'poster-story': { style: story('mukta', 20, { headlineStyle: 'reverse', accentColor: '#3f4a56' }), pictures: [pic('scene1.jpg', [0, 0.48, 1, 0.52])] },
    'film-story': { style: story('khand', 22, { columnCount: 2 }), pictures: [pic('crowd2.jpg', [0.46, 0.34, 0.54, 0.62])] },
    'jump-one': { style: story('khand', 20, { columnCount: 3 }) },
    'jump-two': { style: story('khand', 20, { columnCount: 3 }) },
    'jump-three': { style: story('khand', 20, { columnCount: 3 }) },
  },

  'broadsheet-world': {
    'rail-one': { style: rail(12, { headlineInk: ORANGE }), pictures: [pic('crowd2.jpg', [0, 0.12, 1, 0.3])] },
    'top-story': { style: story('mukta', 24, { columnCount: 4 }), pictures: [pic('crowd1.jpg', [0, 0.34, 0.2, 0.62]), pic('scene1.jpg', [0.2, 0.34, 0.2, 0.62])] },
    'rail-two': { style: rail(13), pictures: [pic('scene2.jpg', [0, 0.1, 1, 0.26])] },
    lead: { style: lead(30, 3), pictures: [pic('crowd1.jpg', [0.26, 0.3, 0.5, 0.34])] },
    right: { style: story('mukta', 22, { columnCount: 2 }), panels: [sidebar([0.5, 0.56, 0.5, 0.44], 2)], pictures: [pic('person1.jpg', [0.52, 0.16, 0.48, 0.2])] },
    'rail-three': { style: rail(13) },
    'rail-four': { style: rail(13) },
    'report-panel': { style: story('khand', 22, { columnCount: 2 }), panels: [tinted(ROSE_TINT, [0.5, 0.34, 0.5, 0.62], 3)] },
    'report-narrow': { style: story('mukta', 20) },
    strip: { style: story('mukta', 16, { columnCount: 3 }) },
    advert: ADS.pharma,
    'feature-strip': { style: strip(26, 3), fixtureKicker: 'विशेष', panels: [sidebar([0.75, 0.32, 0.25, 0.68], 2)], pictures: [pic('person1.jpg', [0.28, 0.34, 0.22, 0.44])] },
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
