const test = require('node:test');
const assert = require('node:assert/strict');
const { validateGeneratedGrounding } = require('../src/services/generatedGrounding.service');

const source = { description: 'योजनेसाठी १२ कोटी रुपये मंजूर झाले. अधिकारी म्हणाले, "काम वेळेत पूर्ण होईल".' };
test('generated grounding accepts source-supported Marathi and Latin digit facts', () => {
  assert.equal(validateGeneratedGrounding({ body: 'योजनेसाठी 12 कोटी रुपये मंजूर झाले.' }, source).valid, true);
  assert.equal(validateGeneratedGrounding({ body: 'अधिकारी म्हणाले, "काम वेळेत पूर्ण होईल".' }, source).valid, true);
});
test('generated grounding rejects unsupported numbers and direct quotes', () => {
  assert.deepEqual(validateGeneratedGrounding({ body: 'योजनेसाठी १८ कोटी रुपये मंजूर झाले.' }, source).issues.map((issue) => issue.code), ['UNSUPPORTED_NUMBER']);
  assert.deepEqual(validateGeneratedGrounding({ body: 'अधिकारी म्हणाले, "उद्या काम सुरू होईल".' }, source).issues.map((issue) => issue.code), ['UNSUPPORTED_DIRECT_QUOTE']);
});
