// What colours this paper can print, and the whole of them.
//
// SAHAS VARTA is printed from four plates. Every colour that reaches a page
// therefore has to be a colour the press can separate, which is why nothing in
// this product offers a colour WHEEL: a value a desk mixes in a browser is an
// ink that does not exist, and it would arrive at the press as a rich-black
// mess or as nothing at all.
//
// Two palettes, one file, because they answer the same question and a second
// copy of either is the failure mode this codebase has already been bitten by
// (the drifted template keys, `object-fit: cover` against `contain`). The
// browser reads this to draw the controls and paint the page; the server reads
// it - through the same dynamic import() the character grid and the block
// kinds already use - to name the separation in a .sla.
//
//   INKS   a colour on selected WORDS (rich-text.js's `data-sahas-ink` mark)
//   TINTS  a light ground behind a whole BLOCK (page_sections.background_color)

/**
 * The paper's own inks: the red of its nameplate, and the two spot colours a
 * Marathi daily actually uses in a headline.
 *
 * Black carries no hex, deliberately - it is the ABSENCE of a mark, so
 * choosing it clears the ink rather than adding a fourth one.
 */
// SEVEN INKS, NOT FOUR. The desk asked for more colours for a character, a
// word or a line, and there is no press reason to refuse: every one of these
// is defined in the .sla as a PROCESS colour (Spot="0"), so it separates onto
// the four plates the paper already prints from - it is not a fifth plate and
// costs the press nothing. What the palette is for is stopping a colour mixed
// in a browser reaching a plate, and a longer list of named, separated inks
// does that exactly as well as a short one.
//
// Each is dark enough to hold small Devanagari on newsprint. A pale ink is not
// on this list on purpose: it is a TINT, it belongs behind type rather than in
// it, and it is in the table below.
export const INKS = [
  { key: 'black', label: 'Black', hex: null, scribus: 'Black' },
  { key: 'red', label: 'Red', hex: '#c8102e', scribus: 'SahasRed' },
  { key: 'blue', label: 'Blue', hex: '#17458f', scribus: 'SahasBlue' },
  { key: 'green', label: 'Green', hex: '#0a7a3f', scribus: 'SahasGreen' },
  { key: 'orange', label: 'Orange', hex: '#d2601a', scribus: 'SahasOrange' },
  { key: 'purple', label: 'Purple', hex: '#5b2a86', scribus: 'SahasPurple' },
  { key: 'teal', label: 'Teal', hex: '#0f6d78', scribus: 'SahasTeal' },
  // THIRTEEN MORE, so a paper of a dozen pages can give each one a look of
  // its own without two of them wearing the same colour. Every one is a
  // PROCESS colour in the .sla (Spot="0") exactly as the seven above are, so
  // a longer palette is not a longer press run - it separates onto the same
  // four plates. What the palette is for is stopping a colour mixed in a
  // browser reaching a plate, and a longer list of named, separated inks
  // does that exactly as well as a short one.
  //
  // Each is dark enough to hold small Devanagari on newsprint - checked, not
  // eyeballed: tests/blockSurface.test.js holds every ink under a Rec. 709
  // luma of 120 and every tint over 228, which is the rule the originals
  // were chosen against and is not relaxed because the list got longer.
  { key: 'maroon', label: 'Maroon', hex: '#8a1c30', scribus: 'SahasMaroon' },
  { key: 'rose', label: 'Rose', hex: '#b4315f', scribus: 'SahasRose' },
  { key: 'navy', label: 'Navy', hex: '#16305e', scribus: 'SahasNavy' },
  { key: 'sky', label: 'Sky', hex: '#1b6fb0', scribus: 'SahasSky' },
  { key: 'forest', label: 'Forest', hex: '#14562b', scribus: 'SahasForest' },
  { key: 'olive', label: 'Olive', hex: '#5f6b1e', scribus: 'SahasOlive' },
  { key: 'amber', label: 'Amber', hex: '#b06a08', scribus: 'SahasAmber' },
  { key: 'rust', label: 'Rust', hex: '#a3441a', scribus: 'SahasRust' },
  { key: 'brown', label: 'Brown', hex: '#6b4423', scribus: 'SahasBrown' },
  { key: 'plum', label: 'Plum', hex: '#7a2455', scribus: 'SahasPlum' },
  { key: 'violet', label: 'Violet', hex: '#43308f', scribus: 'SahasViolet' },
  { key: 'slate', label: 'Slate', hex: '#3f4a56', scribus: 'SahasSlate' },
  { key: 'pine', label: 'Pine', hex: '#0f5c4f', scribus: 'SahasPine' },
  // MEASURED OFF A PRINTED MARATHI BROADSHEET (the reference page scans), not
  // chosen: the scarlet of its labels and chips, the cyan its section tabs are
  // reversed out of, and the marigold of its separator rules. Marigold is far
  // too light to hold small Devanagari on newsprint, so it is marked `rule` -
  // offered for rules, bands and accents, never for type.
  { key: 'scarlet', label: 'Scarlet', hex: '#e42424', scribus: 'SahasScarlet' },
  { key: 'cyan', label: 'Cyan', hex: '#0b8bd3', scribus: 'SahasCyan' },
  { key: 'marigold', label: 'Marigold', hex: '#fb9f0b', scribus: 'SahasMarigold', rule: true },
];

/**
 * A light ground behind a block: a printed side-bar or box-out carries a few
 * per cent of one ink so it reads as separate furniture without a rule around
 * it. Heavier than this and the copy loses its contrast on newsprint.
 *
 * White carries no hex for the same reason Black does not: it is the paper,
 * and it is stored as NULL so a block nobody tinted can be told from one a
 * desk deliberately set to white.
 */
export const TINTS = [
  { key: 'white', label: 'White', hex: null, scribus: 'None' },
  { key: 'grey', label: 'Grey', hex: '#f2f2f4', scribus: 'SahasTintGrey' },
  { key: 'cream', label: 'Cream', hex: '#fbf3e9', scribus: 'SahasTintCream' },
  { key: 'pink', label: 'Pink', hex: '#fdf1f3', scribus: 'SahasTintPink' },
  { key: 'blue', label: 'Blue', hex: '#eef3fb', scribus: 'SahasTintBlue' },
  // Three more grounds, asked for by the desk. Every one is a few per cent of
  // one ink - heavier than this and the copy loses its contrast on newsprint,
  // which is the rule the five above were chosen against and is not relaxed
  // because the list got longer.
  { key: 'mint', label: 'Mint', hex: '#eef7f0', scribus: 'SahasTintMint' },
  { key: 'lilac', label: 'Lilac', hex: '#f3eefa', scribus: 'SahasTintLilac' },
  { key: 'sand', label: 'Sand', hex: '#f8f2e7', scribus: 'SahasTintSand' },
  // The eighth ground, added so every ink in the table above has a tint of its
  // own hue to sit on. `page-styles.js` pairs the two into the light-ground /
  // darker-rule / darker-heading triple a printed feature page is set in, and
  // teal was the one ink with no ground to pair with.
  { key: 'teal', label: 'Teal', hex: '#eef6f7', scribus: 'SahasTintTeal' },
  // A GROUND FOR EVERY INK. `page-styles.js` pairs the two into the light-
  // ground / darker-rule / darker-heading triple a printed feature page is
  // set in, so an ink with no ground of its own hue cannot be a hue family.
  { key: 'maroon', label: 'Maroon', hex: '#f9f0f2', scribus: 'SahasTintMaroon' },
  { key: 'rose', label: 'Rose', hex: '#fcf0f4', scribus: 'SahasTintRose' },
  { key: 'navy', label: 'Navy', hex: '#eef1f7', scribus: 'SahasTintNavy' },
  { key: 'sky', label: 'Sky', hex: '#eef5fb', scribus: 'SahasTintSky' },
  { key: 'forest', label: 'Forest', hex: '#eef5f0', scribus: 'SahasTintForest' },
  { key: 'olive', label: 'Olive', hex: '#f5f6ec', scribus: 'SahasTintOlive' },
  { key: 'amber', label: 'Amber', hex: '#fbf4e8', scribus: 'SahasTintAmber' },
  { key: 'rust', label: 'Rust', hex: '#fbf1eb', scribus: 'SahasTintRust' },
  { key: 'brown', label: 'Brown', hex: '#f7f3ee', scribus: 'SahasTintBrown' },
  { key: 'plum', label: 'Plum', hex: '#f8eff4', scribus: 'SahasTintPlum' },
  { key: 'violet', label: 'Violet', hex: '#f0eefa', scribus: 'SahasTintViolet' },
  { key: 'pine', label: 'Pine', hex: '#eef5f3', scribus: 'SahasTintPine' },
  // EIGHTEEN VIVID VARIANTS - measured, not invented.
  //
  // The desk's report: "look at internet specially entertainment pages of
  // newspapers you will find better theme ... make sure ... border width and
  // other minute details are also same." Pixel-sampled directly from the
  // paper's OWN reference pages (Pudhari's Sports and विश्वसंचार pages,
  // screenshotted at full resolution) rather than approximated: the real
  // block grounds cluster around 15-20% of their ink mixed into white
  // (#d1eded, #efd4c8, #efd8da measured), where the pale tints above were
  // mixed at roughly 5-8% - visibly washed out by comparison.
  //
  // Computed with the SAME screenOf() mixing this file already uses for a
  // headline band's screen (share 0.17, the measured middle of that real
  // range), against the SAME eighteen already-legibility-tested inks above -
  // never a new, unverified hue. Black body type keeps 18-19:1 contrast
  // against every one of them, far past WCAG's 4.5:1 floor.
  //
  // A PARALLEL set, not a replacement: the pale originals stay exactly as
  // they were for the desk's own manual tint picker and everything already
  // shipped that reads it. Only page-styles.js's automatic page theming
  // reaches for these - the one surface the desk was comparing against a
  // real printed page.
  { key: 'vivid-red', label: 'Vivid Red', hex: '#f6d6db', scribus: 'SahasTintVividRed' },
  { key: 'vivid-blue', label: 'Vivid Blue', hex: '#d8dfec', scribus: 'SahasTintVividBlue' },
  { key: 'vivid-green', label: 'Vivid Green', hex: '#d5e8de', scribus: 'SahasTintVividGreen' },
  { key: 'vivid-purple', label: 'Vivid Purple', hex: '#e3dbea', scribus: 'SahasTintVividPurple' },
  { key: 'vivid-orange', label: 'Vivid Orange', hex: '#f7e4d8', scribus: 'SahasTintVividOrange' },
  { key: 'vivid-teal', label: 'Vivid Teal', hex: '#d6e6e8', scribus: 'SahasTintVividTeal' },
  { key: 'vivid-maroon', label: 'Vivid Maroon', hex: '#ebd8dc', scribus: 'SahasTintVividMaroon' },
  { key: 'vivid-rose', label: 'Vivid Rose', hex: '#f2dce4', scribus: 'SahasTintVividRose' },
  { key: 'vivid-navy', label: 'Vivid Navy', hex: '#d7dce4', scribus: 'SahasTintVividNavy' },
  { key: 'vivid-sky', label: 'Vivid Sky', hex: '#d8e7f2', scribus: 'SahasTintVividSky' },
  { key: 'vivid-forest', label: 'Vivid Forest', hex: '#d7e2db', scribus: 'SahasTintVividForest' },
  { key: 'vivid-olive', label: 'Vivid Olive', hex: '#e4e6d9', scribus: 'SahasTintVividOlive' },
  { key: 'vivid-amber', label: 'Vivid Amber', hex: '#f2e6d5', scribus: 'SahasTintVividAmber' },
  { key: 'vivid-rust', label: 'Vivid Rust', hex: '#efdfd8', scribus: 'SahasTintVividRust' },
  { key: 'vivid-brown', label: 'Vivid Brown', hex: '#e6dfda', scribus: 'SahasTintVividBrown' },
  { key: 'vivid-plum', label: 'Vivid Plum', hex: '#e8dae2', scribus: 'SahasTintVividPlum' },
  { key: 'vivid-violet', label: 'Vivid Violet', hex: '#dfdcec', scribus: 'SahasTintVividViolet' },
  { key: 'vivid-pine', label: 'Vivid Pine', hex: '#d6e3e1', scribus: 'SahasTintVividPine' },
  // Grounds MEASURED off the same reference scans - the powder blue behind a
  // sidebar, the orchid of a feature panel, the blush and peach of tinted
  // boxes, the silver of a ruled team box. Deeper than the pale family, so they
  // are held to the vivid family's contrast rule rather than its luma floor.
  { key: 'powder', label: 'Powder', hex: '#c9e7f3', scribus: 'SahasTintPowder', reference: true },
  { key: 'orchid', label: 'Orchid', hex: '#e7c9e7', scribus: 'SahasTintOrchid', reference: true },
  { key: 'blush', label: 'Blush', hex: '#f4e4dc', scribus: 'SahasTintBlush', reference: true },
  { key: 'peach', label: 'Peach', hex: '#fce4cc', scribus: 'SahasTintPeach', reference: true },
  { key: 'silver', label: 'Silver', hex: '#eaeaea', scribus: 'SahasTintSilver', reference: true },
];

// A colour that has been through the DOM comes back as `rgb(200, 16, 46)`,
// never as the hex it was set with - a browser normalises every inline colour.
// Both forms have to resolve to the same ink, or a mark applied in Quill
// (which reads its own attribute back off the element) would be dropped on the
// way to storage while the screen went on showing it. Measured exactly that
// way: Quill painted the words red in its own DOM and recorded nothing.
const RGB = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i;
const asHex = (value) => {
  const match = RGB.exec(value);
  if (!match) return value;
  return `#${[1, 2, 3].map((i) => Number(match[i]).toString(16).padStart(2, '0')).join('')}`;
};

const byHex = (palette) => new Map(palette.filter((entry) => entry.hex).map((entry) => [entry.hex.toLowerCase(), entry]));
const INK_BY_HEX = byHex(INKS);
const TINT_BY_HEX = byHex(TINTS);

const lookup = (table, value) => table.get(asHex(String(value ?? '').trim().toLowerCase())) || null;

/** One of the paper's inks, or null - never an arbitrary colour. */
export function sanitiseInk(value) {
  return lookup(INK_BY_HEX, value)?.hex ?? null;
}

/** One of the paper's tints, or null - null being the paper's own white. */
export function sanitiseTint(value) {
  return lookup(TINT_BY_HEX, value)?.hex ?? null;
}

/** The Scribus separation a colour prints from. */
export function inkSeparation(hex) {
  return lookup(INK_BY_HEX, hex)?.scribus || 'Black';
}

export function tintSeparation(hex) {
  return lookup(TINT_BY_HEX, hex)?.scribus || 'None';
}

// HOW THE HEADLINE BAND IS TREATED - one catalogue, read by the Properties
// control, by the canvas renderer and by the press model, so no surface can
// invent a treatment or draw one differently.
//
// `reverse` was the only ground a display band could have: white type out of a
// solid ink. The desk asked for background colours behind the headline and the
// subheading, and a printed paper's answer to that is not a solid panel - it is
// a SCREEN, a few per cent of an ink, with the type left in its own colour.
// That is what `band` is, and it is why the type is untouched: a screen light
// enough to read black Devanagari through is not light enough to read white
// through, so a treatment that did both would be two treatments.
export const HEADLINE_STYLES = [
  { key: 'plain', label: 'Plain', grounds: [] },
  { key: 'accent', label: 'Accent word', grounds: [], accentWord: true },
  { key: 'reverse', label: 'Reversed', grounds: [], reverse: true },
  // `deck`, not `subheading`: that is the compositor's own key for the band
  // (BAND_CLASS in compose/render.js). Naming the COLUMN here drew the screen
  // behind the headline and silently nothing behind the deck - measured, one
  // screen where two were asked for.
  { key: 'band', label: 'Screen behind the headline', grounds: ['headline'] },
  { key: 'band-deck', label: 'Screen behind the deck', grounds: ['deck'] },
  { key: 'band-both', label: 'Screen behind both', grounds: ['headline', 'deck'] },
  // Display furniture from the same sober vocabulary used by strong print
  // front pages. None changes a line's measure: each is ink painted into the
  // space the compositor has already assigned to the kicker/headline/deck.
  { key: 'headline-rule', label: 'Rule below headline', grounds: [], ruleAfter: 'headline' },
  { key: 'accent-rule', label: 'Accent word + rule', grounds: [], accentWord: true, ruleAfter: 'headline' },
  { key: 'display-rule', label: 'Rule below display', grounds: [], ruleAfter: 'display' },
  { key: 'kicker-tab', label: 'Section tab', grounds: [], kickerTab: true },
  { key: 'kicker-tab-rule', label: 'Section tab + rule', grounds: [], kickerTab: true, ruleAfter: 'display' },
  // A PAGE-LEVEL SEPARATOR set on a story's own kicker: a rule across the whole
  // measure through the kicker's middle, and the kicker reversed out of a chip
  // in the accent, centred on it. Measured off the reference broadsheet, which
  // opens its "must read" group this way - marigold rule, scarlet chip, white
  // type. The rule takes the block's RULE ink (border_ink), the chip its accent,
  // so the two can be the two different inks the reference uses. The kicker is
  // centred by the compositor like any centred display flow; nothing moves.
  { key: 'kicker-chip-rule', label: 'Chip on a rule (separator)', grounds: [], kickerChip: true, kickerScale: 1.45 },
  // A SECTION LABEL over a column of shorts - the large accent-coloured word
  // the reference sets above its rail ("quick update", "shorts"). The kicker is
  // set at 2.4x the body and in the accent; nothing is drawn behind it.
  { key: 'kicker-label', label: 'Large section label', grounds: [], kickerScale: 2.4, kickerAccent: true },
  // The small scarlet column label an opinion page sets over each piece: the
  // kicker a little larger than the body, in the accent, nothing behind it.
  { key: 'kicker-accent', label: 'Coloured column label', grounds: [], kickerScale: 1.3, kickerAccent: true },
  // More display hierarchy without stealing one pixel from the story. The
  // rule variants differ in length, position and rhythm, but they are all
  // painted into gaps the compositor has already proved are empty.
  { key: 'headline-rule-short', label: 'Short rule below headline', grounds: [], ruleAfter: 'headline', ruleShare: 0.34 },
  { key: 'headline-rule-center', label: 'Centred rule below headline', grounds: [], ruleAfter: 'headline', ruleShare: 0.34, ruleAlign: 'centre' },
  { key: 'headline-rule-heavy', label: 'Heavy rule below headline', grounds: [], ruleAfter: 'headline', ruleHeight: 2 },
  { key: 'display-rule-double', label: 'Double rule below display', grounds: [], ruleAfter: 'display', ruleCount: 2 },
  // A thin rail continues from the kicker tab across the remaining measure.
  // Its y is inside the kicker's own composed band and its x begins after the
  // measured tab, so it can never cross the kicker words.
  { key: 'kicker-rail', label: 'Section tab + rail', grounds: [], kickerTab: true, kickerRail: true },
  // A rule beneath each ALREADY-COMPOSED headline line. This is the narrow
  // headline-rail device used on international comment/analysis pages: the
  // rule follows the words, not the block width, and never asks the browser
  // or an export writer to break the line a second time.
  { key: 'stepped-lines', label: 'Stepped headline bands', grounds: [], steppedLines: true },
];

export const HEADLINE_STYLE_KEYS = HEADLINE_STYLES.map((entry) => entry.key);

/** Which display bands this treatment lays a ground behind. */
export function groundedBands(style) {
  return HEADLINE_STYLES.find((entry) => entry.key === style)?.grounds || [];
}

/** The complete catalogue row for a treatment, falling back to plain. */
export function headlineTreatment(style) {
  return HEADLINE_STYLES.find((entry) => entry.key === style) || HEADLINE_STYLES[0];
}

/** Whether the treatment paints the true final headline word in the accent. */
export function accentedHeadline(style) {
  return Boolean(headlineTreatment(style).accentWord);
}

/**
 * Paint-only display furniture, in the block's own editor pixels.
 *
 * The compositor is the sole owner of every coordinate used here. Consumers
 * translate these rectangles to HTML, neutral print items or Scribus frames;
 * they do not recalculate them. A treatment therefore cannot alter copy fit,
 * line breaking, page coordinates or any stored text.
 */
export function headlineFurniture(style, composition) {
  const treatment = headlineTreatment(style);
  const bands = composition?.bands || {};
  const content = composition?.content;
  if (!content) return [];
  const pieces = [];
  const accentRule = (x, y, width, height = 1) => {
    if (width > 0) pieces.push({ kind: 'rule', x, y, width, height, ink: 'accent' });
  };

  if (treatment.kickerTab && bands.kicker?.lines?.length) {
    const kicker = bands.kicker;
    const widest = Math.max(...kicker.lines.map((line) => Number(line.width) || 0));
    const width = Math.min(content.measure, Math.max(12, widest + 8));
    const nextTop = bands.headline?.top;
    const bottom = Number.isFinite(nextTop) ? Math.min(kicker.top + kicker.height, nextTop) : kicker.top + kicker.height;
    const top = kicker.top;
    if (bottom > top) {
      pieces.push({ kind: 'fill', x: content.left, y: top, width, height: bottom - top, ink: 'screen' });
      accentRule(content.left, top, 2, bottom - top);
      if (treatment.kickerRail) {
        const railX = content.left + width + 4;
        const railWidth = Math.max(0, content.right - railX);
        accentRule(railX, top + Math.max(0, (bottom - top - 1) / 2), railWidth, 1);
      }
    }
  }

  if (treatment.kickerChip && bands.kicker?.lines?.length) {
    const kicker = bands.kicker;
    const line = kicker.lines[0];
    const top = kicker.top;
    const height = kicker.height;
    const pad = Math.max(3, height * 0.35);
    const left = Math.max(content.left, (Number(line.x) || content.left) - pad);
    const right = Math.min(content.right, (Number(line.x) || content.left) + (Number(line.width) || 0) + pad);
    // Rule first, then the chip over it: the chip must interrupt the rule.
    pieces.push({ kind: 'rule', x: content.left, y: top + height / 2 - 0.75, width: content.measure, height: 1.5, ink: 'rule' });
    if (right > left) pieces.push({ kind: 'fill', x: left, y: top, width: right - left, height, ink: 'accent' });
  }

  if (treatment.steppedLines && bands.headline?.lines?.length) {
    for (const line of bands.headline.lines) {
      // There is no spare leading below a Devanagari display line: a literal
      // underline there can strike a lower matra. A light stepped band uses
      // the line's existing paint box instead, behind the type, and follows
      // the actual words rather than pretending to be a block-wide panel.
      const lineWidth = Math.min(line.measure, line.width || line.measure);
      const x = Math.max(content.left, line.x - 2.5);
      const right = Math.min(content.right, line.x + lineWidth + 2.5);
      const width = Math.max(8, right - x);
      pieces.push({ kind: 'fill', x, y: line.y, width, height: line.height, ink: 'screen' });
      accentRule(x, line.y, 1.5, line.height);
    }
  }

  if (treatment.ruleAfter) {
    let band = bands[treatment.ruleAfter];
    if (treatment.ruleAfter === 'display') band = bands.deck || bands.headline || bands.kicker;
    if (band?.lines?.length) {
      const after = band.top + band.height;
      const following = [
        ...Object.values(bands)
          .filter((one) => one !== band && one?.lines?.length && one.top > band.top)
          .map((one) => ({ top: one.top, bottom: one.top + one.height })),
        ...(composition.bodyLines || [])
          .filter((line) => line.y > band.top)
          .map((line) => ({ top: line.y, bottom: line.y + (line.height || 0) })),
      ];
      // Line boxes may overlap slightly even when their glyphs are clear -
      // baseline spacing owns that decision. Such an overlap is still NOT an
      // empty gap a rule may occupy. The former `line.y > after` filter simply
      // ignored the overlapping first body line, treated the foot of the block
      // as the next object, and painted the rule straight through the copy.
      const occupiedAtEdge = following.some((one) => one.top <= after && one.bottom > after);
      const candidates = following.filter((one) => one.top > after).map((one) => one.top);
      const next = candidates.length ? Math.min(...candidates) : content.bottom;
      // The rule sits halfway through a REAL gap. If this composition has no
      // spare gap, suppress the furniture rather than draw through Marathi.
      if (!occupiedAtEdge && Number.isFinite(next) && next - after >= 1) {
        // Keep the rule visually tied to the display. The cap matters when a
        // story has no body: `content.bottom` may be hundreds of pixels away,
        // and a midpoint there would strand the rule in empty paper.
        const height = Math.max(1, Number(treatment.ruleHeight) || 1);
        const count = Math.max(1, Math.min(2, Number(treatment.ruleCount) || 1));
        const occupied = height * count + (count - 1) * height;
        if (next - after >= occupied) {
          const share = Math.max(0.12, Math.min(1, Number(treatment.ruleShare) || 1));
          const width = content.measure * share;
          const align = treatment.ruleAlign || 'left';
          const x = align === 'centre' ? content.left + (content.measure - width) / 2
            : align === 'right' ? content.right - width : content.left;
          const y = after + Math.min(2, Math.max(0, (next - after - occupied) / 2));
          for (let index = 0; index < count; index += 1) {
            accentRule(x, y + index * height * 2, width, height);
          }
        }
      }
    }
  }
  return pieces;
}

/**
 * An ink at a few per cent - what a printer calls a screen.
 *
 * Mixed toward white rather than given its own catalogue entry, because a
 * screen is a percentage OF an ink and not a colour in its own right: the desk
 * chooses the accent, and this is that accent laid down lightly. 0.12 is the
 * same order as the TINTS above, which were chosen against the rule that
 * anything heavier costs the copy its contrast on newsprint.
 */
export function screenOf(hex, share = 0.12) {
  const value = parseInt(String(hex || '#111111').replace('#', ''), 16);
  if (!Number.isFinite(value)) return '#f2f2f4';
  const mix = (channel) => Math.round(255 - (255 - channel) * share);
  const r = mix((value >> 16) & 0xff);
  const g = mix((value >> 8) & 0xff);
  const b = mix(value & 0xff);
  return `#${[r, g, b].map((c) => c.toString(16).padStart(2, '0')).join('')}`;
}
