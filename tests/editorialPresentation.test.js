const test = require('node:test');
const assert = require('node:assert/strict');

test('semantic presentation is exact-phrase based, escaped, and preserves rich marks', async () => {
  const presentation = await import('../public/editor/layout/editorial-presentation.js');
  const text = 'योजनेसाठी १२ कोटी रुपये मंजूर झाले.';
  const ranges = presentation.presentationRanges(text, { annotations: [{ target: 'body', phrase: '१२ कोटी रुपये', role: 'KEY_NUMBER', treatmentToken: 'ACCENT', style: 'font-size:99px' }] }, 'body');
  assert.equal(ranges.length, 1);
  const html = presentation.renderPresentation(text, [{ start: 0, end: 8, tag: 'b' }], ranges, (value) => value.replace(/</g, '&lt;'));
  assert.match(html, /editorial-token-accent/);
  assert.match(html, /<b>/);
  assert.doesNotMatch(html, /font-size/);
});

test('stale, duplicate, malformed and unknown presentation annotations are ignored', async () => {
  const presentation = await import('../public/editor/layout/editorial-presentation.js');
  assert.equal(presentation.presentationRanges('१३ कोटी रुपये', { annotations: [{ target: 'body', phrase: '१२ कोटी रुपये', treatmentToken: 'ACCENT' }] }, 'body').length, 0);
  assert.equal(presentation.presentationRanges('सातारा आणि सातारा', { annotations: [{ target: 'body', phrase: 'सातारा', treatmentToken: 'ACCENT' }] }, 'body').length, 0);
  assert.equal(presentation.normalizePresentation({ annotations: [{ target: 'body', phrase: '<script>', treatmentToken: 'LIME' }] }).annotations.length, 0);
});
