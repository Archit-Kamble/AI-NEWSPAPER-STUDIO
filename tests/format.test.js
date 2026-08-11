// Stage 8: format.js's escapeHtml is the one HTML-escaping implementation in
// the frontend - it used to be reimplemented five separate times (this file,
// story-explorer.js, pictures-panel.js, picture-controls.js, typography-panel.js,
// admin/editions.js), one of which (story-explorer.js, rendering reporter-
// submitted story titles into the Story Explorer drawer with no escaping at
// all) was a real stored-XSS gap, not just duplication. Pure logic, no DOM -
// closeOnEscape (also in format.js) needs `document` and is covered by
// tests/browser/workspace.browser.js instead.

const test = require('node:test');
const assert = require('node:assert/strict');

test('escapeHtml: the five characters that matter to a browser are all escaped', async () => {
  const { escapeHtml } = await import('../public/editor/format.js');
  assert.equal(escapeHtml('&<>"\''), '&amp;&lt;&gt;&quot;&#39;');
});

test('escapeHtml: a reporter-submitted title cannot break out into a tag', async () => {
  const { escapeHtml } = await import('../public/editor/format.js');
  const malicious = '<img src=x onerror="alert(1)">';
  const escaped = escapeHtml(malicious);
  assert.equal(escaped.includes('<img'), false, 'no literal opening tag survives');
  assert.equal(escaped, '&lt;img src=x onerror=&quot;alert(1)&quot;&gt;');
});

test('escapeHtml: null/undefined/number all coerce through String() rather than throwing', async () => {
  const { escapeHtml } = await import('../public/editor/format.js');
  assert.equal(escapeHtml(null), '');
  assert.equal(escapeHtml(undefined), '');
  assert.equal(escapeHtml(42), '42');
});

test('escapeHtml: plain text with no special characters is unchanged', async () => {
  const { escapeHtml } = await import('../public/editor/format.js');
  assert.equal(escapeHtml('साताऱ्यातील राजकीय घडामोडींना वेग'), 'साताऱ्यातील राजकीय घडामोडींना वेग');
});
