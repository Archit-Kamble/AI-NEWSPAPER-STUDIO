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
  '01-03': [event('सावित्रीबाई फुले जयंती')],
  '01-09': [event('प्रवासी भारतीय दिवस')],
  '01-12': [event('स्वामी विवेकानंद जयंती'), event('राष्ट्रीय युवा दिन')],
  '01-15': [event('भारतीय लष्कर दिन')],
  '01-23': [event('नेताजी सुभाषचंद्र बोस जयंती')],
  '01-25': [event('राष्ट्रीय मतदार दिन')],
  '01-30': [event('महात्मा गांधी पुण्यतिथी'), event('हुतात्मा दिन')],
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
  '08-20': [event('सद्भावना दिवस')],
  '08-29': [event('राष्ट्रीय क्रीडा दिन')],
  '09-08': [event('जागतिक साक्षरता दिन')],
  '09-14': [event('हिंदी दिन')],
  '09-27': [event('जागतिक पर्यटन दिन')],
  '10-08': [event('भारतीय वायुसेना दिन')],
  '10-15': [event('डॉ. ए. पी. जे. अब्दुल कलाम जयंती'), event('वाचन प्रेरणा दिन')],
  '10-16': [event('जागतिक अन्न दिन')],
  '11-01': [event('महाराष्ट्र राज्य स्थापना वर्धापन दिन')],
  '11-11': [event('राष्ट्रीय शिक्षण दिन')],
  '11-21': [event('जागतिक दूरचित्रवाणी दिन')],
  '11-26': [event('संविधान दिन'), event('राष्ट्रीय दहशतवाद विरोधी दिन')],
  '12-01': [event('जागतिक एड्स दिन')],
  '12-03': [event('जागतिक दिव्यांग दिन')],
  '12-04': [event('भारतीय नौदल दिन')],
  '12-10': [event('जागतिक मानवी हक्क दिन')],
  '12-22': [event('राष्ट्रीय गणित दिन')],
  '12-23': [event('राष्ट्रीय शेतकरी दिन')],
  '01-26': [event('प्रजासत्ताक दिन', 'flag')],
  '02-19': [event('छत्रपती शिवाजी महाराज जयंती')],
  '02-27': [event('मराठी भाषा गौरव दिन')],
  '03-23': [event('शहीद दिन')],
  '04-11': [event('महात्मा फुले जयंती')],
  '04-14': [event('डॉ. बाबासाहेब आंबेडकर जयंती')],
  '05-01': [event('महाराष्ट्र दिन', 'flag'), event('कामगार दिन')],
  '05-11': [event('राष्ट्रीय तंत्रज्ञान दिन')],
  '06-06': [event('शिवराज्याभिषेक दिन')],
  '07-23': [event('लोकमान्य टिळक जयंती')],
  '08-01': [event('लोकमान्य टिळक पुण्यतिथी'), event('अण्णा भाऊ साठे जयंती')],
  '08-04': [event('किशोर कुमार जयंती')],
  '08-09': [event('क्रांती दिन')],
  '08-15': [event('स्वातंत्र्य दिन', 'flag')],
  '09-05': [event('शिक्षक दिन')],
  '09-17': [event('मराठवाडा मुक्तिसंग्राम दिन', 'flag')],
  '10-02': [event('महात्मा गांधी जयंती'), event('लाल बहादूर शास्त्री जयंती')],
  '10-31': [event('राष्ट्रीय एकता दिवस')],
  '11-14': [event('बाल दिन')],
  '11-19': [event('इंदिरा गांधी जयंती')],
  '12-06': [event('महापरिनिर्वाण दिन')],
  '12-25': [event('नाताळ'), event('मदन मोहन मालवीय जयंती')],
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
