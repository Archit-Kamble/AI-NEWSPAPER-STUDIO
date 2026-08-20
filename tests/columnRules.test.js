const test = require('node:test');
const assert = require('node:assert/strict');

let rules;
test.before(async () => { rules = await import('../public/editor/canvas/column-rules.js'); });

const geometry = { gutterPx: 6, baselinePx: 8 };
const left = { section_key: 'left', block_type: 'article', border_style: 'none', x_px: 20, y_px: 100, width_px: 100, height_px: 200 };
const right = { section_key: 'right', block_type: 'article', border_style: 'none', x_px: 126, y_px: 100, width_px: 100, height_px: 200 };

test('a gutter rule exists only while both neighbouring stories are unboxed', () => {
  const ordinary = rules.columnRulesFor({ sections: [left, right] }, geometry);
  assert.equal(ordinary.length, 1);
  assert.equal(ordinary[0].axis, 'v');

  assert.deepEqual(
    rules.columnRulesFor({ sections: [{ ...left, border_style: 'box' }, right] }, geometry),
    [],
    'the box is already the separator, so a page hairline would be a double rule',
  );
  assert.deepEqual(
    rules.columnRulesFor({ sections: [left, { ...right, border_style: 'box' }] }, geometry),
    [],
  );
});
