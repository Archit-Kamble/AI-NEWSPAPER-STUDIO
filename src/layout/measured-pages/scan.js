// A PAGE MEASURED OFF A SCAN, turned into a layout and a recipe.
//
// The first twelve reference pages were snapped onto a column grid, and the
// desk's verdict was that nothing lined up: a printed broadsheet's columns are
// not equal (the reference front page's run 350, 351, 354, 348 and 400 scan
// pixels), a rail is narrower than a story column, and a picture sits where
// the page put it, not on the nearest grid line. So a measured page is placed
// EXACTLY: every block, picture and panel is a rectangle read off the scan and
// scaled onto this page's matter box, and only the scaling is shared.
//
// A spec states, in SCAN pixels:
//   scan:   { x0, x1, y0, y1, top }  - the scan's matter box, and where its
//                                      first block starts on this page
//   blocks: [{ key, box, type, story, priority, style, pictures, panels }]
//
// and every type size in EDITOR pixels, because a size is decided by matching
// a face to the scan (scripts/reference-layout/fontmatch.py), not by scaling a
// guess. A block's own words are never here - panels carry a placeholder the
// local calibration copy replaces.
//
// The result is ordinary catalogue data: a template (templates.js) and a
// recipe (design-recipes.js). Nothing downstream knows it came from a scan.

const PLACEHOLDER = 'इथे मजकूर लिहा';
const MATTER = { left: 20, right: 640, bottom: 1008 };

function scaler(scan, top) {
  const sx = (MATTER.right - MATTER.left) / (scan.x1 - scan.x0);
  const sy = (MATTER.bottom - top) / (scan.y1 - scan.y0);
  const ex = (x) => MATTER.left + (x - scan.x0) * sx;
  const ey = (y) => top + (y - scan.y0) * sy;
  return { sx, sy, ex, ey };
}

const round = (value) => Math.round(value);

function buildMeasuredPage(spec) {
  const { ex, ey } = scaler(spec.scan, spec.scan.top);
  const rect = ([x0, y0, x1, y1]) => {
    const x = round(ex(x0));
    const y = round(ey(y0));
    return { x, y, width: round(ex(x1)) - x, height: round(ey(y1)) - y };
  };

  const sections = [];
  const recipe = {};
  for (const block of spec.blocks) {
    const frame = rect(block.box);
    sections.push({
      key: block.key,
      ...frame,
      ...(block.type ? { blockType: block.type } : {}),
      storyType: block.story || 'STANDARD',
      editorialPriority: block.priority || 3,
    });
    // Pictures and panels are given in scan pixels on the page and placed in
    // the block's own pixels, clipped to the block.
    const inside = (box) => {
      const r = rect(box);
      const x = Math.max(0, r.x - frame.x);
      const y = Math.max(0, r.y - frame.y);
      return {
        x, y,
        width: Math.max(8, Math.min(r.width, frame.width - x)),
        height: Math.max(8, Math.min(r.height, frame.height - y)),
      };
    };
    const entry = {
      style: block.style || {},
      pictures: (block.pictures || []).map(({ box, ...rest }) => ({ ...rest, ...inside(box) })),
      panels: (block.panels || []).map(({ box, ...rest }) => ({
        kind: 'sidebar',
        ...(rest.kind === 'ornament' || rest.kind === 'chart' || rest.kind === 'table' ? {} : { title: rest.lines ? undefined : PLACEHOLDER }),
        ...rest,
        ...inside(box),
      })),
    };
    if (block.advert) entry.advert = block.advert;
    recipe[block.key] = entry;
  }

  return {
    template: {
      key: spec.key,
      name: spec.name,
      description: spec.description,
      measured: true,
      // Geometry plus block() options; templates.js turns each into a frame.
      sections: sections.map(({ blockType, storyType, editorialPriority, ...geometry }) => ({
        ...geometry,
        options: { ...(blockType ? { type: blockType } : {}), story: storyType, priority: editorialPriority },
      })),
    },
    recipe,
    theme: spec.theme || null,
  };
}

module.exports = { buildMeasuredPage, scaler, PLACEHOLDER };
