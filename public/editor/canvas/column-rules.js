// The column rules: the hairlines that separate one story from the next.
//
// This is the single most recognisable thing about a printed newspaper page,
// and it is PAGE FURNITURE - it belongs to the page, not to any block, exactly
// as the nameplate and the folio do (masthead.js). That is not a filing
// preference, it is what makes the rule correct:
//
//   * A rule belongs exactly halfway between the two stories it separates.
//     Drawn as a border on one block's own edge - which is how this started -
//     it sits 2 mm from that story's text and 5 mm from the other's, and the
//     eye reads it as belonging to the near one. That is the opposite of what
//     a rule is for.
//   * A block cannot draw outside itself. `.newspaper-section` is
//     `overflow: hidden` (it has to be - overset copy may not spill onto the
//     next story), so a pseudo-element offset into the gutter was clipped away
//     entirely. Measured, not assumed: the rules simply did not appear.
//   * A rule exists because two stories MEET. It is a fact about the pair, and
//     neither one of them owns it.
//
// So the layout is read and the gutters between neighbours are found: a rule
// runs the length over which the two blocks actually face each other, and
// stops where they stop. A rule that runs past its own pair is the "grid of
// boxes" look this is meant to replace.

// A gap wider than the grid's own gutter is not a gutter - it is a hole in the
// layout, or two blocks that merely happen to be near each other. Ruling those
// draws a line down the middle of white space nobody put there.
const SLACK_PX = 2;

// Below this the two blocks barely face each other at all - a rule would be a
// tick mark rather than a column rule. One baseline.
const MIN_RUN_PX = 8;

// An advert carries its own box (schema.sql's border_style), and a hairline
// 3 px outside that box is two rules where a printer draws one. The same goes
// for a block that has asked for a box of its own.
function rulable(section) {
  if (!section) return false;
  if (section.block_type === 'advert') return false;
  return section.border_style !== 'box';
}

const box = (s) => ({
  left: Number(s.x_px) || 0,
  top: Number(s.y_px) || 0,
  right: (Number(s.x_px) || 0) + (Number(s.width_px) || 0),
  bottom: (Number(s.y_px) || 0) + (Number(s.height_px) || 0),
});

/**
 * Merges rules that lie on the same line and touch or overlap.
 *
 * Three blocks stacked against one tall neighbour produce three separate
 * rules in the same gutter, each covering its own block's depth. They are one
 * rule, and drawing them as three leaves hairline seams where they abut - two
 * half-transparent edges meeting is visibly lighter than the line either side
 * of it.
 */
function merge(rules) {
  const byLine = new Map();
  for (const rule of rules) {
    const key = `${rule.axis}:${rule.at.toFixed(2)}`;
    if (!byLine.has(key)) byLine.set(key, []);
    byLine.get(key).push(rule);
  }
  const out = [];
  for (const [, group] of byLine) {
    group.sort((a, b) => a.from - b.from);
    let current = { ...group[0] };
    for (const rule of group.slice(1)) {
      if (rule.from <= current.to + 0.5) current.to = Math.max(current.to, rule.to);
      else { out.push(current); current = { ...rule }; }
    }
    out.push(current);
  }
  return out;
}

/** Every rule this page's layout asks for, in page pixels. */
export function columnRulesFor(page, geometry) {
  const sections = (page?.sections || []).filter(rulable);
  const gutterX = (geometry?.gutterPx ?? 6) + SLACK_PX;
  const gutterY = (geometry?.baselinePx ?? 8) + SLACK_PX;
  const rules = [];

  for (const a of sections) {
    const A = box(a);
    for (const b of sections) {
      if (a === b) continue;
      const B = box(b);

      // b sits to the RIGHT of a, one gutter away: a vertical rule down the
      // depth the two of them share.
      const across = B.left - A.right;
      if (across > 0 && across <= gutterX) {
        const from = Math.max(A.top, B.top);
        const to = Math.min(A.bottom, B.bottom);
        if (to - from >= MIN_RUN_PX) {
          rules.push({ axis: 'v', at: A.right + across / 2, from, to });
        }
      }

      // b sits BELOW a: a horizontal rule across the width they share.
      const down = B.top - A.bottom;
      if (down > 0 && down <= gutterY) {
        const from = Math.max(A.left, B.left);
        const to = Math.min(A.right, B.right);
        if (to - from >= MIN_RUN_PX) {
          rules.push({ axis: 'h', at: A.bottom + down / 2, from, to });
        }
      }
    }
  }

  return merge(rules);
}

/**
 * Those rules, drawn.
 *
 * Half a pixel wide, which at this page's 2 px/mm is a 0.25 mm hairline - what
 * a newspaper actually sets (0.25-0.5 pt). A `background` rather than a
 * `border`, so a sub-pixel line stays sub-pixel instead of being rounded up to
 * a whole one and rebalancing the box it is on.
 */
export function columnRulesMarkup(page, geometry) {
  const rules = columnRulesFor(page, geometry);
  if (!rules.length) return '';
  const spans = rules.map((rule) => (rule.axis === 'v'
    ? `<i style="left:${(rule.at - 0.25).toFixed(2)}px;top:${rule.from.toFixed(2)}px;width:0.5px;height:${(rule.to - rule.from).toFixed(2)}px"></i>`
    : `<i style="left:${rule.from.toFixed(2)}px;top:${(rule.at - 0.25).toFixed(2)}px;width:${(rule.to - rule.from).toFixed(2)}px;height:0.5px"></i>`));
  return `<div class="page-rules" aria-hidden="true">${spans.join('')}</div>`;
}
