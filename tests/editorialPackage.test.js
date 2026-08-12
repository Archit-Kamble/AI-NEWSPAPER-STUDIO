const test = require('node:test');
const assert = require('node:assert/strict');
const { validateEditorialPackage, compileEditorialPresentation, sourceSufficiency } = require('../src/services/editorialPackage.service');

const source = { title: 'पाणी योजनेला गती', category: 'स्थानिक', location: 'सातारा', body: 'सातारा येथे श्रीकांत शिवनाथ मुळे यांनी १२ कोटी रुपये योजनेची माहिती दिली. “काम वेळेत पूर्ण होईल” असे त्यांनी सांगितले.' };
const pkg = { headline: 'पाणी योजनेला गती', subheading: '', body: 'सातारा येथे श्रीकांत शिवनाथ मुळे यांनी १२ कोटी रुपये योजनेची माहिती दिली.', kicker: 'स्थानिक', caption: '', annotations: [{ role: 'KEY_NUMBER', phrase: '१२ कोटी रुपये', target: 'body' }, { role: 'ACCENT_PHRASE', phrase: 'श्रीकांत शिवनाथ मुळे', target: 'body' }] };

test('SAHAS validates source-grounded Marathi semantic phrases and caps standard-story emphasis', () => {
  const result = validateEditorialPackage(pkg, source, { storyType: 'STANDARD' });
  assert.equal(result.acceptedAnnotations.length, 1); assert.equal(result.rejectedAnnotations[0].reason, 'EMPHASIS_BUDGET');
  assert.equal(result.package.kicker, 'स्थानिक');
});
test('unknown, absent, duplicate, CSS-looking and invented annotations are discarded without rejecting copy', () => {
  const input = { ...pkg, annotations: [
    { role: 'UNKNOWN', phrase: '१२ कोटी रुपये', target: 'body' }, { role: 'KEY_NUMBER', phrase: '२५ कोटी रुपये', target: 'body' },
    { role: 'KEY_NUMBER', phrase: '१२ कोटी रुपये', target: 'body', style: 'color: red' }, { role: 'KEY_NUMBER', phrase: '१२ कोटी रुपये', target: 'body' }, { role: 'KEY_NUMBER', phrase: '१२ कोटी रुपये', target: 'body' },
  ] };
  const result = validateEditorialPackage(input, source, { storyType: 'LEAD' });
  assert.equal(result.acceptedAnnotations.length, 1); assert.equal(result.package.body, pkg.body); assert.ok(result.rejectedAnnotations.length >= 4);
});
test('briefs stay visually quiet and compiler is deterministic, immutable, and token-only', () => {
  const before = structuredClone(pkg); const a = compileEditorialPresentation(pkg, 'BRIEF', { source }); const b = compileEditorialPresentation(pkg, 'BRIEF', { source });
  assert.deepEqual(a, b); assert.deepEqual(pkg, before); assert.deepEqual(a.presentation.annotations, []); assert.ok(!JSON.stringify(a).match(/color|font-size|<span/i));
});
test('pull quote must be verbatim in supplied source; unsupported caption and kicker disappear', () => {
  const input = { ...pkg, kicker: 'BREAKING', caption: 'अज्ञात व्यक्ती', annotations: [{ role: 'PULL_QUOTE_CANDIDATE', phrase: 'काम वेळेत पूर्ण होईल', target: 'body' }] };
  const result = validateEditorialPackage(input, source, { storyType: 'OPINION' });
  assert.equal(result.package.kicker, ''); assert.equal(result.package.caption, ''); assert.equal(result.rejectedAnnotations[0].reason, 'PHRASE_NOT_IN_TARGET');
});
test('sufficiency is deterministic and never requests another AI call', () => {
  const policy = { bodyFill: { min: .7, target: .88 } };
  assert.deepEqual(sourceSufficiency({ bodyCharBudget: 1000, bodyCharsUsed: 300 }, policy), { status: 'INSUFFICIENT_FOR_TREATMENT', requestedTargetChars: 880, achievedChars: 300, policyMinChars: 700, policyTargetChars: 880, recommendation: 'REQUEST_MORE_SOURCE' });
});
