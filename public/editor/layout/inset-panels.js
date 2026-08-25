// A PANEL INSIDE A NEWS BLOCK - the चौकट every Marathi paper sets.
//
// A sidebar, a fact box, a "what this means" note: a small ruled panel sitting
// inside a story, with the story's own copy running round it. Printed papers
// use it constantly and this product had no way to make one - the only thing
// that could displace type inside a block was a photograph.
//
// WHAT THIS IS, DELIBERATELY. It is a rectangle that occupies layout space,
// plus a title and some lines. The compositor already runs type round
// rectangles - that is what a picture is to it - so a panel costs the engine
// exactly one more entry in the obstacle set and NOTHING else changes: not
// fillRow, not viableIntervals, not the balancer, not the fit state. That is
// the smallest thing that could work, and it is deliberately the whole of it.
//
// It is stored as JSONB on the section, the way smart_card_data already is,
// rather than as a table. A panel has no life of its own: it cannot be moved
// between blocks, it is not addressable, and it dies with the block. A table
// would buy foreign keys nothing needs and cost a join on every read.
//
// WHAT IT IS NOT, YET. It holds text. It cannot hold a picture, a Smart Card
// or another panel. The shape below has a `kind` so that a richer panel can be
// added later without a migration, and the geometry is already general - but
// nothing pretends the nesting is recursive today, because it is not.
(function installInsetPanels(root) {
  const KINDS = Object.freeze([
    { key: 'note', label: 'Fact box', note: 'A ruled panel with a heading and a few lines.' },
    { key: 'quote', label: 'Pull quote', note: 'A sentence lifted out of the story, set large.' },
    // A CROSS-HEAD - the ruled sub-head a printed paper sets between two
    // stretches of a long story, and the one device the Lokmat reference block
    // had that this product could not make.
    //
    // It is a panel and not a second kind of paragraph ON PURPOSE. A real
    // mid-flow cross-head means pourBody() carrying a paragraph set in a
    // different face at a different size, which reaches fillRow(), maxSizeIn(),
    // rowHeightFor(), the balancer and justifyLine() - a composition-engine
    // redesign, and this project's own rule is to stop before one. A panel is
    // already a rectangle the copy runs round; made the full measure and a
    // whole number of bands deep, the copy closes above it and resumes on the
    // grid below it, which is what a cross-head IS. The engine gains nothing
    // and learns nothing.
    { key: 'crosshead', label: 'Cross-head', note: 'A ruled sub-head across the measure, between two parts of the story.' },
  ]);

  /**
   * HOW A KIND IS DRAWN - which edges carry a rule, and which face its type is
   * set in. One catalogue, because four writers ask: the canvas (through the
   * matching `.section-inset-*` rules in styles.css, which must agree with
   * this and are commented to say so), the PDF, the IDML and the `.sla`.
   * print-model.js used to hold its own copy of both decisions inline, which
   * is the duplicated-catalogue failure this project has already been bitten
   * by twice.
   */
  //
  // `ground` is whether the kind knocks out what is behind it. A fact box and
  // a pull quote do - they are objects laid ON the page. A cross-head does
  // not: it is a line of type in the column, and a white rectangle behind it
  // would punch a hole in any page overlay it happened to sit over.
  const STYLES = Object.freeze({
    note: { edges: ['top', 'right', 'bottom', 'left'], family: 'sans', ground: true },
    // A pull quote is ruled above and below and open at the sides, so it reads
    // as lifted OUT of the column rather than boxed beside it.
    quote: { edges: ['top', 'bottom'], family: 'serif', ground: true },
    // A cross-head carries one rule, above it, and no ground. The rule is what
    // says "a new part of this story starts here"; a box would say "this is a
    // different story", which is the opposite.
    crosshead: { edges: ['top'], family: 'sans', ground: false },
  });
  const panelStyle = (kind) => STYLES[kind] || STYLES.note;

  // How a panel's lines are marked. The numbered form is the device the Lokmat
  // reference block uses for its two undertakings, and a fact box is where a
  // printed paper puts a short numbered list.
  //
  // Deliberately HERE and not in the body copy. `page_sections.list_style` is a
  // column the compositor has never read - a numbered list in running copy
  // means markers in a hanging indent, per-item numbering and a second kind of
  // paragraph, all inside pourBody(), and that is a composition-engine change
  // rather than a layout one. The panel is where the device is actually wanted
  // and where it costs nothing but a prefix.
  const MARKERS = Object.freeze([
    { key: 'none', label: 'Plain' },
    { key: 'bullet', label: 'Bulleted' },
    { key: 'number', label: 'Numbered' },
  ]);
  const DEVANAGARI_DIGITS = ['०', '१', '२', '३', '४', '५', '६', '७', '८', '९'];
  const devanagari = (n) => String(n).replace(/\d/g, (d) => DEVANAGARI_DIGITS[Number(d)]);

  // A BULLET THE PUBLICATION FACES ACTUALLY HAVE. Measured: serif/400 and
  // sans/700 both lack U+2022, so a real bullet resolves to glyph 0 and the
  // press writer draws it as its .notdef box. U+25AA is the same mark the
  // dateline already opens with and the PDF writer already draws as the filled
  // rectangle it is.
  const BULLET = '\u25aa';

  /**
   * What marker number `index` (0-based) carries, or '' for none.
   *
   * ONE vocabulary for both places a list is set: inside a panel, where the
   * marker goes into the line, and in RUNNING COPY, where compose.js hangs it
   * in its own column beside the measure. `page_sections.list_style` and a
   * panel's `marker` are the same three choices and must not become two
   * catalogues that drift.
   */
  function markerText(marker, index) {
    if (marker === 'number') return `${devanagari(Number(index) + 1)}.`;
    if (marker === 'bullet') return BULLET;
    return '';
  }

  const MIN_PX = 24;             // below this nothing legible fits
  const DEFAULT_STAND_OFF_PX = 4;

  const clean = (value) => String(value == null ? '' : value).replace(/<[^>]*>/g, '').trim();

  /** One stored panel, sanitised. Returns null for anything unusable. */
  function panelOf(raw, frame = {}) {
    if (!raw || typeof raw !== 'object') return null;
    const kind = KINDS.some((k) => k.key === raw.kind) ? raw.kind : 'note';
    const width = Math.max(MIN_PX, Number(raw.width) || 0);
    const height = Math.max(MIN_PX, Number(raw.height) || 0);
    if (!(width > 0 && height > 0)) return null;
    const maxX = Math.max(0, (Number(frame.width) || width) - width);
    const maxY = Math.max(0, (Number(frame.height) || height) - height);
    // A LIGHT GROUND, like the two cream boxes a printed Marathi paper sets a
    // fact box on (the Lokmat reference block has two). Shape only here - this
    // module is loaded as a plain script in the browser and as CommonJS on the
    // server, so it cannot import inks.js, which is ESM. The PALETTE check is
    // at the service boundary, where the ink catalogue is already awaited for
    // exactly this reason (pageSection.service.js). A hex that is the right
    // shape but not one of the paper's tints is refused there and never
    // reaches a renderer.
    const tint = /^#[0-9a-f]{6}$/i.test(String(raw.tint || '')) ? String(raw.tint).toLowerCase() : null;
    const marker = MARKERS.some((m) => m.key === raw.marker) ? raw.marker : 'none';
    const title = clean(raw.title);
    const lines = (Array.isArray(raw.lines) ? raw.lines : String(raw.lines || '').split('\n'))
      .map(clean).filter(Boolean);
    if (!title && !lines.length) return null;
    return {
      id: String(raw.id || `panel-${Math.random().toString(36).slice(2, 9)}`),
      kind,
      x: Math.min(Math.max(0, Number(raw.x) || 0), maxX),
      y: Math.min(Math.max(0, Number(raw.y) || 0), maxY),
      width, height,
      standOffPx: Math.max(0, Number(raw.standOffPx ?? DEFAULT_STAND_OFF_PX)),
      tint, marker, title, lines,
    };
  }

  /** Every legal panel on a section, in the block's own pixels. */
  function panelsOf(section = {}) {
    const raw = section.inset_panels ?? section.insetPanels;
    const list = Array.isArray(raw) ? raw : [];
    const frame = { width: Number(section.width_px) || 0, height: Number(section.height_px) || 0 };
    return list.map((entry) => panelOf(entry, frame)).filter(Boolean);
  }

  /**
   * A panel as the compositor sees it: a rectangle, exactly like a picture.
   * There is no panel-specific arithmetic anywhere in the engine and there
   * must not be - it simply narrows the scanlines it crosses.
   */
  const obstacleFromPanel = (panel) => ({
    x: panel.x, y: panel.y, width: panel.width, height: panel.height,
    shape: 'rect', rotation: 0, standOffPx: panel.standOffPx, mask: null,
  });

  /**
   * How the panel's own type is set inside it. Solved here rather than in a
   * renderer so the canvas, the Block Editor and all four exports place the
   * same lines - the caption's lesson, one file earlier.
   */
  function panelLayout(panel, bodyFontPx = 6.4) {
    // A cross-head's type sits ON the measure, not inside a box, so it takes
    // only the hair of air that keeps it off its own rule - the same 0.5 mm
    // the block's own inset is, and for the same reason.
    const inset = panel.kind === 'crosshead' ? 1 : 3;
    const titlePx = Math.max(5, bodyFontPx * (panel.kind === 'quote' ? 1.5 : panel.kind === 'crosshead' ? 1.3 : 1.15));
    const linePx = Math.max(4.5, bodyFontPx * (panel.kind === 'quote' ? 1.5 : 0.95));
    const lineHeight = 1.45;
    const out = [];
    let y = inset;
    if (panel.title) {
      out.push({ text: panel.title, x: inset, y, width: panel.width - inset * 2, fontPx: titlePx, bold: true });
      y += titlePx * lineHeight;
    }
    panel.lines.forEach((text, index) => {
      if (y + linePx * lineHeight > panel.height - inset) return;
      // The marker is set into the line rather than hung in its own column.
      // A hanging indent needs the line broken against a narrower measure for
      // every line after the first, which is what the compositor does for
      // running copy and what a panel deliberately does not have.
      const mark = markerText(panel.marker, index);
      const marked = mark ? `${mark} ${text}` : text;
      out.push({ text: marked, x: inset, y, width: panel.width - inset * 2, fontPx: linePx, bold: false });
      y += linePx * lineHeight;
    });
    return { inset, titlePx, linePx, lineHeight, lines: out, usedHeight: y + inset };
  }

  const api = Object.freeze({
    INSET_PANEL_KINDS: KINDS, INSET_PANEL_MARKERS: MARKERS, INSET_PANEL_MIN_PX: MIN_PX,
    INSET_PANEL_STYLES: STYLES,
    INSET_PANEL_BULLET: BULLET,
    panelOf, panelsOf, obstacleFromPanel, panelLayout, panelStyle, markerText,
  });
  root.SahasInsetPanels = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
