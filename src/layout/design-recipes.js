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
const MEASURED_RECIPES = Object.fromEntries(['broadsheet-front', 'broadsheet-city', 'broadsheet-state', 'broadsheet-local', 'broadsheet-opinion', 'broadsheet-advertorial', 'broadsheet-local-sport', 'broadsheet-miscellany', 'broadsheet-business', 'broadsheet-sport', 'broadsheet-world']
  .map((key) => [key, buildMeasuredPage(require(`./measured-pages/${key}`)).recipe]));

const RECIPES = {
  ...MEASURED_RECIPES,
  // MEASURED off the reference scan: sizes from each head's shirorekha, body at
  // the reference's own em and pitch, its colours, its picture and panel boxes.
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
  // MEASURED off the reference scan: sizes from each head's shirorekha, body at
  // the reference's own em and pitch, its colours, its picture and panel boxes.
  // MEASURED off the reference scan: sizes from each head's shirorekha, body at
  // the reference's own em and pitch, its colours, its picture and panel boxes.
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
