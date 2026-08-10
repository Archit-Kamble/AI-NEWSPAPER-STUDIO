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

const DAYS = {
  '01-03': ['१८३१ : क्रांतिज्योती सावित्रीबाई फुले यांचा जन्म.'],
  '01-26': ['१९५० : भारतीय राज्यघटना अंमलात आली; प्रजासत्ताक दिन.'],
  '02-19': ['१६३० : छत्रपती शिवाजी महाराज यांचा जन्म.'],
  '02-27': ['१९१२ : कवी कुसुमाग्रज यांचा जन्म; मराठी भाषा गौरव दिन.'],
  '03-23': ['१९३१ : भगतसिंग, राजगुरू व सुखदेव यांना फाशी; शहीद दिन.'],
  '04-11': ['१८२७ : महात्मा जोतिराव फुले यांचा जन्म.'],
  '04-14': ['१८९१ : भारतरत्न डॉ. बाबासाहेब आंबेडकर यांचा जन्म.'],
  '05-01': ['१९६० : महाराष्ट्र राज्याची स्थापना; महाराष्ट्र दिन.', 'आंतरराष्ट्रीय कामगार दिन.'],
  '05-11': ['१९९८ : पोखरण येथे अणुचाचणी; राष्ट्रीय तंत्रज्ञान दिन.'],
  '06-06': ['१६७४ : छत्रपती शिवाजी महाराज यांचा राज्याभिषेक.'],
  '07-23': ['१८५६ : लोकमान्य बाळ गंगाधर टिळक यांचा जन्म.'],
  '08-01': ['१९२० : लोकमान्य टिळक यांचे निधन.', '१९२० : लोकशाहीर अण्णा भाऊ साठे यांचा जन्म.'],
  '08-04': ['१९२९ : पार्श्वगायक किशोर कुमार यांचा जन्म.'],
  '08-09': ['१९४२ : चले जाव चळवळीस प्रारंभ; क्रांती दिन.'],
  '08-15': ['१९४७ : भारत स्वतंत्र झाला; स्वातंत्र्य दिन.'],
  '09-05': ['१८८८ : डॉ. सर्वपल्ली राधाकृष्णन यांचा जन्म; शिक्षक दिन.'],
  '09-17': ['१९४८ : मराठवाडा निजामाच्या जोखडातून मुक्त; मराठवाडा मुक्तिसंग्राम दिन.'],
  '10-02': ['१८६९ : महात्मा गांधी यांचा जन्म.', '१९०४ : लाल बहादूर शास्त्री यांचा जन्म.'],
  '10-31': ['१८७५ : सरदार वल्लभभाई पटेल यांचा जन्म; राष्ट्रीय एकता दिवस.'],
  '11-14': ['१८८९ : पं. जवाहरलाल नेहरू यांचा जन्म; बाल दिन.'],
  '11-19': ['१९१७ : इंदिरा गांधी यांचा जन्म.'],
  '12-06': ['१९५६ : डॉ. बाबासाहेब आंबेडकर यांचे महापरिनिर्वाण.'],
  '12-25': ['नाताळ.', '१८६१ : पं. मदन मोहन मालवीय यांचा जन्म.'],
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
    card: { entries: entries.slice() },
    items: entries.map((text) => ({ text })),
  };
}

module.exports = { build, DAYS };
