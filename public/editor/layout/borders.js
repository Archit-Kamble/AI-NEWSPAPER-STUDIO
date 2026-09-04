// HOW A BLOCK IS RULED - once, for everywhere that draws a rule.
//
// This is the fourth catalogue shared by the browser and the server, beside
// the character grid, the block kinds, the picture style and the inks: the
// canvas, the Block Editor, the .sla and the print model all reach it, so a
// block cannot be boxed on screen and unruled on the plate. It was, until this
// existed - neither export drew a block border at all.
//
// A PRINTER SPECIFIES A RULE IN POINTS, so that is what the desk chooses. The
// column stores editor pixels (2 px/mm) because that is the unit every other
// geometry column is in; the conversion is stated here, once, and never
// silently - CLAUDE.md's own rule about mixing units.
//
// A CORNER RADIUS, WHICH THIS FILE ONCE REFUSED OUTRIGHT.
//
// It said "a rounded newspaper block is not a newspaper block; every rule on a
// printed page meets its neighbour square", and for a news page that is still
// true - which is why `DECORATION` in page-styles.js gives a radius only to
// the `full` level, a feature page, and leaves the front page square.
//
// But it is not true of a printed FEATURE page, and the reference paper's own
// world page was the evidence: its boxes are rounded. So the radius is a
// decision the desk (or the page's theme) makes, like the rule's weight, and
// not something this catalogue forbids on the desk's behalf.
//
// Stated in POINTS like the weights beside it, and stored in editor pixels for
// the same reason. Zero is square, and is the default, so no block that exists
// today changes.
(function installBorders(root) {
  const PT_PER_PX = 72 / 25.4 / 2;          // 2 px/mm, 72 pt/inch, 25.4 mm/inch
  const px = (pt) => Number((pt / PT_PER_PX).toFixed(2));

  // What the desk is offered. A rule below is the commonest separator on a
  // made-up page; a rule above marks the head of a section; both together box
  // a feature off without the side rules that would make it an advert.
  const BORDER_STYLES = Object.freeze([
    { key: 'none', label: 'None', edges: [] },
    { key: 'box', label: 'Box', edges: ['top', 'right', 'bottom', 'left'] },
    { key: 'rule', label: 'Rule below', edges: ['bottom'] },
    { key: 'rule-above', label: 'Rule above', edges: ['top'] },
    { key: 'rule-both', label: 'Rules above and below', edges: ['top', 'bottom'] },
    // THE SIDES, which this catalogue could not say. A rule below separates a
    // story from the one under it; a rule at the side separates it from the
    // column beside it, and a printed page rules both - a boxed sidebar set
    // against the leg it interrupts, a panel closed off down one edge only.
    // The desk could ask for a whole box or for nothing, so a block needing
    // one vertical rule had to be boxed and then the three unwanted rules
    // lived with.
    //
    // Nothing else in the chain changes for them, and that is the point of the
    // catalogue being one list: `borderEdges` already returns whatever a style
    // names, and print-model.js's RULES table already carries `left` and
    // `right` geometry it had never been handed. Only the browser's own
    // classes had to be written, because CSS has no `border-edges`.
    { key: 'rule-left', label: 'Rule left', edges: ['left'] },
    { key: 'rule-right', label: 'Rule right', edges: ['right'] },
    { key: 'rule-sides', label: 'Rules left and right', edges: ['left', 'right'] },
    // A DOUBLE RULE is one rule drawn twice with a gap of its own weight
    // between - the device every printed paper uses to say "this is a section,
    // not another story". It is not a thicker line and must not be drawn as
    // one: the eye reads two thin lines as a boundary and one thick line as
    // emphasis, which are different statements.
    { key: 'rule-double', label: 'Double rule below', edges: ['bottom'], double: true },
    { key: 'box-double', label: 'Double box', edges: ['top', 'right', 'bottom', 'left'], double: true },
    // FIVE MORE DOUBLE COMBINATIONS. Nothing here is a new mechanism - a
    // double rule has always been "the same edge set, drawn twice, with a gap
    // of its own weight between" (`isDouble` × whatever `edges` names), so
    // asking for a double rule on a side or on the top is the SAME code path
    // `rule-double` and `box-double` already run, offered under its own name
    // rather than left reachable only through a full box.
    { key: 'rule-above-double', label: 'Double rule above', edges: ['top'], double: true },
    { key: 'rule-left-double', label: 'Double rule left', edges: ['left'], double: true },
    { key: 'rule-right-double', label: 'Double rule right', edges: ['right'], double: true },
    { key: 'rule-sides-double', label: 'Double rules left and right', edges: ['left', 'right'], double: true },
    { key: 'rule-both-double', label: 'Double rules above and below', edges: ['top', 'bottom'], double: true },
  ]);

  // A printer's own ladder, NAMED rather than stated in points - the desk
  // asked for it by name: "add border width also as small normal medium
  // large extra large". The points underneath are unchanged from the four
  // this catalogue already offered (0.5, 1, 2, 4 - the hairline a page rules
  // a gutter with, up to the section rule that is as heavy as a page should
  // ever go); `Large` at 3 pt is the one new rung, inserted between the two
  // that were already a full point apart.
  //
  // STILL A T-SHIRT SCALE OVER A PRINTER'S UNIT, not a replacement of one. The
  // stored value is still `px`, still converted from points at this file's own
  // ratio, and still what `.sla`, PDF and IDML all read - a label is chosen
  // here, never a second unit.
  const BORDER_WIDTHS = Object.freeze([
    { pt: 0.5, px: px(0.5), label: 'Small' },
    { pt: 1, px: px(1), label: 'Normal' },
    { pt: 2, px: px(2), label: 'Medium' },
    { pt: 3, px: px(3), label: 'Large' },
    { pt: 4, px: px(4), label: 'Extra large' },
  ]);

  // A printer's own ladder again. `pill` is deliberately a large number rather
  // than a keyword: a fully round end is just a radius bigger than half the
  // box, and every renderer already clamps it to half, so nothing downstream
  // needs a special case for "circle".
  const BORDER_RADII = Object.freeze([
    { pt: 0, px: 0, label: 'Square' },
    { pt: 3, px: px(3), label: 'Soft' },
    { pt: 6, px: px(6), label: 'Round' },
    { pt: 120, px: px(120), label: 'Pill' },
  ]);

  /**
   * The stored radius in editor pixels, clamped to the ladder and never
   * negative. Zero is square and is the ordinary state.
   *
   * NOT clamped to half the box here: this function does not know the box.
   * Every renderer clamps against its own geometry, which is also what makes
   * `pill` work at any block size.
   */
  function borderRadiusPx(value) {
    const radius = Number(value);
    if (!Number.isFinite(radius) || radius <= 0) return 0;
    return Math.min(radius, BORDER_RADII[BORDER_RADII.length - 1].px);
  }

  /** A radius can only show where there is a rule on both edges of a corner. */
  const canRound = (key) => isBoxed(key);

  const KEYS = BORDER_STYLES.map((style) => style.key);
  const byKey = (key) => BORDER_STYLES.find((style) => style.key === String(key || 'none'))
    || BORDER_STYLES[0];

  /** The edges this style rules. Empty for 'none' and for anything unknown. */
  const borderEdges = (key) => byKey(key).edges;
  /** Does this style enclose the block on all four sides? */
  const isBoxed = (key) => borderEdges(key).length === 4;
  /** Is the rule drawn twice, with a gap of its own weight between? */
  const isDouble = (key) => Boolean(byKey(key).double);
  /**
   * The total ink a double rule occupies: two rules and the gap between them.
   * A boxed block insets its type by this, not by one rule's width, or the
   * inner rule lands on the first line.
   */
  const borderThicknessPx = (key, width) => borderWidthPx(width) * (isDouble(key) ? 3 : 1);
  /** Is anything ruled at all? */
  const isRuled = (key) => borderEdges(key).length > 0;

  /**
   * The stored width, clamped to the ladder's own range. Never zero: a rule
   * with no thickness is a rule nobody asked for, and 'none' is how you say
   * that.
   */
  function borderWidthPx(value) {
    const width = Number(value);
    // [1] is 'Normal' and stays the default for "ruled but no width chosen" -
    // the middle of the old four-rung ladder and still a sensible one of five.
    // The ceiling is `.length - 1`, not a literal index: BORDER_RADII already
    // learned this lesson (see its own borderRadiusPx below) - a literal `[3]`
    // silently stopped meaning "the top" the moment a fifth rung was added.
    if (!Number.isFinite(width) || width <= 0) return BORDER_WIDTHS[1].px;
    return Math.min(Math.max(width, BORDER_WIDTHS[0].px), BORDER_WIDTHS[BORDER_WIDTHS.length - 1].px);
  }

  const api = Object.freeze({
    BORDER_STYLES, BORDER_WIDTHS, BORDER_RADII, BORDER_KEYS: KEYS,
    borderEdges, isBoxed, isRuled, isDouble, borderWidthPx, borderThicknessPx,
    borderRadiusPx, canRound,
  });
  root.SahasBorders = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
