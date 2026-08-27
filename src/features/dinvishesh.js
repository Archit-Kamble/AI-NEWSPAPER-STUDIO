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
  '01-03': [event('सावित्रीबाई फुले जयंती')],
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
