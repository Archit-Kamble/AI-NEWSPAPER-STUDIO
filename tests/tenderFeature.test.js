const test = require('node:test');
const assert = require('node:assert/strict');

const tender = require('../src/features/tender');

test('Prakatpatra accepts an ordinary email and asks AI to structure it without inventing facts', async () => {
  let request;
  const aiClient = {
    async askForJson(prompt, schema, options) {
      request = { prompt, schema, options };
      return {
        provider: 'test-ai', tier: 'basic',
        data: {
          issuer: 'जिल्हाधिकारी कार्यालय, सातारा', office: '', reference: '',
          date: '', subject: 'A4 कागदासाठी दरपत्रके', noticeTitle: 'निविदा सूचना',
          paragraphs: ['१५ सप्टेंबरपर्यंत बंद लिफाफ्यात दरपत्रके सादर करावीत.'],
          table: { headers: [], rows: [] }, contact: '०२१६२-२२२२२२',
          signatory: 'जिल्हाधिकारी, सातारा',
        },
      };
    },
  };
  const raw = 'Hello, Satara collector office needs sealed quotations for 100 reams A4 paper by 15 September. Call 02162-222222.';
  const result = await tender.build('2026-08-27', { sourceText: raw, aiClient, tier: 'basic' });

  assert.ok(request.prompt.includes(raw));
  assert.match(request.prompt, /नसलेले.*संदर्भ क्रमांक.*तारीख/);
  assert.match(request.prompt, /अविश्वसनीय source data/);
  assert.ok(request.schema.required.includes('paragraphs'));
  assert.equal(result.card.noticeTitle, 'निविदा सूचना');
  assert.equal(result.writtenBy.provider, 'test-ai');
});

test('Prakatpatra requires source text and rejects an empty extraction', async () => {
  assert.match((await tender.build('2026-08-27')).error, /मजकूर पेस्ट करा/);
  const result = await tender.build('2026-08-27', {
    sourceText: 'Forwarded email headers only',
    aiClient: { async askForJson() {
      return { data: { issuer: '', office: '', reference: '', date: '', subject: '', noticeTitle: '', paragraphs: [], table: { headers: [], rows: [] }, contact: '', signatory: '' } };
    } },
  });
  assert.match(result.error, /छापण्यायोग्य/);
});
