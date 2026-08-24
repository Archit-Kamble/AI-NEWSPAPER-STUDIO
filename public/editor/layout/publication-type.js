// The publication's physical type scale, shared by Node and the browser.
//
// Editor geometry uses 2 px/mm; Scribus uses points. Running body copy is a
// publication style, not a function of the rectangle it happens to occupy:
// a wider story gets more columns, not larger body type. Nine point is the
// newspaper reading size SAHAS uses. At 2 px/mm that is 6.35 editor px, stored
// to the schema's one-decimal precision as 6.4 px (9.07 pt at press output).
//
// Dual CJS/browser side-effect, matching headline-reserve.js and the other
// small shared publication catalogs in this project.
(function installPublicationType(root) {
  const PX_PER_MM = 2;
  const MM_PER_INCH = 25.4;
  const POINTS_PER_INCH = 72;
  const BODY_TEXT_PT = 9;

  const ptToEditorPx = (pt) => {
    const raw = (Number(pt) / POINTS_PER_INCH) * MM_PER_INCH * PX_PER_MM;
    // 9pt is mathematically 6.35px. Binary floating point represents that a
    // hair below the half and `toFixed(1)` rounds it to 6.3; explicit decimal
    // half-up rounding preserves the physical value the catalog specifies.
    return Math.round((raw + Number.EPSILON) * 10) / 10;
  };
  const editorPxToPt = (px) => (Number(px) / PX_PER_MM) * POINTS_PER_INCH / MM_PER_INCH;
  const DEFAULT_BODY_FONT_PX = ptToEditorPx(BODY_TEXT_PT);

  // THE TYPE LADDER, IN POINTS - the one list of sizes this product offers.
  //
  // A printer sets type in points, and every size control in the Block Editor
  // used to offer something else: the object-size select listed raw editor
  // BLOCK pixels (6.4, 24, 140), and the marks toolbar listed four ratios of
  // the block's own body. Two controls a centimetre apart, both called "size",
  // in two units, neither of them the unit a press works in - which is how a
  // desk came to report that "the font size is changing automatically" when
  // all that had happened was that the select retargeted from a 6.4px body to
  // a 24px headline.
  //
  // Half-point steps through reading sizes because that is the granularity a
  // sub-editor actually uses (the columns are NUMERIC(5,1) for the same
  // reason), opening out as the type gets bigger, where a half point is
  // invisible. It starts at 6.5pt, which is the smallest type preflight will
  // pass a page with.
  const TYPE_LADDER_PT = Object.freeze([
    6.5, 7, 7.5, 8, 8.5, 9, 9.5, 10, 10.5, 11, 12, 13, 14, 16, 18, 20, 22, 24,
    28, 32, 36, 42, 48, 54, 60, 72, 84, 96, 120, 144, 168, 200,
  ]);

  const formatPt = (pt) => String(Math.round(Number(pt) * 10) / 10);

  /**
   * The ladder as {px, pt, label} rungs, with `current` folded in.
   *
   * A block whose type a desk (or the auto-fit) has set to something off the
   * ladder must still be able to show what it is set at, so its own size is
   * inserted in order rather than silently rounded to a neighbour.
   */
  const typeLadder = (currentPx) => {
    const current = Number(currentPx);
    const rungs = TYPE_LADDER_PT.map((pt) => ({ pt, px: ptToEditorPx(pt) }));
    if (Number.isFinite(current) && current > 0 && !rungs.some((rung) => rung.px === current)) {
      rungs.push({ pt: editorPxToPt(current), px: current });
      rungs.sort((a, b) => a.px - b.px);
    }
    return rungs.map((rung) => ({ ...rung, label: `${formatPt(rung.pt)} pt` }));
  };

  const api = Object.freeze({
    PX_PER_MM, BODY_TEXT_PT, DEFAULT_BODY_FONT_PX, ptToEditorPx, editorPxToPt,
    TYPE_LADDER_PT, typeLadder, formatPt,
  });
  root.SahasPublicationType = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
