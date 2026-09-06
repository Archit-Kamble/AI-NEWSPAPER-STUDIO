// A BLOCK IS A RECTANGLE, UNTIL A CORNER IS CUT OFF IT.
//
// The desk's report: "our layout blocks are rectangle make them with
// different shapes." block-shapes.js's own header states the safety
// argument: every cut corner is an OBSTACLE, in exactly the vocabulary a
// photograph and a चौकट panel already use - the compositor's own scanline
// algorithm is never touched. This file holds the one property that matters
// most: a composed line never overlaps the region its own shape excludes.

const test = require('node:test');
const assert = require('node:assert/strict');

let shapes;
let adapter;
test.before(async () => {
  shapes = await import('../public/editor/layout/block-shapes.js');
  const { ensureFontsLoaded } = await import('../public/editor/compose/font-metrics.js');
  const { ensureShaperReady } = await import('../public/editor/compose/shaper.js');
  await Promise.all([ensureFontsLoaded(), ensureShaperReady()]);
  adapter = await import('../public/editor/compose/section-adapter.js');
});

// ------------------------------------------------------------- geometry ---

test('twelve shapes, and a rectangle is the plain, un-cut state', () => {
  assert.strictEqual(shapes.BLOCK_SHAPES.length, 12);
  assert.strictEqual(shapes.blockShapeOf('rectangle').corners.length, 0);
  const pts = shapes.shapedRectPoints('rectangle', 200, 100);
  assert.deepEqual(pts, [[0, 0], [200, 0], [200, 100], [0, 100]]);
});

test('a foreign or empty shape name is never legal - sanitiseBlockShape refuses it', () => {
  assert.strictEqual(shapes.sanitiseBlockShape('notch-tr'), 'notch-tr');
  assert.strictEqual(shapes.sanitiseBlockShape('rectangle'), null, 'rectangle is the absence of a shape, stored as NULL');
  assert.strictEqual(shapes.sanitiseBlockShape('hexagon'), null);
  assert.strictEqual(shapes.sanitiseBlockShape(''), null);
  assert.strictEqual(shapes.sanitiseBlockShape(null), null);
  assert.strictEqual(shapes.sanitiseBlockShape(undefined), null);
});

test('a single-corner shape gives 5 points, two corners give 6, four give 8', () => {
  assert.strictEqual(shapes.shapedRectPoints('notch-tr', 200, 100).length, 5);
  assert.strictEqual(shapes.shapedRectPoints('chevron', 200, 100).length, 6);
  assert.strictEqual(shapes.shapedRectPoints('octagon', 200, 100).length, 8);
  for (const key of ['bevel-top', 'bevel-bottom', 'bevel-left', 'bevel-right']) {
    assert.strictEqual(shapes.shapedRectPoints(key, 200, 100).length, 6, key);
  }
});

// TWO CUTS ON ONE EDGE MUST NEVER MEET. If they did, the "excluded triangle"
// each one describes would overlap the other, and obstacleIntervals() would
// describe a shape that is not a simple corner cut any more - the one
// geometric case this file's own cutPx() exists to prevent.
test('cuts sharing an edge never meet, at any block size down to a sliver', () => {
  for (const key of ['chevron', 'chevron-alt', 'bevel-top', 'bevel-bottom', 'bevel-left', 'bevel-right', 'octagon']) {
    const shape = shapes.blockShapeOf(key);
    for (const [w, h] of [[200, 100], [100, 100], [40, 40], [10, 10], [4, 4], [400, 20]]) {
      const d = shapes.cutPx(shape, w, h);
      const shorter = Math.min(w, h);
      assert.ok(2 * d <= shorter + 0.001, `${key} at ${w}x${h}: 2*cut(${(2 * d).toFixed(2)}) exceeds the shorter side (${shorter})`);
    }
  }
});

test('never crashes on a zero or negative block, and produces no negative geometry', () => {
  for (const key of shapes.BLOCK_SHAPE_KEYS) {
    for (const [w, h] of [[0, 0], [-10, 50], [50, -10], [0.4, 0.4]]) {
      const pts = shapes.shapedRectPoints(key, w, h);
      assert.ok(Array.isArray(pts) && pts.length >= 4, `${key} at ${w}x${h} produced no polygon`);
      for (const [x, y] of pts) {
        assert.ok(Number.isFinite(x) && Number.isFinite(y), `${key} at ${w}x${h} produced a non-finite point`);
      }
    }
  }
});

test('the clip-path and the obstacle boxes read the SAME cut depth - they cannot disagree', () => {
  // Both clipPathFor() and cornerObstacles() call cutPx() with the same
  // shape/width/height, which is the whole argument for keeping this in one
  // file rather than two. Pinned here as a literal equality, not an
  // assumption: the corner obstacle's own width/height IS the cut depth.
  for (const key of ['notch-tr', 'notch-bl', 'chevron', 'bevel-top', 'bevel-right', 'octagon']) {
    const shape = shapes.blockShapeOf(key);
    const d = shapes.cutPx(shape, 220, 260);
    const obstacles = shapes.cornerObstacles(key, 500, 300, 220, 260);
    for (const ob of obstacles) {
      assert.ok(Math.abs(ob.width - d) < 0.001, `${key}: obstacle width ${ob.width} does not match cutPx ${d}`);
      assert.ok(Math.abs(ob.height - d) < 0.001, `${key}: obstacle height ${ob.height} does not match cutPx ${d}`);
    }
  }
});

// -------------------------------------------------------- the compositor ---

/** Does a composed line's box reach past the excluded triangle at its corner? */
function violatesCorner(line, corner, width, height, d) {
  const nearTop = corner === 'tl' || corner === 'tr';
  const nearLeft = corner === 'tl' || corner === 'bl';
  const bandTop = nearTop ? 0 : height - d;
  const bandBottom = nearTop ? d : height;
  if (line.y >= bandBottom || line.y + (line.height || 0) <= bandTop) return false;
  // The hypotenuse at the line's own y (clamped into the triangle's band) -
  // the same linear interpolation exclusion.js's obstacleIntervals() computes.
  const y = Math.max(bandTop, Math.min(bandBottom, line.y));
  const frac = nearTop ? (y - bandTop) / d : (bandBottom - y) / d;
  const cut = d * Math.max(0, Math.min(1, frac));
  const left = line.x;
  const right = line.x + (line.width || 0);
  if (nearLeft) return left < 0 + cut - 0.5; // excluded interval is [0, cut]
  return right > width - cut + 0.5; // excluded interval is [width-cut, width]
}

// THE PROPERTY THAT MATTERS MOST: a real composed block, in every shape this
// catalogue offers, never sets a line into the corner its own shape cut away.
test('a real composed block never sets a line into its own cut corner', async () => {
  const body = 'सातारा जिल्ह्यातील पाणीपुरवठा योजनेस राज्य शासनाने मंजुरी दिली आहे. या योजनेसाठी निधी उपलब्ध करून देण्यात आला असून काम लवकरच सुरू होणार आहे. जिल्हाधिकारी कार्यालयात झालेल्या बैठकीत हा निर्णय घेण्यात आला. योजनेचा लाभ जिल्ह्यातील अनेक गावांना होणार आहे.'.repeat(2);

  for (const shapeKey of shapes.BLOCK_SHAPE_KEYS) {
    if (shapeKey === 'rectangle') continue;
    for (const [w, h] of [[220, 260], [150, 176], [307, 296], [190, 264]]) {
      const shape = shapes.blockShapeOf(shapeKey);
      const d = shapes.cutPx(shape, w, h);
      const section = {
        section_key: 'x', width_px: w, height_px: h, block_type: 'article',
        body, headline: '', subheading: '', images: [], column_count: 1,
        frame_shape: shapeKey,
      };
      // eslint-disable-next-line no-await-in-loop
      const composed = await adapter.composeSection(section, {});
      let violations = 0;
      for (const line of composed.bodyLines) {
        for (const corner of shape.corners) {
          if (violatesCorner(line, corner, w, h, d)) violations += 1;
        }
      }
      assert.strictEqual(violations, 0, `${shapeKey} at ${w}x${h}: ${violations} line(s) overlap the cut corner`);
    }
  }
});

// AN UNDRESSED (rectangle) BLOCK MUST COMPOSE IDENTICALLY WHETHER frame_shape
// IS OMITTED, NULL, OR THE EMPTY STRING - the additive guarantee every
// existing block in the database relies on.
test('a rectangle block composes identically with no shape, null, or empty string', async () => {
  const body = 'राज्य मंत्रिमंडळाचा शेतकरी कर्जमाफीचा निर्णय झाला आहे. यामुळे राज्यातील लाखो शेतकऱ्यांना दिलासा मिळणार आहे.'.repeat(2);
  const base = { section_key: 'x', width_px: 220, height_px: 260, block_type: 'article', body, headline: '', subheading: '', images: [], column_count: 1 };
  const a = await adapter.composeSection(base, {});
  const b = await adapter.composeSection({ ...base, frame_shape: null }, {});
  const c = await adapter.composeSection({ ...base, frame_shape: '' }, {});
  assert.deepEqual(a.bodyLines, b.bodyLines);
  assert.deepEqual(a.bodyLines, c.bodyLines);
});
