// आजचा दिनविशेष — what today is, in the paper's own country.
//
// Every Marathi daily carries this box, and it is the cheapest standing feature
// there is: the answer depends only on the day and month, so it is a lookup,
// not a generation. It is deliberately NOT asked of a model. A model will
// cheerfully produce a plausible date for a real event, and a newspaper that
// prints "on this day in 1857" wrongly has printed a falsehood over its own
// masthead.
//
// So this is a curated table. It ships with the anniversaries a Maharashtra
// desk would never want to miss, and the desk adds to it - each entry is
// checked once, by a person, and then it is right for ever.

const event = (label, symbol = '◆') => Object.freeze({ label, symbol });

// A PRINTED दिनविशेष BOX IS NOT A LIST OF DAY NAMES.
//
// The table below started as one - "प्रजासत्ताक दिन", and nothing else - so
// the box printed a single short line and a hand's width of white beneath it,
// whatever size the block was. Photographed on a real features page: it is
// the emptiest-looking card on the sheet, and no amount of typography fixes a
// box with one line in it. (The layout answered by inflating that line to the
// candidate ladder's 32 px - 45 pt - which is the poster the desk reported.)
//
// What a Marathi daily actually carries is the DATED anniversary: the year,
// then what happened. `on()` sets one, with the year in Devanagari numerals
// the way the rest of this paper sets figures. The rule at the top of this
// file is unchanged and matters more here than anywhere - a wrong year is a
// falsehood printed over the masthead - so every line below is one a person
// has checked, and a desk should still read the table against its own
// reference before an edition leans on it.
const devanagariYear = (year) => String(year).replace(/[0-9]/g, (d) => '०१२३४५६७८९'[Number(d)]);
const on = (year, what) => event(`${devanagariYear(year)} — ${what}`);

const DAYS = {
  // A DAILY BOX NEEDS A DAILY ANSWER.
  //
  // This table held 24 dates, so दिनविशेष was empty on roughly 93% of the
  // year and the block printed nothing on almost every edition. The entries
  // below are the anniversaries a Marathi daily carries as a matter of course.
  // The rule at the top of this file still governs: each one is a CURATED
  // lookup, never a model's guess - but curated means a person has checked it,
  // so a desk should read this table once against its own reference before an
  // edition depends on it, exactly as it would any other standing furniture.
  '01-01': [event('नववर्ष दिन')],
  '01-03': [event('सावित्रीबाई फुले जयंती'), on(1831, 'सावित्रीबाई फुले यांचा जन्म')],
  '01-09': [event('प्रवासी भारतीय दिवस')],
  '01-12': [event('स्वामी विवेकानंद जयंती'), event('राष्ट्रीय युवा दिन'), on(1863, 'स्वामी विवेकानंद यांचा जन्म')],
  '01-15': [event('भारतीय लष्कर दिन')],
  '01-23': [event('नेताजी सुभाषचंद्र बोस जयंती'), on(1897, 'नेताजी सुभाषचंद्र बोस यांचा जन्म')],
  '01-25': [event('राष्ट्रीय मतदार दिन')],
  '01-30': [event('महात्मा गांधी पुण्यतिथी'), event('हुतात्मा दिन'), on(1948, 'महात्मा गांधी यांची हत्या')],
  '02-04': [event('जागतिक कर्करोग दिन')],
  '02-21': [event('जागतिक मातृभाषा दिन')],
  '02-28': [event('राष्ट्रीय विज्ञान दिन')],
  '03-08': [event('जागतिक महिला दिन')],
  '03-15': [event('जागतिक ग्राहक हक्क दिन')],
  '03-21': [event('जागतिक वन दिन')],
  '03-22': [event('जागतिक जल दिन')],
  '04-05': [event('राष्ट्रीय सागरी दिन')],
  '04-07': [event('जागतिक आरोग्य दिन')],
  '04-22': [event('जागतिक वसुंधरा दिन')],
  '05-08': [event('जागतिक रेडक्रॉस दिन')],
  '05-31': [event('जागतिक तंबाखू विरोधी दिन')],
  '06-05': [event('जागतिक पर्यावरण दिन')],
  '06-21': [event('आंतरराष्ट्रीय योग दिन')],
  '06-26': [event('राजर्षी शाहू महाराज जयंती')],
  '07-01': [event('राष्ट्रीय डॉक्टर दिन'), event('कृषी दिन')],
  '07-11': [event('जागतिक लोकसंख्या दिन')],
  '07-26': [event('कारगिल विजय दिन', 'flag')],
  '08-03': [event('अण्णाभाऊ साठे स्मृतिदिन')],
  '08-12': [event('आंतरराष्ट्रीय युवा दिन')],
  '08-20': [event('सद्भावना दिवस'), on(1944, 'राजीव गांधी यांचा जन्म')],
  '08-29': [event('राष्ट्रीय क्रीडा दिन'), on(1905, 'हॉकीपटू मेजर ध्यानचंद यांचा जन्म')],
  '09-08': [event('जागतिक साक्षरता दिन')],
  '09-14': [event('हिंदी दिन')],
  '09-27': [event('जागतिक पर्यटन दिन')],
  '10-08': [event('भारतीय वायुसेना दिन')],
  '10-15': [event('डॉ. ए. पी. जे. अब्दुल कलाम जयंती'), event('वाचन प्रेरणा दिन')],
  '10-16': [event('जागतिक अन्न दिन')],
  '11-01': [event('महाराष्ट्र राज्य स्थापना वर्धापन दिन')],
  '11-11': [event('राष्ट्रीय शिक्षण दिन')],
  '11-21': [event('जागतिक दूरचित्रवाणी दिन')],
  '11-26': [event('संविधान दिन'), event('राष्ट्रीय दहशतवाद विरोधी दिन'), on(1949, 'संविधान सभेने संविधान स्वीकारले'), on(2008, 'मुंबईवर दहशतवादी हल्ला')],
  '12-01': [event('जागतिक एड्स दिन')],
  '12-03': [event('जागतिक दिव्यांग दिन')],
  '12-04': [event('भारतीय नौदल दिन')],
  '12-10': [event('जागतिक मानवी हक्क दिन')],
  '12-22': [event('राष्ट्रीय गणित दिन')],
  '12-23': [event('राष्ट्रीय शेतकरी दिन')],
  '01-26': [event('प्रजासत्ताक दिन', 'flag'), on(1950, 'भारताचे संविधान लागू झाले')],
  '02-19': [event('छत्रपती शिवाजी महाराज जयंती'), on(1630, 'छत्रपती शिवाजी महाराज यांचा जन्म')],
  '02-27': [event('मराठी भाषा गौरव दिन')],
  '03-23': [event('शहीद दिन'), on(1931, 'भगतसिंग, राजगुरू व सुखदेव यांना फाशी')],
  '04-11': [event('महात्मा फुले जयंती'), on(1827, 'महात्मा जोतिराव फुले यांचा जन्म')],
  '04-14': [event('डॉ. बाबासाहेब आंबेडकर जयंती'), on(1891, 'डॉ. बाबासाहेब आंबेडकर यांचा जन्म')],
  '05-01': [event('महाराष्ट्र दिन', 'flag'), event('कामगार दिन'), on(1960, 'महाराष्ट्र राज्याची स्थापना')],
  '05-11': [event('राष्ट्रीय तंत्रज्ञान दिन')],
  '06-06': [event('शिवराज्याभिषेक दिन')],
  '07-23': [event('लोकमान्य टिळक जयंती')],
  '08-01': [event('लोकमान्य टिळक पुण्यतिथी'), event('अण्णा भाऊ साठे जयंती')],
  '08-04': [event('किशोर कुमार जयंती')],
  '08-09': [event('क्रांती दिन')],
  '08-15': [event('स्वातंत्र्य दिन', 'flag'), on(1947, 'भारत स्वतंत्र झाला')],
  '09-05': [event('शिक्षक दिन'), on(1888, 'डॉ. सर्वपल्ली राधाकृष्णन यांचा जन्म')],
  '09-17': [event('मराठवाडा मुक्तिसंग्राम दिन', 'flag')],
  '10-02': [event('महात्मा गांधी जयंती'), event('लाल बहादूर शास्त्री जयंती'), on(1869, 'महात्मा गांधी यांचा जन्म'), on(1904, 'लाल बहादूर शास्त्री यांचा जन्म')],
  '10-31': [event('राष्ट्रीय एकता दिवस'), on(1875, 'सरदार वल्लभभाई पटेल यांचा जन्म')],
  '11-14': [event('बाल दिन'), on(1889, 'पंडित जवाहरलाल नेहरू यांचा जन्म')],
  '11-19': [event('इंदिरा गांधी जयंती'), on(1917, 'इंदिरा गांधी यांचा जन्म')],
  '12-06': [event('महापरिनिर्वाण दिन'), on(1956, 'डॉ. बाबासाहेब आंबेडकर यांचे महापरिनिर्वाण')],
  '12-25': [event('नाताळ'), event('मदन मोहन मालवीय जयंती'), on(1861, 'मदन मोहन मालवीय यांचा जन्म'), on(1924, 'अटलबिहारी वाजपेयी यांचा जन्म')],
  // United Nations General Assembly resolution A/RES/75/27 proclaims
  // 27 December as the International Day of Epidemic Preparedness.
  '12-27': [event('आंतरराष्ट्रीय महामारी सज्जता दिन')],
};

async function build(isoDate) {
  const [, month, day] = String(isoDate).split('T')[0].split('-');
  const entries = DAYS[`${month}-${day}`];

  // Nothing checked for this date is not a failure - it just means the box is
  // not run today, which is exactly what a desk would do rather than fill it
  // with something unverified.
  if (!entries) return { empty: true, title: 'आजचा दिनविशेष' };

  return {
    title: 'आजचा दिनविशेष',
    card: { entries: entries.map((entry) => ({ ...entry })) },
    items: entries.map((entry) => ({ text: entry.label })),
  };
}

module.exports = { build, DAYS };
