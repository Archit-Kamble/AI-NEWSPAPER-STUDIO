// A dateline is "■ सातारा " by default and "सातारा : " when the block asks.
const test = require('node:test');
const assert = require('node:assert/strict');

test('the two dateline styles, and the service agrees on the list', async () => {
  const flow = await import('../public/editor/layout/text-flow.js');
  assert.equal(flow.datelineText({ location: 'पुणे' }), '■ पुणे ');
  assert.equal(flow.datelineText({ location: 'पुणे', datelineStyle: 'square' }), '■ पुणे ');
  assert.equal(flow.datelineText({ location: 'पुणे', datelineStyle: 'colon' }), 'पुणे : ');
  assert.equal(flow.datelineText({ location: 'पुणे', dateline_style: 'colon', author: 'प्रतिनिधी' }), 'पुणे, प्रतिनिधी : ');
  assert.equal(flow.datelineText({ datelineStyle: 'colon' }), '');
  const { DATELINE_STYLES } = require('../src/services/pageSection.service');
  assert.deepEqual([...DATELINE_STYLES], [...flow.DATELINE_STYLES]);
});

test('a composed block sets the colon dateline as its body prefix', async () => {
  const [{ composeSection }, metrics, shaper] = await Promise.all([
    import('../public/editor/compose/section-adapter.js'),
    import('../public/editor/compose/font-metrics.js'),
    import('../public/editor/compose/shaper.js'),
  ]);
  await Promise.all([metrics.ensureFontsLoaded(), shaper.ensureShaperReady()]);
  const row = { width_px: 200, height_px: 120, body: 'शहरात आज पाऊस झाला.', location: 'पुणे', dateline_style: 'colon', body_font_px: 6.4 };
  const composition = composeSection(row, {});
  const first = composition.bodyLines[0].text;
  assert.ok(first.startsWith('पुणे : '), first);
});
