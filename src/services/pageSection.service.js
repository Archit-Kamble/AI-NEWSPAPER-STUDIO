const pageRepository = require('../repositories/page.repository');
const newspaperRepository = require('../repositories/newspaper.repository');
const { normalizeStoryMetadata } = require('./storyType.service');
const { geometryOf, snapPointsX } = require('../layout/geometry');
const { quote } = require('../layout/rateCard');
const reviewInvalidation = require('./reviewInvalidation.service');
// The one border catalogue, shared with the browser exactly as the character
// grid, the block kinds, the picture style and the inks are.
const { BORDER_KEYS, BORDER_WIDTHS } = require('../../public/editor/layout/borders');
const { panelOf } = require('../../public/editor/layout/inset-panels');
const { TYPEFACES } = require('../../public/editor/layout/typefaces');

/**
 * A CHART'S READINGS MAY NAME THEIR OWN INKS, AND THIS IS WHERE THAT IS CHECKED.
 *
 * inset-panels.js can only check the SHAPE of a colour - it is loaded as a
 * plain script in the browser and cannot import the ESM ink catalogue - so the
 * palette boundary lives here, where the catalogue is already awaited for the
 * block's own tint and accent. It is the same argument as that one, and it is
 * security as well as press correctness: a reading's ink is interpolated into
 * the canvas's style attribute and into a `.sla`, so arbitrary stored text may
 * never reach either renderer.
 *
 * A row that names nothing keeps naming nothing - absent is what means "the
 * chart's own ink", and defaulting it here would silently pin every bar to one
 * colour at the moment it is saved.
 */
function sanitiseCardInks(card, palette) {
  if (!card || typeof card !== 'object' || !Array.isArray(card.items)) return card;
  const legal = (value) => {
    if (!value) return null;
    // Black is the absence of a plate and carries no hex in the catalogue
    // (inks.js), so it cannot come back from sanitiseInk and is asked for by
    // name - exactly as chartInk() asks for it.
    if (String(value).toLowerCase() === 'black' || String(value) === '#111111') return 'black';
    return palette.sanitiseInk(value);
  };
  return {
    ...card,
    ink: card.ink ? (legal(card.ink) || undefined) : card.ink,
    items: card.items.map((item) => {
      if (!item || typeof item !== 'object') return item;
      const ink = legal(item.ink);
      const { ink: _dropped, ...rest } = item;
      return ink ? { ...rest, ink } : rest;
    }),
  };
}

const PRINTABLE_FIELDS = ['news_item_id','kicker','headline','subheading','body','caption','image_url','smart_card_key','smart_card_data'];
const comparable = (value) => JSON.stringify(value ?? null);

const G = geometryOf({});
const MIN_HEIGHT_PX = G.baselinePx * 4;

let palettePromise;
function presentationPalette() {
  if (!palettePromise) palettePromise = import('../../public/editor/layout/inks.js');
  return palettePromise;
}

const supplied = (value) => value !== undefined && value !== null && String(value).trim() !== '';

const nearest = (value, points) =>
  points.reduce((best, p) => (Math.abs(p - value) < Math.abs(best - value) ? p : best), points[0]);
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

// Every block the editor draws or drags covers a whole number of columns and
// sits on the baseline, inside the CONTENT region - never the raw matter box.
// Snapping on the server as well as in the browser means a page is always
// printable whatever sent the request.
//
// This used to clamp against the matter box alone (marginYPx to
// marginYPx+matterHeightPx), which is the whole printable area including the
// header and footer furniture's own bands - so a block dragged to the very
// top or foot of the page could legally land on top of the nameplate/folio or
// the page-foot/imprint strip, exactly the collision geometry.js's region
// model exists to rule out (Project A, Bug #7/#8/#9). Clamping to
// G.regions[kind].content instead makes that collision impossible to create
// in the first place, not just something validatePageLayout() reports after
// the fact.
function snapGeometry(input, pageNumber) {
  const kind = Number(pageNumber) === 1 ? 'front' : (Number(pageNumber) === 2 ? 'insideImprint' : 'inside');
  const { top, bottom } = G.regions[kind].content;

  // Left edge onto a column start, right edge onto a column end - never the
  // other way round, or a block would begin inside a gutter.
  const x = nearest(Math.round(Number(input.x) || 0), G.snapLeftPx);
  const wanted = x + Math.round(Number(input.width) || G.columnPx);
  const rightCandidates = G.snapRightPx.filter((p) => p > x);
  const x2 = nearest(wanted, rightCandidates.length ? rightCandidates : [G.snapRightPx[G.snapRightPx.length - 1]]);

  const snapY = (v) => Math.round(v / G.baselinePx) * G.baselinePx;
  const y = clamp(snapY(Number(input.y) || 0), top, bottom - MIN_HEIGHT_PX);
  const height = clamp(snapY(Number(input.height) || MIN_HEIGHT_PX), MIN_HEIGHT_PX, bottom - y);

  return { x, y, width: x2 - x, height };
}

async function createSection(pageId, body) {
  const id = parseInt(pageId, 10);
  const page = await pageRepository.findById(id);
  if (!page) return null;
  await pageRepository.createSection(id, snapGeometry(body, page.page_number));
  await reviewInvalidation.invalidatePage(id);
  return pageRepository.findById(id);
}

// Removing the sold corner of page one is allowed, and the REFUSAL that used
// to sit here is retired.
//
// It was put in for a real fault: the corner block was deleted and the
// nameplate stretched the paper's own title across the space where it had
// been. But that fault was in the nameplate, not in the deletion - it took
// its own left edge from whether the block happened to exist rather than from
// the page's region model - and it was fixed there. Refusing the deletion as
// well left a page that could never say "this edition does not sell the
// corner", which is an ordinary thing for a paper to say and the thing the
// desk asked for: no corner, and the nameplate set across the whole measure
// (masthead.js).
//
// The classification itself stays in templates.js (isStructuralTemplateFrame)
// and still earns its keep: `POST /api/pages/:id/repair-structural-frames`
// puts the corner back for a desk who removed it and wants it again, and that
// repair reads the same one function.
async function deleteSection(pageId, sectionKey) {
  const id = parseInt(pageId, 10);
  const removed = await pageRepository.deleteSection(id, sectionKey);
  if (!removed) return null;
  await reviewInvalidation.invalidatePage(id);
  return pageRepository.findById(id);
}

async function moveSection(pageId, sectionKey, body) {
  const id = parseInt(pageId, 10);
  const page = await pageRepository.findById(id);
  if (!page) return null;
  const saved = await pageRepository.saveSectionGeometry(id, sectionKey, snapGeometry(body, page.page_number));
  if (!saved) return null;
  await reviewInvalidation.invalidatePage(id);
  return pageRepository.findById(id);
}

// How a flow may be set. `justify-all` forces every line but a paragraph's
// last to reach both edges - see compose.js's JUSTIFY_ALL and the Lokmat
// reference block behind it.
const ALIGNMENTS = Object.freeze(['left', 'center', 'right', 'justify', 'justify-all']);

async function saveSection(pageId, sectionKey, body) {
  const id = parseInt(pageId, 10);
  const beforePage = await pageRepository.findById(id);
  const before = beforePage?.sections?.find((section) => section.section_key === sectionKey);
  const semantic = await normalizeStoryMetadata(body);
  if (semantic.error) return semantic;
  const palette = await presentationPalette();
  const backgroundColor = supplied(body.backgroundColor)
    ? palette.sanitiseTint(body.backgroundColor)
    : null;
  const accentColor = supplied(body.accentColor)
    ? palette.sanitiseInk(body.accentColor)
    : null;
  if (supplied(body.backgroundColor) && backgroundColor === null) {
    return { error: 'The block ground must be one of the newspaper palette tints.' };
  }
  if (supplied(body.accentColor) && accentColor === null) {
    return { error: 'The headline accent must be one of the newspaper palette inks.' };
  }
  // ALIGNMENT IS A CLOSED SET, checked here for the reason the palette is:
  // `text_align` is interpolated into a style attribute by the Typography
  // panel's preview, so arbitrary stored text may not reach a renderer. It had
  // never been checked; adding a fourth legal value is the moment to state
  // what the legal values are.
  for (const field of ['textAlign', 'headlineAlign', 'subheadingAlign']) {
    const value = body[field];
    if (value === undefined || value === null || value === '') continue;
    if (!ALIGNMENTS.includes(value)) {
      return { error: `${field} must be one of ${ALIGNMENTS.join(', ')}.` };
    }
  }
  // The one border catalogue, read by the canvas, the Block Editor and both
  // press paths. This used to be the pair ['none', 'box'] while the Properties
  // panel had offered a third button, "Rule below", since it was written - so
  // pressing it sent a payload the server refused with a 400 and nothing
  // happened on the page. A control that cannot act, found by reading the
  // whitelist against the buttons.
  if (supplied(body.displayFamily) && String(body.displayFamily).trim()
      && !TYPEFACES.some((face) => face.key === body.displayFamily)) {
    return { error: `The headline face must be one of ${TYPEFACES.map((f) => f.key).join(', ')}.` };
  }
  if (supplied(body.borderStyle) && !BORDER_KEYS.includes(body.borderStyle)) {
    return { error: `The border style must be one of ${BORDER_KEYS.join(', ')}.` };
  }
  // A rule is specified in points and stored in editor pixels; the ladder's
  // own ends are the bounds. Nothing validated this before because nothing
  // could set it - the column has existed, and been read by the compositor for
  // the box inset, since it was added.
  if (supplied(body.borderWidthPx)) {
    const width = Number(body.borderWidthPx);
    if (!Number.isFinite(width) || width < BORDER_WIDTHS[0].px || width > BORDER_WIDTHS[3].px) {
      return { error: `The rule must be between ${BORDER_WIDTHS[0].pt} and ${BORDER_WIDTHS[3].pt} points.` };
    }
  }
  if (supplied(body.headlineStyle) && !['plain', 'accent', 'reverse'].includes(body.headlineStyle)) {
    return { error: 'The headline treatment must be plain, accent or reverse.' };
  }
  if (supplied(body.marginPx)
      && (!Number.isFinite(Number(body.marginPx)) || Number(body.marginPx) < 1 || Number(body.marginPx) > 60)) {
    return { error: 'The block margin must be between 1 and 60 pixels.' };
  }
  const article = {
    newsItemId: body.newsItemId || body.sourceNewsId,
    storyType: semantic.storyType,
    editorialPriority: semantic.editorialPriority,
    headline: body.headline || body.title,
    headlineFontPx: body.headlineFontPx,
    kicker: body.kicker,
    subheading: body.subheading || body.subtitle,
    subheadingFontPx: body.subheadingFontPx,
    body: body.body || body.description,
    bodyFontPx: body.bodyFontPx,
    category: body.category,
    location: body.location,
    tags: body.tags,
    reporterName: body.reporterName,
    aiNotes: body.aiNotes,
    caption: body.caption,
    language: body.language,
    status: body.status,
    aiGenerated: body.aiGenerated,
    imageUrl: body.imageUrl,
    imageRotation: body.imageRotation,
    imageZoom: body.imageZoom,
    imageFit: body.imageFit,
    imageFlipH: body.imageFlipH,
    imageFlipV: body.imageFlipV,
    fontFamily: body.fontFamily,
    fontWeight: body.fontWeight,
    fontItalic: body.fontItalic,
    fontUnderline: body.fontUnderline,
    textAlign: body.textAlign,
    headlineAlign: body.headlineAlign,
    subheadingAlign: body.subheadingAlign,
    columnCount: body.columnCount,
    marginPx: body.marginPx,
    lineHeight: body.lineHeight,
    letterSpacingPx: body.letterSpacingPx,
    paragraphSpacingPx: body.paragraphSpacingPx,
    listStyle: body.listStyle,
    dropCapLines: body.dropCapLines,
    // Sanitised through the ONE panel reader before it reaches the column, so
    // a direct API caller cannot store a panel the compositor would then have
    // to defend itself against - the same boundary the ink palette holds.
    insetPanels: body.insetPanels === undefined ? undefined
      : (Array.isArray(body.insetPanels) ? body.insetPanels : [])
        // THE FRAME IS THE BLOCK'S, NOT THE PAYLOAD'S.
        //
        // `panelOf()` clamps a panel inside its block, and it was handed the
        // size from the REQUEST. `payloadFromDraft()` does not carry
        // `widthPx`/`heightPx` - an ordinary save is copy and presentation,
        // not geometry - so `frame.width` arrived `undefined`, `maxX` fell to
        // `width - width` = 0, and every panel was clamped to x=0, y=0.
        //
        // A desk therefore placed a fact box, a pull quote or a chart, and the
        // next autosave slammed it into the block's top-left corner, on top of
        // the headline and on top of every other panel. Measured: a panel
        // stored at (300, 400) came back at (0, 0) after one ordinary save.
        //
        // The block's own row is the authority. A payload that really is
        // resizing the block still clamps against the size it is asking for.
        .map((entry) => panelOf(entry, {
          width: Number(body.widthPx) || Number(before?.width_px) || 0,
          height: Number(body.heightPx) || Number(before?.height_px) || 0,
        }))
        .filter(Boolean)
        // A panel's ground goes through the SAME palette check a block's does.
        // inset-panels.js can only check the shape of a hex - it is loaded as a
        // plain script in the browser - so this is where a colour that is not
        // one of the paper's tints is refused.
        .map((panel) => ({
          ...panel,
          tint: panel.tint ? palette.sanitiseTint(panel.tint) : null,
          ...(panel.card ? { card: sanitiseCardInks(panel.card, palette) } : {}),
        })),
    // The display face, validated against the one typeface catalogue so a
    // foreign family can never reach a renderer.
    displayFamily: body.displayFamily,
    // A real boolean or nothing at all - `undefined` leaves the column alone,
    // which is what a payload that never mentions the dateline should do.
    showDateline: typeof body.showDateline === 'boolean' ? body.showDateline : undefined,
    headlineLocked: typeof body.headlineLocked === 'boolean' ? body.headlineLocked : undefined,
    subheadingLocked: typeof body.subheadingLocked === 'boolean' ? body.subheadingLocked : undefined,
    borderStyle: body.borderStyle,
    borderWidthPx: body.borderWidthPx,
    borderColor: body.borderColor,
    backgroundColor,
    headlineStyle: body.headlineStyle,
    accentColor,
    // What structured card is placed in this block, and its payload. Never
    // `feature_key`, which is the layout's word for what the block is FOR and
    // is not the desk's to change.
    smartCardKey: body.smartCardKey || null,
    // A whole-block card goes through the SAME per-reading ink check a chart
    // panel does. Two paths reach one renderer, so a colour refused on one and
    // waved through on the other is a colour the plate could still be asked
    // for.
    smartCardData: body.smartCardData ? sanitiseCardInks(body.smartCardData, palette) : null,
  };

  const proposed = {
    news_item_id: article.newsItemId || null, kicker: article.kicker || null,
    headline: article.headline || null, subheading: article.subheading || null,
    body: article.body || null, caption: article.caption || null,
    image_url: article.imageUrl || null, smart_card_key: article.smartCardKey || null,
    smart_card_data: article.smartCardData || null,
  };
  const changed = before && PRINTABLE_FIELDS.some((field) => comparable(before[field]) !== comparable(proposed[field]));
  if (changed && ['ready', 'published'].includes(before.status)) article.status = before.ai_generated || article.aiGenerated ? 'needs_review' : 'editing';

  await pageRepository.saveSection(id, sectionKey, article);
  if (changed) await reviewInvalidation.invalidatePage(id);
  return pageRepository.findById(id);
}

// What a block of space is worth, by column-centimetre and position. Position
// is most of the price, so this needs the section, its page number and colour
// forme, and how many pages the edition has.
async function rateFor(pageId, sectionKey) {
  const section = await pageRepository.findSectionForRate(parseInt(pageId, 10), sectionKey);
  if (!section) return null;

  const pages = await pageRepository.findByNewspaper(section.newspaper_id);
  const newspaper = await newspaperRepository.findById(section.newspaper_id);

  return quote(section, section, { totalPages: pages.length, newspaper });
}

module.exports = { saveSection, createSection, deleteSection, moveSection, snapGeometry, rateFor };
