// THE PUBLICATION'S TYPEFACES - once, for everywhere that measures, shapes or
// draws one.
//
// WHY THIS FILE EXISTS. The list of faces and the rule for choosing between
// them were written out in THREE places - compose/font-metrics.js (which
// measures), compose/shaper.js (which shapes) and services/export/pdf.writer.js
// (which embeds) - and shaper.js's own comment admitted the duplication and
// said it was kept "identical" by hand. That is the duplicated-catalogue
// failure this project has already been bitten by twice (the drifted template
// keys, `object-fit: cover` against `contain`), sitting in the one place where
// a drift would mean the press file setting a different face from the screen.
//
// It had already drifted once, in a way font-metrics.js records: "Arial" and
// "Helvetica Neue" contain neither "serif" nor "sans", so for as long as that
// classification existed they were silently measured as the SERIF face.
//
// ADDING A FACE. Put it here and nothing else needs to know: the measurer, the
// shaper, the browser and the press PDF all read this. It needs a real TTF in
// public/assets/fonts (the compositor reads hmtx out of the file itself, so a
// webfont-only family cannot be measured) and a licence that permits
// redistribution - every face below is SIL Open Font License 1.1.
//
// A face with no bold cut maps its 700 to its 400 deliberately, and says so.
// The alternative is a synthesised bold, which for Devanagari thickens the
// shirorekha unevenly and looks like a printing fault.
(function installTypefaces(root) {
  const DIR = '/assets/fonts/';

  // `short` is the name a BUTTON can carry - the device bar shows which face
  // is in force and "Sahas Serif" or "Tiro Devanagari Marathi" will not fit on
  // one. Named here rather than truncated at the button, because slicing a
  // label to six characters produced "Tiro D" and "Rozha ", which is not a
  // name; a face's short name is a fact about the face.
  const TYPEFACES = Object.freeze([
    {
      key: 'serif',
      label: 'Sahas Serif',
      short: 'Serif',
      note: 'The running face. Noto Serif Devanagari.',
      role: 'text',
      css: "'Sahas Serif', 'Noto Serif Devanagari', Georgia, serif",
      files: { 400: `${DIR}NotoSerifDevanagari-Regular.ttf`, 700: `${DIR}NotoSerifDevanagari-Bold.ttf` },
    },
    {
      key: 'sans',
      label: 'Sahas Sans',
      short: 'Sans',
      note: 'Furniture, captions and decks. Noto Sans Devanagari.',
      role: 'text',
      css: "'Sahas Sans', 'Noto Sans Devanagari', Arial, sans-serif",
      files: { 400: `${DIR}NotoSansDevanagari-Regular.ttf`, 700: `${DIR}NotoSansDevanagari-Bold.ttf` },
    },
    {
      key: 'tiro',
      label: 'Tiro Devanagari Marathi',
      short: 'Tiro',
      note: 'A text serif drawn for Marathi specifically - the Marathi forms of ल, श and ऱ are the language’s own, not Hindi’s. One weight.',
      role: 'text',
      boldIsSynthetic: true,
      css: "'Tiro Devanagari Marathi', 'Sahas Serif', Georgia, serif",
      files: { 400: `${DIR}TiroDevanagariMarathi-Regular.ttf`, 700: `${DIR}TiroDevanagariMarathi-Regular.ttf` },
    },
    {
      key: 'mukta',
      label: 'Mukta',
      short: 'Mukta',
      note: 'A humanist Devanagari sans that sets tighter than Noto - useful where a column is short of room.',
      role: 'text',
      css: "'Mukta', 'Sahas Sans', Arial, sans-serif",
      files: { 400: `${DIR}Mukta-Regular.ttf`, 700: `${DIR}Mukta-Bold.ttf` },
    },
    {
      key: 'khand',
      label: 'Khand',
      short: 'Khand',
      note: 'Condensed display. What a headline is set in when it has more words than measure.',
      role: 'display',
      css: "'Khand', 'Sahas Sans', Arial, sans-serif",
      files: { 400: `${DIR}Khand-Regular.ttf`, 700: `${DIR}Khand-Bold.ttf` },
    },
    {
      // THE SAME CONDENSED CUT, AT ITS BOOK WEIGHT - for headlines. Headlines
      // are set at 700 by the compositor, and a printed Marathi daily sets many
      // of its headlines light: measured on the reference broadsheet, a banner
      // or a second-rank head has a stroke of 0.06-0.08 em against the lead's
      // 0.12. Khand Bold measures 0.115 and Khand Regular 0.055, so this key
      // maps BOTH weights to the regular cut, the way a one-weight face already
      // maps its 700 to its 400 - a light headline without a weight column.
      key: 'khand-light',
      label: 'Khand Light',
      short: 'Khand L',
      note: 'Khand at its book weight, for a light display head.',
      role: 'display',
      css: "'Khand Light', 'Khand', 'Sahas Sans', Arial, sans-serif",
      files: { 400: `${DIR}Khand-Regular.ttf`, 700: `${DIR}Khand-Regular.ttf` },
    },
    // FOUR FACES MEASURED OFF A PRINTED MARATHI BROADSHEET. Each was chosen by
    // setting the reference page's own words in some fifty OFL Devanagari cuts
    // and correlating the result against the scan at matched ink height,
    // requiring the width to agree within 3.5% - a face that is the right
    // shape but the wrong width breaks every headline at a different word.
    // scripts/reference-layout/fontmatch.py is the tool. As with khand-light,
    // a key that names one weight maps both of its weights to that cut.
    {
      key: 'mukta-semibold',
      label: 'Mukta SemiBold',
      short: 'Mukta SB',
      note: 'Mukta at 600, for a banner or a feature head that is not the lead.',
      role: 'display',
      css: "'Mukta SemiBold', 'Mukta', 'Sahas Sans', Arial, sans-serif",
      files: { 400: `${DIR}Mukta-SemiBold.ttf`, 700: `${DIR}Mukta-SemiBold.ttf` },
    },
    {
      key: 'mukta-heavy',
      label: 'Mukta ExtraBold',
      short: 'Mukta XB',
      note: 'Mukta at 800, for the lead head that shouts loudest on the page.',
      role: 'display',
      css: "'Mukta ExtraBold', 'Mukta', 'Sahas Sans', Arial, sans-serif",
      files: { 400: `${DIR}Mukta-ExtraBold.ttf`, 700: `${DIR}Mukta-ExtraBold.ttf` },
    },
    {
      // Noto Sans Devanagari's own variable font, instanced at 80% width -
      // the condensed second-rank head. 400 is the medium weight, 700 the
      // semibold, which is as heavy as that head is set.
      key: 'noto-condensed',
      label: 'Noto Sans Condensed',
      short: 'Noto C',
      note: 'Noto Sans Devanagari at 80% width, for a condensed second-rank head.',
      role: 'display',
      css: "'Noto Sans Condensed', 'Sahas Sans', Arial, sans-serif",
      files: { 400: `${DIR}NotoSansDevanagariCondensed-Medium.ttf`, 700: `${DIR}NotoSansDevanagariCondensed-SemiBold.ttf` },
    },
    {
      key: 'rajdhani',
      label: 'Rajdhani',
      short: 'Rajdhani',
      note: 'A square condensed sans, for decks, sub-heads and panel headings.',
      role: 'display',
      css: "'Rajdhani', 'Sahas Sans', Arial, sans-serif",
      files: { 400: `${DIR}Rajdhani-SemiBold.ttf`, 700: `${DIR}Rajdhani-Bold.ttf` },
    },
    {
      key: 'rozha',
      label: 'Rozha One',
      short: 'Rozha',
      note: 'A heavy display serif for the splash. One weight, and it is already the heavy one.',
      role: 'display',
      boldIsSynthetic: true,
      css: "'Rozha One', 'Sahas Serif', Georgia, serif",
      files: { 400: `${DIR}RozhaOne-Regular.ttf`, 700: `${DIR}RozhaOne-Regular.ttf` },
    },
  ]);

  const BY_KEY = new Map(TYPEFACES.map((face) => [face.key, face]));

  /**
   * Which face a stored `font_family` means.
   *
   * A key first - that is what the picker now stores. Then the legacy
   * substring rule, unchanged, so every row written before this file existed
   * resolves exactly as it did: a desk could pick "Georgia" or "Arial", real
   * system fonts with no Devanagari in them at all, and those have always
   * meant the serif or the sans publication face underneath.
   */
  function typefaceOf(family = '') {
    const value = String(family || '').trim().toLowerCase();
    if (!value) return BY_KEY.get('serif');
    if (BY_KEY.has(value)) return BY_KEY.get(value);
    for (const face of TYPEFACES) {
      if (face.key === 'serif' || face.key === 'sans') continue;
      if (value.includes(face.key) || value.includes(face.label.toLowerCase())) return face;
    }
    const sans = value.includes('sans') || value.includes('arial') || value.includes('helvetica');
    return BY_KEY.get(sans ? 'sans' : 'serif');
  }

  const normaliseWeight = (weight) => (Number(weight) >= 600 ? 700 : 400);

  /** The registry key a face is cached and embedded under. */
  const faceKey = (family = 'serif', weight = 400) => `${typefaceOf(family).key}/${normaliseWeight(weight)}`;

  /** Every key to its TTF, which is what the measurer and the embedder load. */
  const FONT_FILES = Object.freeze(TYPEFACES.reduce((all, face) => {
    all[`${face.key}/400`] = face.files[400];
    all[`${face.key}/700`] = face.files[700];
    return all;
  }, {}));

  /** Real CSS naming the @font-face families styles.css actually declares. */
  const publicationFamily = (value = '') => {
    const face = typefaceOf(value);
    return { key: face.key, css: face.css };
  };

  const api = Object.freeze({
    TYPEFACES, FONT_FILES, typefaceOf, faceKey, publicationFamily, normaliseWeight,
  });
  root.SahasTypefaces = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
