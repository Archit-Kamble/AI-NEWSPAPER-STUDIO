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

  const api = Object.freeze({
    PX_PER_MM, BODY_TEXT_PT, DEFAULT_BODY_FONT_PX, ptToEditorPx, editorPxToPt,
  });
  root.SahasPublicationType = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
