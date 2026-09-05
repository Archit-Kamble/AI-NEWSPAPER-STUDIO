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
    { key: 'note', label: 'Fact box', titleLabel: 'Heading', linesLabel: 'Facts', note: 'A ruled panel with a heading and a few lines.' },
    { key: 'quote', label: 'Pull quote', titleLabel: 'Quote heading', linesLabel: 'Quotation', note: 'A sentence lifted out of the story, set large.' },
    { key: 'key-number', label: 'Key number', titleLabel: 'Number', linesLabel: 'Explanation and source', note: 'One large figure with a short explanation and source.' },
    { key: 'explainer', label: 'Numbered explainer', titleLabel: 'Heading', linesLabel: 'Points, one per printed line', note: 'A compact sequence of facts or steps, numbered in Devanagari.' },
    { key: 'timeline', label: 'Timeline', titleLabel: 'Heading', linesLabel: 'Events, one per printed line', note: 'Dated events in order, held together as one factual rail.' },
    { key: 'qa', label: 'Question & answer', titleLabel: 'Heading', linesLabel: 'Question then answer, one per line', note: 'Alternating questions and answers for an interview or explainer.' },
    { key: 'reaction', label: 'Reaction', titleLabel: 'Statement', linesLabel: 'Context, then speaker and role', note: 'A prominent statement followed by the speaker and role.' },
    { key: 'related', label: 'Related / agenda', titleLabel: 'Heading', linesLabel: 'Related items, one per printed line', note: 'A short list of connected stories or essential context.' },
    { key: 'follow-up', label: 'Follow-up', titleLabel: 'Heading', linesLabel: 'Yesterday, today and next — one per line', note: 'A three-step update showing what happened, the current position and what comes next.' },
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
    // A DECORATIVE SEPARATOR - the ornamented rule a printed Marathi paper
    // sets between two parts of a page. Same argument as the cross-head: it is
    // a rectangle in the obstacle set and nothing in the engine changes.
    { key: 'ornament', label: 'Separator', note: 'A decorative rule across the measure.' },
    // A CHART SET INSIDE THE STORY, taking a rectangle the desk chooses.
    //
    // The desk's report: a chart "after choose should first ask us to take
    // space in news block". A Smart Card takes the WHOLE of a block's body -
    // that is what a card is - so the only way to run a chart beside copy was
    // to give the chart its own block. A panel is already a rectangle the copy
    // flows round, and it already has a size the desk sets, so the chart that
    // goes in one is the same chart drawn in a smaller frame.
    //
    // This is also the "block inside block" the desk asked for, and it costs
    // the compositor nothing: it is one more rectangle in the obstacle set,
    // exactly as a photograph is. `card` holds the payload; `title` and
    // `lines` are unused for this kind.
    { key: 'chart', label: 'Chart', note: 'A chart set inside the story, with the copy running round it.' },
    // A TABLE, on the same terms as the chart above and for the same reasons:
    // it carries a `card` payload, it is solved by the one card solver, and to
    // the compositor it is a rectangle the copy runs round.
    { key: 'table', label: 'Table', note: 'Rows and columns set inside the story, with the copy running round them.' },
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
    'key-number': { edges: ['top', 'bottom'], family: 'sans', ground: true },
    explainer: { edges: ['top', 'right', 'bottom', 'left'], family: 'sans', ground: true },
    timeline: { edges: ['left'], family: 'sans', ground: true },
    qa: { edges: ['top', 'bottom'], family: 'serif', ground: true },
    reaction: { edges: ['top', 'bottom'], family: 'serif', ground: true },
    related: { edges: ['top', 'left', 'bottom'], family: 'sans', ground: true },
    'follow-up': { edges: ['top', 'bottom'], family: 'sans', ground: true },
    // A cross-head carries one rule, above it, and no ground. The rule is what
    // says "a new part of this story starts here"; a box would say "this is a
    // different story", which is the opposite.
    crosshead: { edges: ['top'], family: 'sans', ground: false },
    // Ruled above AND below with the mark centred between them - which is what
    // makes it read as an ornament rather than as another cross-head.
    ornament: { edges: ['top', 'bottom'], family: 'serif', ground: false },
    // A chart brings its own ink and its own structure, so it is given no
    // rules and no ground - a box round it would be a second frame inside the
    // one the block already is.
    chart: { edges: [], family: 'sans', ground: false },
    table: { edges: [], family: 'sans', ground: false },
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

  /**
   * THE SEPARATORS A PRINTED PAPER ACTUALLY SETS.
   *
   * The Separator button produced exactly one thing - a ◆ between two
   * hairlines - which is one separator, not the device. A printed Marathi
   * paper has a small vocabulary of them and uses different ones for different
   * jobs: a plain rule between two parts of a story, a heavier one under a
   * section, an ornament where a feature ends.
   *
   * The MARK is what varies; the rules above and below are the kind's own
   * style (STYLES.ornament) and stay put, so nothing here changes how a
   * separator is drawn - only what stands in the middle of it. A mark of ''
   * is the plain double rule, which is the commonest of them and was the one
   * choice the desk did not have.
   *
   * Only marks the publication faces actually carry. U+2022 is absent from
   * both (measured - see BULLET above), so a bullet-style separator uses the
   * squares the dateline and the list already draw.
   */
  const ORNAMENTS = Object.freeze([
    { key: 'plain', label: 'Plain rules', mark: '' },
    { key: 'diamond', label: 'Diamond', mark: '\u25c6' },
    { key: 'diamond-open', label: 'Open diamond', mark: '\u25c7' },
    { key: 'squares', label: 'Three squares', mark: '\u25aa \u25aa \u25aa' },
    { key: 'square', label: 'Square', mark: '\u25a0' },
    { key: 'star', label: 'Star', mark: '\u2605' },
    { key: 'asterisks', label: 'Three stars', mark: '\u2605 \u2605 \u2605' },
  ]);

  const MIN_PX = 24;             // below this nothing legible fits
  const DEFAULT_STAND_OFF_PX = 4;

  const clean = (value) => String(value == null ? '' : value).replace(/<[^>]*>/g, '').trim();

  /**
   * The chart payload a chart panel carries - the SAME shape a whole-block
   * Smart Card stores in `smart_card_data`, so one renderer draws both and a
   * desk can move a chart between the two without it changing.
   *
   * Shape only, like the tint above: this module is loaded as a plain script
   * in the browser and as CommonJS on the server, so it cannot import the ink
   * palette. Which inks are legal is decided where the palette is already
   * awaited - pageSection.service.js - and chartInk() in smart-cards/layout.js
   * falls back to the paper's red for anything it does not recognise, so an
   * unknown value can never reach a plate as an unknown colour.
   */
  function cardOf(raw) {
    if (!raw || typeof raw !== 'object') return null;
    // A READING MAY NAME ITS OWN INK. Shape only here, for the reason above:
    // which inks are legal is decided at the service, where the palette is
    // already awaited, and rowInk() falls back to the chart's own ink for
    // anything it does not recognise - so an unknown value can never reach a
    // plate as an unknown colour. An absent ink is left absent rather than
    // defaulted, because absent is what means "the chart's own".
    const items = (Array.isArray(raw.items) ? raw.items : [])
      .map((entry) => {
        const row = { label: clean(entry?.label), value: Number(entry?.value) };
        const ink = clean(entry?.ink);
        if (ink) row.ink = ink;
        return row;
      })
      .filter((entry) => entry.label && Number.isFinite(entry.value));
    // A TABLE'S PAYLOAD IS ITS GRID, not a list of readings - so a card with
    // rows and columns is kept on those terms and never judged by `items`,
    // which it does not have.
    const columns = (Array.isArray(raw.columns) ? raw.columns : []).map((c) => clean(c));
    const rows = (Array.isArray(raw.rows) ? raw.rows : [])
      .map((row) => (Array.isArray(row) ? row.map((cell) => clean(cell)) : []))
      .filter((row) => row.some((cell) => cell !== ''));
    if (rows.length || columns.some((c) => c !== '')) {
      return {
        columns,
        rows,
        source: clean(raw.source),
        ink: clean(raw.ink),
        ...(clean(raw.family) ? { family: clean(raw.family) } : {}),
      };
    }

    if (!items.length) return null;
    return {
      chartType: clean(raw.chartType) || 'bar',
      // The face the card is set in. Shape only here, like the inks above -
      // which faces exist is decided at the service, where the catalogue is
      // already required.
      ...(clean(raw.family) ? { family: clean(raw.family) } : {}),
      subtitle: clean(raw.subtitle),
      unit: clean(raw.unit),
      source: clean(raw.source),
      ink: clean(raw.ink),
      items,
    };
  }

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
    // A CHART PANEL IS FULL WHEN IT HAS READINGS, not when it has prose. The
    // emptiness test below is what stops a panel with nothing in it from
    // occupying layout space and drawing as a blank rectangle; for a chart the
    // thing that would be missing is its data, so that is what is asked for.
    //
    // AND AN ORNAMENT IS ITS OWN RULES, so it is never empty either. The
    // vocabulary's first and commonest entry is `plain` - two rules and
    // nothing between them, which is what a printed paper sets most often -
    // and it carries no mark at all. It was therefore dropped here on every
    // surface: the draft stored it, the menu lit its "Remove the separator"
    // item, and the page, the Block Editor, the obstacle set and all four
    // exports drew nothing. The panel that added it tried to dodge this with
    // a single space for a line, and `clean()` trims, so the space died on
    // the way in. The kind decides, as it already does for a chart.
    const card = cardOf(raw.card);
    if (kind === 'chart' || kind === 'table') {
      // Both carry a `card` and no lines of their own, so the card IS the
      // panel: without one there is nothing to draw and the panel is refused.
      if (!card) return null;
    } else if (kind !== 'ornament' && !title && !lines.length) return null;
    return {
      id: String(raw.id || `panel-${Math.random().toString(36).slice(2, 9)}`),
      kind,
      x: Math.min(Math.max(0, Number(raw.x) || 0), maxX),
      y: Math.min(Math.max(0, Number(raw.y) || 0), maxY),
      width, height,
      standOffPx: Math.max(0, Number(raw.standOffPx ?? DEFAULT_STAND_OFF_PX)),
      tint, marker, title, lines, card,
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
   * One source of defaults for both editor entry points. The result is still
   * ordinary panel data: after insertion the desk edits every word and every
   * coordinate, and no template identity is stored.
   */
  function defaultPanelFor(kind, frame = {}, bodyFontPx = 6.4) {
    const blockW = Math.max(MIN_PX, Number(frame.width) || 200);
    const blockH = Math.max(MIN_PX, Number(frame.height) || 200);
    const crosshead = kind === 'crosshead';
    const share = ['explainer', 'timeline', 'qa', 'follow-up'].includes(kind) ? 0.54
      : kind === 'key-number' ? 0.42 : 0.46;
    const w = crosshead ? Math.max(MIN_PX, blockW - 4)
      : Math.max(MIN_PX, Math.round(blockW * share));
    const heightShare = ['explainer', 'timeline', 'qa', 'follow-up'].includes(kind) ? 0.38
      : kind === 'key-number' ? 0.28 : 0.3;
    const h = crosshead ? Math.max(MIN_PX, Math.round(Number(bodyFontPx) * 1.45 * 2))
      : Math.max(MIN_PX, Math.round(blockH * heightShare));
    const copy = {
      quote: { title: '', lines: ['इथे अवतरण लिहा'] },
      'key-number': { title: '१.२५ कोटी', lines: ['या आकड्याचा अर्थ', 'स्रोत : अधिकृत नोंद'] },
      explainer: { title: 'हे का महत्त्वाचे?', lines: ['पहिला मुद्दा', 'दुसरा मुद्दा', 'तिसरा मुद्दा'] },
      timeline: { title: 'घटनाक्रम', lines: ['सकाळी ८ — पहिली घटना', 'दुपारी १२ — पुढील घटना'] },
      qa: { title: 'प्रश्नोत्तर', lines: ['मुख्य प्रश्न येथे लिहा', 'उत्तर येथे लिहा'] },
      reaction: { title: '“महत्त्वाचे विधान येथे लिहा”', lines: ['संदर्भ किंवा स्पष्टीकरण', 'नाव, पद'] },
      related: { title: 'आणखी वाचा', lines: ['संबंधित बातमी किंवा पार्श्वभूमी'] },
      'follow-up': { title: 'घडामोडींचा मागोवा', lines: ['निर्णय जाहीर झाला', 'अंमलबजावणी सुरू आहे', 'पुढील सुनावणी सोमवारी'] },
      crosshead: { title: 'पुढील टप्पा', lines: [] },
      ornament: { title: '', lines: [] },
      note: { title: 'ठळक मुद्दे', lines: ['इथे मजकूर लिहा'] },
    }[kind] || { title: 'ठळक मुद्दे', lines: ['इथे मजकूर लिहा'] };
    return {
      id: `panel-${Date.now().toString(36)}`,
      kind, x: crosshead ? 2 : Math.max(0, blockW - w - 2),
      y: Math.max(0, Math.round(blockH * 0.45)), width: w, height: h,
      ...copy,
    };
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
    // A chart or table panel has no lines of its own - the card fills the
    // rectangle and solves its own type against it, exactly as it does in a
    // whole block.
    if (panel.kind === 'chart' || panel.kind === 'table') {
      return { inset: 0, titlePx: 0, linePx: 0, lineHeight: 1, lines: [], usedHeight: panel.height };
    }
    // A cross-head's type sits ON the measure, not inside a box, so it takes
    // only the hair of air that keeps it off its own rule - the same 0.5 mm
    // the block's own inset is, and for the same reason.
    const inset = panel.kind === 'crosshead' || panel.kind === 'ornament' ? 1 : 3;
    const titleScale = panel.kind === 'key-number' ? 2.8
      : panel.kind === 'reaction' ? 1.65
        : panel.kind === 'quote' ? 1.5
          : panel.kind === 'crosshead' ? 1.3 : 1.15;
    const lineScale = panel.kind === 'quote' || panel.kind === 'reaction' ? 1.15 : 0.95;
    const titlePx = Math.max(5, bodyFontPx * titleScale);
    const linePx = Math.max(4.5, bodyFontPx * lineScale);
    const lineHeight = 1.45;
    const out = [];
    let y = inset;
    if (panel.title) {
      out.push({
        text: panel.title, x: inset, y, width: panel.width - inset * 2,
        fontPx: titlePx, bold: true,
        align: panel.kind === 'key-number' ? 1 : 0,
        role: panel.kind === 'key-number' ? 'figure'
          : panel.kind === 'reaction' ? 'statement' : 'title',
        family: panel.kind === 'reaction' ? 'serif' : 'sans',
        ink: panel.kind === 'key-number' || panel.kind === 'related' ? 'accent' : null,
      });
      y += titlePx * lineHeight;
    }
    panel.lines.forEach((text, index) => {
      if (y + linePx * lineHeight > panel.height - inset) return;
      // The marker is set into the line rather than hung in its own column.
      // A hanging indent needs the line broken against a narrower measure for
      // every line after the first, which is what the compositor does for
      // running copy and what a panel deliberately does not have.
      const automaticMarker = panel.kind === 'explainer' ? markerText('number', index)
        : panel.kind === 'timeline' ? `${devanagari(index + 1)}—`
          : panel.kind === 'related' ? markerText('bullet', index)
            : panel.kind === 'follow-up' ? (`${['काल', 'आज', 'पुढे'][index] || devanagari(index + 1)} :`)
            : panel.kind === 'qa' ? (index % 2 === 0 ? 'प्र.' : 'उ.') : '';
      const mark = automaticMarker || markerText(panel.marker, index);
      const marked = mark ? `${mark} ${text}` : text;
      out.push({
        text: marked, x: inset, y, width: panel.width - inset * 2, fontPx: linePx,
        bold: panel.kind === 'qa' ? index % 2 === 0
          : panel.kind === 'reaction' ? index === panel.lines.length - 1 : false,
        role: panel.kind === 'qa' ? (index % 2 === 0 ? 'question' : 'answer')
          : panel.kind === 'reaction' ? (index === panel.lines.length - 1 ? 'attribution' : 'context')
            : panel.kind === 'timeline' ? 'event'
              : panel.kind === 'explainer' ? 'point'
                : panel.kind === 'related' ? 'related'
                  : panel.kind === 'follow-up' ? 'update' : 'line',
        family: panel.kind === 'qa' ? (index % 2 === 0 ? 'sans' : 'serif')
          : panel.kind === 'reaction' && index === panel.lines.length - 1 ? 'sans' : null,
        // An ornament's mark sits on the centre line of its own rule; every
        // other kind sets flush left, as copy does.
        align: panel.kind === 'ornament' || panel.kind === 'key-number' ? 1 : 0,
      });
      y += linePx * lineHeight;
    });
    return { inset, titlePx, linePx, lineHeight, lines: out, usedHeight: y + inset };
  }

  const api = Object.freeze({
    INSET_PANEL_KINDS: KINDS, INSET_PANEL_MARKERS: MARKERS, INSET_PANEL_MIN_PX: MIN_PX,
    INSET_PANEL_STYLES: STYLES,
    INSET_PANEL_BULLET: BULLET,
    INSET_PANEL_ORNAMENTS: ORNAMENTS,
    panelOf, panelsOf, defaultPanelFor, obstacleFromPanel, panelLayout, panelStyle, markerText,
  });
  root.SahasInsetPanels = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
