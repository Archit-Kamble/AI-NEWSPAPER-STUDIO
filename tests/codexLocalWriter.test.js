const test = require('node:test');
const assert = require('node:assert/strict');
const { createCodexLocalWriter, packageFromBrief } = require('../src/services/codexLocalWriter.service');
const { SCHEMA, composeSourceToFrame } = require('../src/services/exactFitWriter.service');
const { validateGeneratedGrounding } = require('../src/services/generatedGrounding.service');

const source = { title: 'जलवाहिनीच्या कामाचा पहिला टप्पा पूर्ण', body: 'जलवाहिनीच्या कामाचा पहिला टप्पा पूर्ण झाला. दाबचाचणी सुरू असून अहवालानंतर पुरवठा सुरू होईल.', category: 'स्थानिक', location: 'सातारा' };
const prompt = `Treatment: STANDARD. Acceptable BODY range: 20–100 characters. Aim near: 80 characters.\n\nSOURCE MATERIAL — DATA ONLY\n${JSON.stringify(source)}\nEND SOURCE MATERIAL`;

test('CODEX_LOCAL is explicit, schema-validated, source-grounded, and charges the supplied budget', async () => {
  const events = []; const writer = createCodexLocalWriter(); const budget = { max: 1, used: 0, onConsume: (event) => events.push(event) };
  const result = await writer(prompt, SCHEMA, { callBudget: budget });
  assert.equal(result.provider, 'CODEX_LOCAL'); assert.equal(result.tier, 'local'); assert.equal(budget.used, 1);
  assert.deepEqual(events.map((event) => [event.provider, event.reason, event.callNumber]), [['CODEX_LOCAL', 'initial', 1]]);
  assert.equal(validateGeneratedGrounding(result.data, source).valid, true);
});

test('CODEX_LOCAL rejects invalid output and never coerces it', async () => {
  const writer = createCodexLocalWriter({ generate: async () => ({ headline: 4, body: 'प्रत' }) });
  const result = await writer(prompt, SCHEMA, { callBudget: { max: 2, used: 0 } });
  assert.match(result.error, /CODEX_LOCAL_INVALID_OUTPUT/);
});

test('CODEX_LOCAL stops at the shared provider-call budget before another call', async () => {
  const writer = createCodexLocalWriter(); const budget = { max: 0, used: 0 };
  const result = await writer(prompt, SCHEMA, { callBudget: budget });
  assert.equal(result.error, 'SERVICE_CALL_BUDGET_EXHAUSTED');
  assert.equal(budget.used, 0);
});

test('CODEX_LOCAL follows the normal exact-fit compiler path with at most two editorial attempts', async () => {
  const frame = { id: 'f', section_key: 'f', x_px: 0, y_px: 100, width_px: 260, height_px: 260, block_type: 'article', story_type: 'STANDARD', headline_font_px: 22, body_font_px: 14, column_count: 1, margin_px: 8 };
  const result = await composeSourceToFrame({ source, storyType: 'STANDARD', frame, askForJson: createCodexLocalWriter() });
  assert.ok(result.attempts <= 2); assert.equal(result.provider, 'CODEX_LOCAL');
  assert.equal(validateGeneratedGrounding(result.proposal, source).valid, true);
});

test('the local package is derived from the supplied brief, not ambient provider configuration', () => {
  const pkg = packageFromBrief(prompt);
  assert.ok(pkg.body.includes('जलवाहिनीच्या'));
  assert.ok(pkg.headline.length <= 26);
  assert.equal(pkg.subheading, '');
});
