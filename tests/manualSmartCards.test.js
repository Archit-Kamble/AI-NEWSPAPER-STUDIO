const test = require('node:test');
const assert = require('node:assert/strict');

let manual;
test.before(async () => { manual = await import('../public/editor/smart-cards/manual-cards.js'); });

test('market text becomes verified rows without inventing a rate', () => {
  const result = manual.marketCardFromText(`बाजार दिनांक: २६/०८/२०२६
सोने २४ कॅरेट | ₹७४,२५० | +०.४%
सेन्सेक्स | ८१,४०० | -०.२%
कालचा बाजार: बँक आणि धातू समभागांच्या वाढीमुळे निर्देशांक सकारात्मक बंद झाले.
स्रोत: पडताळलेला बाजार अहवाल`);
  assert.deepEqual(result.card.items, [
    { label: 'सोने २४ कॅरेट', value: '₹७४,२५०', change: '+०.४%' },
    { label: 'सेन्सेक्स', value: '८१,४००', change: '-०.२%' },
  ]);
  assert.equal(result.card.asOf, '२६/०८/२०२६');
  assert.match(result.card.yesterdayBrief, /निर्देशांक सकारात्मक/);
  assert.equal(result.card.source, 'स्रोत : पडताळलेला बाजार अहवाल');
});

test('tender text separates office metadata, body and a pipe table', () => {
  const result = manual.tenderCardFromText(`कार्यालय: जिल्हाधिकारी कार्यालय, सातारा
संदर्भ: निविदा/२०२६/१२
दिनांक: २७/०८/२०२६
विषय: कार्यालयीन साहित्य पुरवठा
शीर्षक: निविदा सूचना

पात्र पुरवठादारांकडून बंद लिफाफ्यात निविदा मागविण्यात येत आहेत.

अ.क्र. | बाब | प्रमाण
१ | कागद | १०० रीम
२ | फाईल | ५०० नग

स्वाक्षरी: जिल्हाधिकारी, सातारा`);
  assert.equal(result.card.issuer, 'जिल्हाधिकारी कार्यालय, सातारा');
  assert.equal(result.card.table.headers[1], 'बाब');
  assert.equal(result.card.table.rows.length, 2);
  assert.match(result.card.paragraphs[0], /बंद लिफाफ्यात/);
  assert.equal(result.card.signatory, 'जिल्हाधिकारी, सातारा');
});

test('manual cards refuse incomplete input rather than filling plausible content', () => {
  assert.ok(manual.marketCardFromText('फक्त नाव').error);
  assert.ok(manual.tenderCardFromText('काही असंरचित शब्द').error);
});
