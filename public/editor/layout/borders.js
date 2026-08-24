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
// There is deliberately NO corner radius. A rounded newspaper block is not a
// newspaper block; every rule on a printed page meets its neighbour square.
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
  ]);

  // A printer's own ladder. The hairline is what a page rules a gutter with;
  // 4 pt is a section rule and is as heavy as a page should ever go.
  const BORDER_WIDTHS = Object.freeze([
    { pt: 0.5, px: px(0.5), label: 'Hairline' },
    { pt: 1, px: px(1), label: '1 pt' },
    { pt: 2, px: px(2), label: '2 pt' },
    { pt: 4, px: px(4), label: '4 pt' },
  ]);

  const KEYS = BORDER_STYLES.map((style) => style.key);
  const byKey = (key) => BORDER_STYLES.find((style) => style.key === String(key || 'none'))
    || BORDER_STYLES[0];

  /** The edges this style rules. Empty for 'none' and for anything unknown. */
  const borderEdges = (key) => byKey(key).edges;
  /** Does this style enclose the block on all four sides? */
  const isBoxed = (key) => borderEdges(key).length === 4;
  /** Is anything ruled at all? */
  const isRuled = (key) => borderEdges(key).length > 0;

  /**
   * The stored width, clamped to the ladder's own range. Never zero: a rule
   * with no thickness is a rule nobody asked for, and 'none' is how you say
   * that.
   */
  function borderWidthPx(value) {
    const width = Number(value);
    if (!Number.isFinite(width) || width <= 0) return BORDER_WIDTHS[1].px;
    return Math.min(Math.max(width, BORDER_WIDTHS[0].px), BORDER_WIDTHS[3].px);
  }

  const api = Object.freeze({
    BORDER_STYLES, BORDER_WIDTHS, BORDER_KEYS: KEYS,
    borderEdges, isBoxed, isRuled, borderWidthPx,
  });
  root.SahasBorders = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
